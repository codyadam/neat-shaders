"use client";

import {
  clock,
  effect,
  frame,
  frameLoop,
  init,
  sampler,
  surface,
  target,
  type Effect,
  type FrameLoopHandle,
  type Gpu,
  type Surface,
} from "vgpu";
import type { Texture } from "vgpu/core";
import type { Asset, Frame } from "@/lib/types";
import { getShader, isAnimated, toUniformValues, type ParamValue } from "@/lib/shaders/registry";
import { getMedia, type MediaSource } from "@/lib/gpu/media";

interface AssetRuntime {
  assetId: string;
  texture: Texture;
  media: MediaSource;
  lastVideoTime: number;
  /** Bumped whenever new pixels land in `texture`, so dependent frames know to redraw. */
  version: number;
}

/** Sub-rectangle of the frame's uv space a preview canvas shows: `[u, v, width, height]`. */
type UvWindow = readonly [number, number, number, number];

interface FrameRuntime {
  frameId: string;
  assetId: string;
  shaderId: string;
  params: Record<string, ParamValue>;
  effect: Effect;
  /** The shader reads `params.time`, so it must be redrawn every tick. */
  animated: boolean;
  canvas?: HTMLCanvasElement;
  /** Element covering the whole frame on screen; the canvas only covers its visible part. */
  host?: HTMLElement;
  surface?: Surface;
  visible: boolean;
  /** Something the last presented image depends on changed. */
  dirty: boolean;
  /** Window currently uploaded to the effect's `studio_window` uniform. */
  window: UvWindow | null;
  /** `AssetRuntime.version` the last presented image was drawn from. */
  assetVersion: number;
}

export interface EngineSnapshot {
  assets: Asset[];
  frames: Frame[];
}

export type EngineErrorListener = (error: Error) => void;

/** Largest backing-store dimension for a preview canvas; the visible window rarely gets near it. */
const MAX_PREVIEW_DIM = 4096;

const FULL_WINDOW: UvWindow = [0, 0, 1, 1];

/**
 * Vertex stage shared by every preview effect. It draws vgpu's fullscreen triangle but remaps the
 * interpolated uv through `studio_window`, so a canvas that only covers the visible part of a frame
 * renders exactly that part at its own resolution instead of the whole frame. Shaders stay
 * fragment-only and unaware of it; exports set the window back to the full frame.
 */
const PREVIEW_VERTEX_STAGE = /* wgsl */ `
struct StudioWindow {
  origin: vec2f,
  size: vec2f,
}
@group(1) @binding(0) var<uniform> studio_window: StudioWindow;

struct StudioVertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex fn studio_vs(@builtin(vertex_index) vi: u32) -> StudioVertexOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var uv = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
  var out: StudioVertexOut;
  out.position = vec4f(pos[vi], 0.0, 1.0);
  out.uv = studio_window.origin + uv[vi] * studio_window.size;
  return out;
}
`;

function sameWindow(a: UvWindow | null, b: UvWindow): boolean {
  return a !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export class StudioEngine {
  readonly gpu: Gpu;
  private readonly assets = new Map<string, AssetRuntime>();
  private readonly frames = new Map<string, FrameRuntime>();
  private readonly linearSampler: GPUSampler;
  private loop: FrameLoopHandle | null = null;
  private readonly errorListeners = new Set<EngineErrorListener>();
  private readonly maxDim: number;
  private disposed = false;
  private previewPaused = false;

  private constructor(gpu: Gpu) {
    this.gpu = gpu;
    this.linearSampler = sampler(gpu, {
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.maxDim = Math.min(gpu.gpu.limits.maxTextureDimension2D, MAX_PREVIEW_DIM);
    gpu.onError((error) => {
      for (const cb of this.errorListeners) cb(error);
    });
    const time = clock(gpu);
    this.loop = frameLoop(gpu, (f) => {
      if (this.previewPaused) return;
      this.uploadVideoFrames();
      const t = time.time;
      for (const rt of this.frames.values()) {
        if (!rt.visible || !rt.surface || !rt.canvas) continue;
        const view = this.fitSurfaceToCanvas(rt);
        if (!view) continue;
        this.applyWindow(rt, view);
        const asset = this.assets.get(rt.assetId);
        if (asset && asset.version !== rt.assetVersion) {
          rt.assetVersion = asset.version;
          rt.dirty = true;
        }
        // A canvas keeps showing its last presented image, so static frames are only drawn again
        // when something they depend on changed.
        if (!rt.dirty && !rt.animated) continue;
        rt.effect.set({ params: { time: t } });
        f.pass(rt.surface, rt.effect);
        rt.dirty = false;
      }
    });
  }

  static async create(): Promise<StudioEngine> {
    const gpu = await init({ powerPreference: "high-performance", label: "shader-studio" });
    return new StudioEngine(gpu);
  }

  /** Skips on-canvas preview rendering, e.g. while a video export needs every frame it can get. */
  setPreviewPaused(paused: boolean): void {
    this.previewPaused = paused;
  }

  onError(cb: EngineErrorListener): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  /** Reconciles GPU resources with the current studio state. Cheap when nothing changed. */
  sync(snapshot: EngineSnapshot): void {
    if (this.disposed) return;
    const liveAssets = new Set<string>();
    for (const asset of snapshot.assets) {
      liveAssets.add(asset.id);
      if (!this.assets.has(asset.id)) this.createAssetRuntime(asset);
    }
    for (const [id, rt] of this.assets) {
      if (!liveAssets.has(id)) {
        rt.texture.destroy();
        this.assets.delete(id);
      }
    }

    const liveFrames = new Set<string>();
    for (const f of snapshot.frames) {
      liveFrames.add(f.id);
      const rt = this.frames.get(f.id);
      if (!rt) {
        this.createFrameRuntime(f);
        continue;
      }
      if (rt.shaderId !== f.shaderId) {
        rt.effect = this.createEffect(f);
        rt.animated = isAnimated(getShader(f.shaderId));
        rt.shaderId = f.shaderId;
        rt.assetId = f.assetId;
        rt.params = f.params;
        rt.window = null;
        rt.dirty = true;
      } else {
        if (rt.assetId !== f.assetId) {
          const asset = this.assets.get(f.assetId);
          if (asset) {
            rt.effect.set({
              src: asset.texture,
              params: { resolution: [asset.media.width, asset.media.height] },
            });
            rt.assetId = f.assetId;
            rt.assetVersion = asset.version;
            rt.dirty = true;
          }
        }
        if (rt.params !== f.params) {
          rt.effect.set({ params: toUniformValues(getShader(f.shaderId), f.params) });
          rt.params = f.params;
          rt.dirty = true;
        }
      }
      if (rt.visible !== f.visible) {
        rt.visible = f.visible;
        rt.dirty = true;
      }
    }
    for (const [id, rt] of this.frames) {
      if (!liveFrames.has(id)) {
        rt.surface?.dispose();
        this.frames.delete(id);
      }
    }
  }

  /**
   * Binds a DOM canvas to a frame so the render loop presents into it.
   *
   * `host` is the element that spans the whole frame on screen. When given, the canvas is expected
   * to sit inside it covering only the part currently in view, and the loop renders just that
   * window of the frame; without a host the canvas shows the full frame.
   */
  attachCanvas(frameId: string, canvas: HTMLCanvasElement, host?: HTMLElement): void {
    const rt = this.frames.get(frameId);
    if (!rt || this.disposed) return;
    if (rt.surface) rt.surface.dispose();
    rt.canvas = canvas;
    rt.host = host;
    rt.surface = surface(this.gpu, canvas, {
      size: [Math.max(1, canvas.width), Math.max(1, canvas.height)],
      dpr: [1, 2],
      alphaMode: "premultiplied",
      label: `frame:${frameId}`,
    });
    rt.dirty = true;
  }

  detachCanvas(frameId: string, canvas: HTMLCanvasElement): void {
    const rt = this.frames.get(frameId);
    if (!rt || rt.canvas !== canvas) return;
    rt.surface?.dispose();
    rt.surface = undefined;
    rt.canvas = undefined;
    rt.host = undefined;
  }

  /** Renders a frame's effect at an arbitrary resolution and returns tightly packed RGBA8 bytes. */
  async renderToBytes(frameId: string, width: number, height: number): Promise<Uint8Array> {
    const rt = this.frames.get(frameId);
    if (!rt) throw new Error("Frame is not ready on the GPU yet.");
    this.uploadVideoFrames();
    this.applyWindow(rt, FULL_WINDOW);
    const offscreen = target(this.gpu, {
      size: [Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height))],
      format: "rgba8unorm",
      label: "export",
    });
    try {
      frame(this.gpu, (f) => f.pass(offscreen, rt.effect));
      return await offscreen.read();
    } finally {
      (offscreen as unknown as { destroy?: () => void }).destroy?.();
    }
  }

  /** Creates a surface on a detached canvas sized exactly to `[width, height]`, for video capture. */
  createExportSurface(canvas: HTMLCanvasElement, width: number, height: number): Surface {
    canvas.width = width;
    canvas.height = height;
    return surface(this.gpu, canvas, {
      size: [width, height],
      autoResize: false,
      alphaMode: "opaque",
      label: "export-video",
    });
  }

  /** Presents one frame of `frameId` into `exportSurface`; uploads the newest video frame first. */
  renderToSurface(frameId: string, exportSurface: Surface): void {
    const rt = this.frames.get(frameId);
    if (!rt) return;
    this.uploadVideoFrames();
    this.applyWindow(rt, FULL_WINDOW);
    frame(this.gpu, (f) => f.pass(exportSurface, rt.effect));
  }

  getEffect(frameId: string): Effect | undefined {
    return this.frames.get(frameId)?.effect;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop?.stop();
    for (const rt of this.frames.values()) rt.surface?.dispose();
    this.frames.clear();
    this.assets.clear();
    this.gpu.dispose();
  }

  private createAssetRuntime(asset: Asset): void {
    const media = getMedia(asset.id);
    if (!media) return;
    const texture = this.gpu.device.createTexture({
      size: [media.width, media.height],
      format: "rgba8unorm",
      usage: ["texture_binding", "copy_dst", "render_attachment"],
      label: `asset:${asset.name}`,
    });
    const rt: AssetRuntime = { assetId: asset.id, texture, media, lastVideoTime: -1, version: 0 };
    this.assets.set(asset.id, rt);
    if (media.kind === "image") {
      this.gpu.gpu.queue.copyExternalImageToTexture({ source: media.bitmap }, { texture: texture.gpu }, [
        media.width,
        media.height,
      ]);
      rt.version += 1;
    } else {
      this.uploadVideo(rt, true);
    }
  }

  private createFrameRuntime(f: Frame): void {
    const asset = this.assets.get(f.assetId);
    if (!asset) return;
    this.frames.set(f.id, {
      frameId: f.id,
      assetId: f.assetId,
      shaderId: f.shaderId,
      params: f.params,
      effect: this.createEffect(f),
      animated: isAnimated(getShader(f.shaderId)),
      visible: f.visible,
      dirty: true,
      window: null,
      assetVersion: asset.version,
    });
  }

  private createEffect(f: Frame): Effect {
    const asset = this.assets.get(f.assetId);
    if (!asset) throw new Error(`Missing asset ${f.assetId} for frame ${f.id}`);
    const shader = getShader(f.shaderId);
    return effect(this.gpu, shader.source.wgsl + PREVIEW_VERTEX_STAGE, {
      label: `${shader.id}:${f.id}`,
      set: {
        params: {
          resolution: [asset.media.width, asset.media.height],
          time: 0,
          ...toUniformValues(shader, f.params),
        },
        src: asset.texture,
        samp: this.linearSampler,
        studio_window: { origin: [0, 0], size: [1, 1] },
      },
    });
  }

  private applyWindow(rt: FrameRuntime, view: UvWindow): void {
    if (sameWindow(rt.window, view)) return;
    rt.effect.set({ studio_window: { origin: [view[0], view[1]], size: [view[2], view[3]] } });
    rt.window = view;
    rt.dirty = true;
  }

  private uploadVideoFrames(): void {
    for (const rt of this.assets.values()) {
      if (rt.media.kind === "video") this.uploadVideo(rt, false);
    }
  }

  private uploadVideo(rt: AssetRuntime, force: boolean): void {
    if (rt.media.kind !== "video") return;
    const video = rt.media.video;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (!force && video.currentTime === rt.lastVideoTime) return;
    if (video.videoWidth !== rt.media.width || video.videoHeight !== rt.media.height) return;
    try {
      this.gpu.gpu.queue.copyExternalImageToTexture({ source: video }, { texture: rt.texture.gpu }, [
        rt.media.width,
        rt.media.height,
      ]);
      rt.lastVideoTime = video.currentTime;
      rt.version += 1;
    } catch {
      // A frame can be transiently unavailable (seeking, decoder stall); try again next tick.
    }
  }

  /**
   * Keeps the swapchain matched to the on-screen canvas size (clamped to a sane maximum) and
   * returns the part of the frame the canvas covers, or null when it has no visible area.
   */
  private fitSurfaceToCanvas(rt: FrameRuntime): UvWindow | null {
    const canvas = rt.canvas!;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW < 1 || cssH < 1) return null;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    let w = Math.round(cssW * dpr);
    let h = Math.round(cssH * dpr);
    const scale = Math.min(1, this.maxDim / Math.max(w, h));
    w = Math.max(1, Math.floor(w * scale));
    h = Math.max(1, Math.floor(h * scale));
    const size = rt.surface!.size;
    if (size[0] !== w || size[1] !== h) {
      // Changing the backing store wipes the canvas, so it must be drawn again.
      rt.surface!.resize([w, h]);
      rt.dirty = true;
    }
    if (!rt.host) return FULL_WINDOW;
    const hostRect = rt.host.getBoundingClientRect();
    if (hostRect.width < 1 || hostRect.height < 1) return FULL_WINDOW;
    const canvasRect = canvas.getBoundingClientRect();
    return [
      (canvasRect.left - hostRect.left) / hostRect.width,
      (canvasRect.top - hostRect.top) / hostRect.height,
      canvasRect.width / hostRect.width,
      canvasRect.height / hostRect.height,
    ];
  }
}

type EngineGlobal = typeof globalThis & { __shaderStudioEngine?: Promise<StudioEngine> };

/** Lazily creates the single GPU engine for the page; survives React remounts and HMR. */
export function getEngine(): Promise<StudioEngine> {
  const g = globalThis as EngineGlobal;
  if (!g.__shaderStudioEngine) {
    g.__shaderStudioEngine = StudioEngine.create().catch((error) => {
      g.__shaderStudioEngine = undefined;
      throw error;
    });
  }
  return g.__shaderStudioEngine;
}

/** Drops the cached engine so the next `getEngine()` boots a fresh device (after device loss). */
export function resetEngine(): void {
  const g = globalThis as EngineGlobal;
  const current = g.__shaderStudioEngine;
  g.__shaderStudioEngine = undefined;
  void current?.then((engine) => engine.dispose()).catch(() => undefined);
}

export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator && !!navigator.gpu;
}
