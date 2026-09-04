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
import { getShader, toUniformValues, type ParamValue } from "@/lib/shaders/registry";
import { getMedia, type MediaSource } from "@/lib/gpu/media";

interface AssetRuntime {
  assetId: string;
  texture: Texture;
  media: MediaSource;
  lastVideoTime: number;
}

interface FrameRuntime {
  frameId: string;
  assetId: string;
  shaderId: string;
  params: Record<string, ParamValue>;
  effect: Effect;
  canvas?: HTMLCanvasElement;
  surface?: Surface;
  visible: boolean;
}

export interface EngineSnapshot {
  assets: Asset[];
  frames: Frame[];
}

export type EngineErrorListener = (error: Error) => void;

/** Largest backing-store dimension for a preview canvas, regardless of zoom. */
const MAX_PREVIEW_DIM = 4096;

export class StudioEngine {
  readonly gpu: Gpu;
  private readonly assets = new Map<string, AssetRuntime>();
  private readonly frames = new Map<string, FrameRuntime>();
  private readonly linearSampler: GPUSampler;
  private loop: FrameLoopHandle | null = null;
  private readonly errorListeners = new Set<EngineErrorListener>();
  private readonly maxDim: number;
  private disposed = false;

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
      this.uploadVideoFrames();
      const t = time.time;
      for (const rt of this.frames.values()) {
        if (!rt.visible || !rt.surface || !rt.canvas) continue;
        if (!this.fitSurfaceToCanvas(rt)) continue;
        rt.effect.set({ params: { time: t } });
        f.pass(rt.surface, rt.effect);
      }
    });
  }

  static async create(): Promise<StudioEngine> {
    const gpu = await init({ powerPreference: "high-performance", label: "shader-studio" });
    return new StudioEngine(gpu);
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
        rt.shaderId = f.shaderId;
        rt.assetId = f.assetId;
        rt.params = f.params;
      } else {
        if (rt.assetId !== f.assetId) {
          const asset = this.assets.get(f.assetId);
          if (asset) {
            rt.effect.set({
              src: asset.texture,
              params: { resolution: [asset.media.width, asset.media.height] },
            });
            rt.assetId = f.assetId;
          }
        }
        if (rt.params !== f.params) {
          rt.effect.set({ params: toUniformValues(getShader(f.shaderId), f.params) });
          rt.params = f.params;
        }
      }
      rt.visible = f.visible;
    }
    for (const [id, rt] of this.frames) {
      if (!liveFrames.has(id)) {
        rt.surface?.dispose();
        this.frames.delete(id);
      }
    }
  }

  /** Binds a DOM canvas to a frame so the render loop presents into it. */
  attachCanvas(frameId: string, canvas: HTMLCanvasElement): void {
    const rt = this.frames.get(frameId);
    if (!rt || this.disposed) return;
    if (rt.surface) rt.surface.dispose();
    rt.canvas = canvas;
    rt.surface = surface(this.gpu, canvas, {
      size: [Math.max(1, canvas.width), Math.max(1, canvas.height)],
      dpr: [1, 2],
      alphaMode: "premultiplied",
      label: `frame:${frameId}`,
    });
  }

  detachCanvas(frameId: string, canvas: HTMLCanvasElement): void {
    const rt = this.frames.get(frameId);
    if (!rt || rt.canvas !== canvas) return;
    rt.surface?.dispose();
    rt.surface = undefined;
    rt.canvas = undefined;
  }

  /** Renders a frame's effect at an arbitrary resolution and returns tightly packed RGBA8 bytes. */
  async renderToBytes(frameId: string, width: number, height: number): Promise<Uint8Array> {
    const rt = this.frames.get(frameId);
    if (!rt) throw new Error("Frame is not ready on the GPU yet.");
    this.uploadVideoFrames();
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
    const rt: AssetRuntime = { assetId: asset.id, texture, media, lastVideoTime: -1 };
    this.assets.set(asset.id, rt);
    if (media.kind === "image") {
      this.gpu.gpu.queue.copyExternalImageToTexture({ source: media.bitmap }, { texture: texture.gpu }, [
        media.width,
        media.height,
      ]);
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
      visible: f.visible,
    });
  }

  private createEffect(f: Frame): Effect {
    const asset = this.assets.get(f.assetId);
    if (!asset) throw new Error(`Missing asset ${f.assetId} for frame ${f.id}`);
    const shader = getShader(f.shaderId);
    return effect(this.gpu, shader.source, {
      label: `${shader.id}:${f.id}`,
      set: {
        params: {
          resolution: [asset.media.width, asset.media.height],
          time: 0,
          ...toUniformValues(shader, f.params),
        },
        src: asset.texture,
        samp: this.linearSampler,
      },
    });
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
    } catch {
      // A frame can be transiently unavailable (seeking, decoder stall); try again next tick.
    }
  }

  /** Keeps the swapchain matched to the on-screen canvas size, clamped to a sane maximum. */
  private fitSurfaceToCanvas(rt: FrameRuntime): boolean {
    const canvas = rt.canvas!;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW < 1 || cssH < 1) return false;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    let w = Math.round(cssW * dpr);
    let h = Math.round(cssH * dpr);
    const scale = Math.min(1, this.maxDim / Math.max(w, h));
    w = Math.max(1, Math.floor(w * scale));
    h = Math.max(1, Math.floor(h * scale));
    const size = rt.surface!.size;
    if (size[0] !== w || size[1] !== h) rt.surface!.resize([w, h]);
    return true;
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

export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator && !!navigator.gpu;
}
