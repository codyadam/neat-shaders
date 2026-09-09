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
  type Target,
} from "vgpu";
import type { Texture } from "vgpu/core";
import type { Asset, Frame, ShaderLayer } from "@/lib/types";
import { renderCharsetAtlas } from "@/lib/shaders/ascii-atlas";
import { needsMix, visibleLayers } from "@/lib/shaders/layers";
import {
  getPasses,
  getShader,
  isAnimated,
  toUniformValues,
  type ParamValue,
  type ShaderDefinition,
  type ShaderPass,
} from "@/lib/shaders/registry";
import { getMedia, type MediaSource } from "@/lib/gpu/media";
import blitSource from "@/lib/shaders/wgsl/blit.wgsl";
import mixSource from "@/lib/shaders/wgsl/mix.wgsl";

interface AssetRuntime {
  assetId: string;
  texture: Texture;
  media: MediaSource;
  lastVideoTime: number;
  version: number;
}

type UvWindow = readonly [number, number, number, number];

interface AtlasRuntime {
  key: string;
  texture: Texture;
  cols: number;
  count: number;
  width: number;
  height: number;
}

interface FrameRuntime {
  frameId: string;
  assetId: string;
  shaderKey: string;
  layerFx: Map<string, Effect[]>;
  pingA?: Target;
  pingB?: Target;
  pingSize: [number, number];
  canvas?: HTMLCanvasElement;
  host?: HTMLElement;
  surface?: Surface;
  visible: boolean;
  dirty: boolean;
  animated: boolean;
  window: UvWindow | null;
  assetVersion: number;
}

export interface EngineSnapshot {
  assets: Asset[];
  frames: Frame[];
  bypassShaders: boolean;
}

export type EngineErrorListener = (error: Error) => void;

const MAX_PREVIEW_DIM = 4096;
const FULL_WINDOW: UvWindow = [0, 0, 1, 1];

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

function shaderKeyOf(frame: Frame): string {
  return frame.layers.map((l) => `${l.id}:${l.shaderId}`).join("|");
}

function frameAnimated(frame: Frame): boolean {
  return frame.layers.some((l) => l.visible && isAnimated(getShader(l.shaderId)));
}

function wgslOf(pass: ShaderPass): string {
  return pass.source.wgsl;
}

function hasBinding(wgsl: string, name: string): boolean {
  return new RegExp(`\\bvar ${name}\\s*:`).test(wgsl);
}

function cappedSize(width: number, height: number, maxDim: number): [number, number] {
  const scale = Math.min(1, maxDim / Math.max(width, height, 1));
  return [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))];
}

function destroyTarget(t?: Target): void {
  (t as unknown as { destroy?: () => void } | undefined)?.destroy?.();
}

export class StudioEngine {
  readonly gpu: Gpu;
  private readonly assets = new Map<string, AssetRuntime>();
  private readonly frames = new Map<string, FrameRuntime>();
  private readonly atlases = new Map<string, AtlasRuntime>();
  private readonly linearSampler: GPUSampler;
  private readonly nearestSampler: GPUSampler;
  private readonly white: Texture;
  private mixEffect!: Effect;
  private blitOffscreen!: Effect;
  private blitPreview!: Effect;
  private loop: FrameLoopHandle | null = null;
  private readonly errorListeners = new Set<EngineErrorListener>();
  private readonly maxDim: number;
  private disposed = false;
  private previewPaused = false;
  private bypassShaders = false;
  private readonly time;

  private constructor(gpu: Gpu) {
    this.gpu = gpu;
    this.linearSampler = sampler(gpu, {
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.nearestSampler = sampler(gpu, {
      minFilter: "nearest",
      magFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.maxDim = Math.min(gpu.gpu.limits.maxTextureDimension2D, MAX_PREVIEW_DIM);
    this.white = this.makeSolidTexture([255, 255, 255, 255]);
    this.time = clock(gpu);
    this.createSharedEffects();

    gpu.onError((error) => {
      for (const cb of this.errorListeners) cb(error);
    });
    this.loop = frameLoop(gpu, (f) => {
      if (this.previewPaused) return;
      this.uploadVideoFrames();
      const t = this.time.time;
      for (const rt of this.frames.values()) {
        if (!rt.visible || !rt.surface || !rt.canvas) continue;
        const view = this.fitSurfaceToCanvas(rt);
        if (!view) continue;
        const asset = this.assets.get(rt.assetId);
        if (asset && asset.version !== rt.assetVersion) {
          rt.assetVersion = asset.version;
          rt.dirty = true;
        }
        if (!rt.dirty && !rt.animated && !this.bypassShaders) continue;
        const frameDoc = this.liveFrame(rt.frameId);
        if (!frameDoc || !asset) continue;
        const size = this.ensurePing(rt, asset);
        const out = this.encodeStack(f, frameDoc, rt.pingA!, rt.pingB!, size, this.bypassShaders, t);
        this.blitPreview.set({
          src: out.color,
          samp: this.linearSampler,
          params: { resolution: size, time: t },
          studio_window: { origin: [view[0], view[1]], size: [view[2], view[3]] },
        });
        f.pass(rt.surface, this.blitPreview);
        rt.window = view;
        rt.dirty = false;
      }
    });
  }

  static async create(): Promise<StudioEngine> {
    const gpu = await init({ powerPreference: "high-performance", label: "shader-studio" });
    return new StudioEngine(gpu);
  }

  setPreviewPaused(paused: boolean): void {
    this.previewPaused = paused;
  }

  onError(cb: EngineErrorListener): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  sync(snapshot: EngineSnapshot): void {
    if (this.disposed) return;
    if (this.bypassShaders !== snapshot.bypassShaders) {
      this.bypassShaders = snapshot.bypassShaders;
      for (const rt of this.frames.values()) rt.dirty = true;
    }

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
      const key = shaderKeyOf(f);
      if (rt.shaderKey !== key) {
        this.rebuildLayerEffects(rt, f);
        rt.shaderKey = key;
        rt.dirty = true;
      }
      if (rt.assetId !== f.assetId) {
        rt.assetId = f.assetId;
        rt.dirty = true;
      }
      const animated = frameAnimated(f);
      if (rt.animated !== animated) {
        rt.animated = animated;
        rt.dirty = true;
      }
      if (rt.visible !== f.visible) {
        rt.visible = f.visible;
        rt.dirty = true;
      }
      rt.dirty = true;
    }
    for (const [id, rt] of this.frames) {
      if (!liveFrames.has(id)) {
        this.disposeFrameRuntime(rt);
        this.frames.delete(id);
      }
    }

    this.liveFrames = snapshot.frames;
  }

  private liveFrames: Frame[] = [];

  private liveFrame(id: string): Frame | undefined {
    return this.liveFrames.find((f) => f.id === id);
  }

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

  async renderToBytes(frameId: string, width: number, height: number): Promise<Uint8Array> {
    const size: [number, number] = [Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height))];
    this.uploadVideoFrames();
    const pingA = target(this.gpu, { size, format: "rgba8unorm", label: "export-a" });
    const pingB = target(this.gpu, { size, format: "rgba8unorm", label: "export-b" });
    try {
      const frameDoc = this.liveFrame(frameId);
      if (!frameDoc) throw new Error("Frame is not ready on the GPU yet.");
      let out: Target = pingA;
      frame(this.gpu, (f) => {
        out = this.encodeStack(f, frameDoc, pingA, pingB, size, false, this.time.time);
      });
      return await out.read();
    } finally {
      destroyTarget(pingA);
      destroyTarget(pingB);
    }
  }

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

  renderToSurface(frameId: string, exportSurface: Surface): void {
    const frameDoc = this.liveFrame(frameId);
    if (!frameDoc) return;
    this.uploadVideoFrames();
    const size = exportSurface.size as [number, number];
    const pingA = target(this.gpu, { size, format: "rgba8unorm", label: "export-va" });
    const pingB = target(this.gpu, { size, format: "rgba8unorm", label: "export-vb" });
    try {
      frame(this.gpu, (f) => {
        const out = this.encodeStack(f, frameDoc, pingA, pingB, size, false, this.time.time);
        this.blitOffscreen.set({
          src: out.color,
          samp: this.linearSampler,
          params: { resolution: size, time: this.time.time },
        });
        f.pass(exportSurface, this.blitOffscreen);
      });
    } finally {
      destroyTarget(pingA);
      destroyTarget(pingB);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop?.stop();
    for (const rt of this.frames.values()) this.disposeFrameRuntime(rt);
    this.frames.clear();
    for (const rt of this.assets.values()) rt.texture.destroy();
    this.assets.clear();
    for (const atlas of this.atlases.values()) atlas.texture.destroy();
    this.atlases.clear();
    this.white.destroy();
    this.gpu.dispose();
  }

  private createSharedEffects(): void {
    const dummy = this.white;
    this.mixEffect = effect(this.gpu, mixSource.wgsl, {
      label: "mix",
      set: {
        params: {
          resolution: [1, 1],
          time: 0,
          opacity: 1,
          invert: 0,
          feather: 0,
          contrast: 1,
          has_mask: 0,
        },
        src: dummy,
        orig: dummy,
        mask: dummy,
        samp: this.linearSampler,
      },
    });
    this.blitOffscreen = effect(this.gpu, blitSource.wgsl, {
      label: "blit",
      set: {
        params: { resolution: [1, 1], time: 0 },
        src: dummy,
        samp: this.linearSampler,
      },
    });
    this.blitPreview = effect(this.gpu, blitSource.wgsl + PREVIEW_VERTEX_STAGE, {
      label: "blit-preview",
      set: {
        params: { resolution: [1, 1], time: 0 },
        src: dummy,
        samp: this.linearSampler,
        studio_window: { origin: [0, 0], size: [1, 1] },
      },
    });
  }

  private makeSolidTexture(rgba: [number, number, number, number]): Texture {
    const texture = this.gpu.device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: ["texture_binding", "copy_dst", "render_attachment"],
      label: "solid",
    });
    this.gpu.gpu.queue.writeTexture({ texture: texture.gpu }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
    return texture;
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
    const rt: FrameRuntime = {
      frameId: f.id,
      assetId: f.assetId,
      shaderKey: shaderKeyOf(f),
      layerFx: new Map(),
      pingSize: [1, 1],
      visible: f.visible,
      dirty: true,
      animated: frameAnimated(f),
      window: null,
      assetVersion: asset.version,
    };
    this.rebuildLayerEffects(rt, f);
    this.frames.set(f.id, rt);
  }

  private disposeFrameRuntime(rt: FrameRuntime): void {
    rt.surface?.dispose();
    destroyTarget(rt.pingA);
    destroyTarget(rt.pingB);
    rt.layerFx.clear();
  }

  private rebuildLayerEffects(rt: FrameRuntime, f: Frame): void {
    rt.layerFx.clear();
    const asset = this.assets.get(f.assetId);
    if (!asset) return;
    for (const layer of f.layers) {
      const shader = getShader(layer.shaderId);
      const effects = getPasses(shader).map((pass, i) => this.createPassEffect(shader, pass, layer, asset, i));
      rt.layerFx.set(layer.id, effects);
    }
  }

  private createPassEffect(
    shader: ShaderDefinition,
    pass: ShaderPass,
    layer: ShaderLayer,
    asset: AssetRuntime,
    index: number,
  ): Effect {
    const wgsl = wgslOf(pass);
    const uniforms = toUniformValues(shader, layer.params);
    const params: Record<string, number | number[]> = {
      resolution: [asset.media.width, asset.media.height],
      time: 0,
      ...uniforms,
      ...pass.constants,
    };
    if (pass.constants && "mode" in pass.constants && uniforms.sigma === undefined) {
      params.sigma = 1;
    }
    if (shader.usesAtlas) {
      params.atlas_cols = 1;
      params.char_count = 1;
    }
    const set: Record<string, unknown> = {
      params,
      src: asset.texture,
      samp: this.linearSampler,
    };
    if (hasBinding(wgsl, "orig")) set.orig = asset.texture;
    if (hasBinding(wgsl, "mask")) set.mask = this.white;
    if (hasBinding(wgsl, "atlas")) {
      const atlas = this.atlasFor(layer.params);
      set.atlas = atlas.texture;
      set.atlas_samp = this.nearestSampler;
    }
    return effect(this.gpu, wgsl, {
      label: `${shader.id}:${layer.id}:${index}`,
      set,
    });
  }

  private atlasFor(params: Record<string, ParamValue>): AtlasRuntime {
    const image = renderCharsetAtlas(params);
    const key = `${image.count}:${image.cols}:${String(params.charset_preset)}:${String(params.charset ?? "")}`;
    const existing = this.atlases.get(key);
    if (existing) return existing;
    const texture = this.gpu.device.createTexture({
      size: [image.canvas.width, image.canvas.height],
      format: "rgba8unorm",
      usage: ["texture_binding", "copy_dst", "render_attachment"],
      label: `atlas:${key}`,
    });
    this.gpu.gpu.queue.copyExternalImageToTexture(
      { source: image.canvas as OffscreenCanvas | HTMLCanvasElement },
      { texture: texture.gpu },
      [image.canvas.width, image.canvas.height],
    );
    const rt: AtlasRuntime = {
      key,
      texture,
      cols: image.cols,
      count: image.count,
      width: image.canvas.width,
      height: image.canvas.height,
    };
    this.atlases.set(key, rt);
    return rt;
  }

  private ensurePing(rt: FrameRuntime, asset: AssetRuntime): [number, number] {
    const size = cappedSize(asset.media.width, asset.media.height, this.maxDim);
    if (!rt.pingA || !rt.pingB) {
      rt.pingA = target(this.gpu, { size, format: "rgba8unorm", label: `${rt.frameId}:a` });
      rt.pingB = target(this.gpu, { size, format: "rgba8unorm", label: `${rt.frameId}:b` });
      rt.pingSize = size;
      return size;
    }
    if (rt.pingSize[0] !== size[0] || rt.pingSize[1] !== size[1]) {
      rt.pingA.resize(size);
      rt.pingB.resize(size);
      rt.pingSize = size;
    }
    return size;
  }

  private encodeStack(
    f: { pass: (dest: Target | Surface, fx: Effect) => void },
    frameDoc: Frame,
    pingA: Target,
    pingB: Target,
    size: [number, number],
    bypass: boolean,
    time: number,
  ): Target {
    const asset = this.assets.get(frameDoc.assetId);
    if (!asset) return pingA;
    const rt = this.frames.get(frameDoc.id);

    if (bypass) {
      this.blitOffscreen.set({
        src: asset.texture,
        samp: this.linearSampler,
        params: { resolution: size, time },
      });
      f.pass(pingA, this.blitOffscreen);
      return pingA;
    }

    const layers = visibleLayers(frameDoc);
    let read: Texture = asset.texture;
    let last: Target | null = null;

    const other = (current: Target | null): Target => (current === pingA ? pingB : pingA);

    for (const layer of layers) {
      const shader = getShader(layer.shaderId);
      const passes = getPasses(shader);
      const effects = rt?.layerFx.get(layer.id);
      const layerInput = read;
      if (!effects || effects.length !== passes.length) continue;

      for (let i = 0; i < passes.length; i++) {
        const dest = other(last);
        const wgsl = wgslOf(passes[i]);
        const bag: Record<string, unknown> = {
          src: read,
          samp: this.linearSampler,
          params: this.passParams(shader, layer, passes[i], size, time),
        };
        if (hasBinding(wgsl, "orig")) bag.orig = layerInput;
        if (hasBinding(wgsl, "atlas")) {
          const atlas = this.atlasFor(layer.params);
          bag.atlas = atlas.texture;
          bag.atlas_samp = this.nearestSampler;
        }
        effects[i].set(bag);
        f.pass(dest, effects[i]);
        read = dest.color;
        last = dest;
      }

      if (needsMix(layer)) {
        const dest = other(last);
        const maskRt = layer.maskAssetId ? this.assets.get(layer.maskAssetId) : undefined;
        this.mixEffect.set({
          src: read,
          orig: layerInput,
          mask: maskRt?.texture ?? this.white,
          samp: this.linearSampler,
          params: {
            resolution: size,
            time,
            opacity: layer.opacity,
            invert: layer.maskInvert ? 1 : 0,
            feather: layer.maskFeather,
            contrast: layer.maskContrast,
            has_mask: maskRt ? 1 : 0,
          },
        });
        f.pass(dest, this.mixEffect);
        read = dest.color;
        last = dest;
      }
    }

    if (!last) {
      this.blitOffscreen.set({
        src: asset.texture,
        samp: this.linearSampler,
        params: { resolution: size, time },
      });
      f.pass(pingA, this.blitOffscreen);
      return pingA;
    }
    return last;
  }

  private passParams(
    shader: ShaderDefinition,
    layer: ShaderLayer,
    pass: ShaderPass,
    size: [number, number],
    time: number,
  ): Record<string, number | number[]> {
    const atlas = shader.usesAtlas ? this.atlasFor(layer.params) : null;
    const uniforms = toUniformValues(shader, layer.params);
    const values: Record<string, number | number[]> = {
      resolution: size,
      time,
      ...uniforms,
      ...pass.constants,
    };
    if (pass.constants && "mode" in pass.constants && uniforms.sigma === undefined) {
      values.sigma = 1;
    }
    if (atlas) {
      values.atlas_cols = atlas.cols;
      values.char_count = atlas.count;
    }
    return values;
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

export function resetEngine(): void {
  const g = globalThis as EngineGlobal;
  const current = g.__shaderStudioEngine;
  g.__shaderStudioEngine = undefined;
  void current?.then((engine) => engine.dispose()).catch(() => undefined);
}

export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator && !!navigator.gpu;
}
