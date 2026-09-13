"use client";

import { create } from "zustand";
import type { Asset, Frame, ShaderLayer, Tool, Viewport } from "@/lib/types";
import { DEFAULT_LAYER, MAX_LAYERS, sanitizeLayer } from "@/lib/shaders/layers";
import { materializeStack, type StackClipboardLayer } from "@/lib/shaders/stack-clipboard";
import { DEFAULT_SHADER_ID, defaultParams, getShader, type ParamValue } from "@/lib/shaders/registry";

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

let idCounter = 0;
export function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

interface StudioState {
  assets: Asset[];
  frames: Frame[];
  selectedId: string | null;
  /** Shader layer selected in the tree; null means the frame itself is selected. */
  selectedLayerId: string | null;
  viewport: Viewport;
  tool: Tool;
  spaceHeld: boolean;
  exportOpen: boolean;
  /** Hide every panel and canvas chrome to look at the result alone (Figma's ⌘\). */
  uiHidden: boolean;
  /** Sticky before/after: hide the shader stack on the canvas (export is unaffected). */
  shadersBypassed: boolean;

  addAsset: (asset: Asset) => void;
  removeAsset: (id: string) => void;

  addFrame: (input: {
    assetId: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    shaderId?: string;
    name?: string;
  }) => string;
  updateFrame: (id: string, patch: Partial<Omit<Frame, "id" | "layers">>) => void;
  addLayer: (frameId: string, shaderId?: string) => string | null;
  removeLayer: (frameId: string, layerId: string) => void;
  duplicateLayer: (frameId: string, layerId: string) => string | null;
  reorderLayer: (frameId: string, layerId: string, direction: "up" | "down") => void;
  applyStack: (frameId: string, drafts: StackClipboardLayer[]) => boolean;
  setLayerShader: (frameId: string, layerId: string, shaderId: string) => void;
  setLayerParam: (frameId: string, layerId: string, key: string, value: ParamValue) => void;
  setLayerParams: (frameId: string, layerId: string, patch: Record<string, ParamValue>) => void;
  resetLayerParams: (frameId: string, layerId: string) => void;
  updateLayer: (frameId: string, layerId: string, patch: Partial<Omit<ShaderLayer, "id">>) => void;
  removeFrame: (id: string) => void;
  duplicateFrame: (id: string) => string | null;
  reorderFrame: (id: string, direction: "up" | "down") => void;

  select: (id: string | null) => void;
  selectLayer: (frameId: string, layerId: string | null) => void;
  setTool: (tool: Tool) => void;
  setSpaceHeld: (held: boolean) => void;
  setViewport: (viewport: Partial<Viewport>) => void;
  setViewSize: (size: { w: number; h: number }) => void;
  zoomAt: (factor: number, screenX: number, screenY: number) => void;
  zoomCenter: (factor: number) => void;
  zoomTo: (zoom: number) => void;
  fitAll: () => void;
  fitSelection: () => void;
  setExportOpen: (open: boolean) => void;
  setUiHidden: (hidden: boolean) => void;
  toggleUi: () => void;
  setShadersBypassed: (bypassed: boolean) => void;
  toggleShadersBypassed: () => void;
  viewSize: { w: number; h: number };
}

function boundsOf(frames: Frame[]): { x: number; y: number; w: number; h: number } | null {
  if (frames.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of frames) {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.width);
    maxY = Math.max(maxY, f.y + f.height);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function fitBounds(
  bounds: { x: number; y: number; w: number; h: number },
  view: { w: number; h: number },
  padding = 80,
): Viewport {
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(
      MIN_ZOOM,
      Math.min(
        (view.w - padding * 2) / Math.max(1, bounds.w),
        (view.h - padding * 2) / Math.max(1, bounds.h),
      ),
    ),
  );
  return {
    zoom,
    x: view.w / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: view.h / 2 - (bounds.y + bounds.h / 2) * zoom,
  };
}

function mapFrame(frames: Frame[], id: string, fn: (f: Frame) => Frame): Frame[] {
  return frames.map((f) => (f.id === id ? fn(f) : f));
}

function mapLayer(frame: Frame, layerId: string, fn: (l: ShaderLayer) => ShaderLayer): Frame {
  return { ...frame, layers: frame.layers.map((l) => (l.id === layerId ? fn(l) : l)) };
}

function makeLayer(shaderId?: string): ShaderLayer {
  const shader = getShader(shaderId ?? DEFAULT_SHADER_ID);
  return sanitizeLayer({
    id: uid("layer"),
    shaderId: shader.id,
    params: defaultParams(shader),
    ...DEFAULT_LAYER,
  });
}

export const useStudio = create<StudioState>((set, get) => ({
  assets: [],
  frames: [],
  selectedId: null,
  selectedLayerId: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  tool: "select",
  spaceHeld: false,
  exportOpen: false,
  uiHidden: false,
  shadersBypassed: false,
  viewSize: { w: 1200, h: 800 },

  addAsset: (asset) => set((s) => ({ assets: [...s.assets, asset] })),

  removeAsset: (id) =>
    set((s) => {
      const frames = s.frames.filter((f) => f.assetId !== id).map((f) => ({
        ...f,
        layers: f.layers.map((l) => (l.maskAssetId === id ? { ...l, maskAssetId: null } : l)),
      }));
      const selectedId = s.selectedId && frames.some((f) => f.id === s.selectedId) ? s.selectedId : null;
      const selectedLayerId = selectedId ? s.selectedLayerId : null;
      return { assets: s.assets.filter((a) => a.id !== id), frames, selectedId, selectedLayerId };
    }),

  addFrame: ({ assetId, x, y, width, height, shaderId, name }) => {
    const state = get();
    const asset = state.assets.find((a) => a.id === assetId);
    if (!asset) return "";
    const w = width ?? asset.width;
    const h = height ?? (width ? (width * asset.height) / asset.width : asset.height);
    const id = uid("frame");
    const layer = makeLayer(shaderId);
    const frame: Frame = {
      id,
      name: name ?? `${asset.name.replace(/\.[^.]+$/, "")}`,
      assetId,
      layers: [layer],
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(w),
      height: Math.round(h),
      visible: true,
      locked: false,
    };
    set((s) => ({ frames: [...s.frames, frame], selectedId: id, selectedLayerId: layer.id }));
    return id;
  },

  updateFrame: (id, patch) =>
    set((s) => ({
      frames: mapFrame(s.frames, id, (f) => ({ ...f, ...patch })),
    })),

  addLayer: (frameId, shaderId) => {
    const frame = get().frames.find((f) => f.id === frameId);
    if (!frame || frame.layers.length >= MAX_LAYERS) return null;
    const layer = makeLayer(shaderId ?? "passthrough");
    set((s) => ({
      frames: mapFrame(s.frames, frameId, (f) => ({ ...f, layers: [...f.layers, layer] })),
      selectedId: frameId,
      selectedLayerId: layer.id,
    }));
    return layer.id;
  },

  removeLayer: (frameId, layerId) =>
    set((s) => {
      const frame = s.frames.find((f) => f.id === frameId);
      if (!frame || frame.layers.length <= 1) return {};
      const layers = frame.layers.filter((l) => l.id !== layerId);
      const selectedLayerId =
        s.selectedLayerId === layerId ? (layers[layers.length - 1]?.id ?? null) : s.selectedLayerId;
      return {
        frames: mapFrame(s.frames, frameId, (f) => ({ ...f, layers })),
        selectedLayerId,
      };
    }),

  duplicateLayer: (frameId, layerId) => {
    const frame = get().frames.find((f) => f.id === frameId);
    if (!frame || frame.layers.length >= MAX_LAYERS) return null;
    const source = frame.layers.find((l) => l.id === layerId);
    if (!source) return null;
    const copy: ShaderLayer = { ...source, id: uid("layer"), params: { ...source.params } };
    const index = frame.layers.findIndex((l) => l.id === layerId);
    const layers = [...frame.layers.slice(0, index + 1), copy, ...frame.layers.slice(index + 1)];
    set((s) => ({
      frames: mapFrame(s.frames, frameId, (f) => ({ ...f, layers })),
      selectedId: frameId,
      selectedLayerId: copy.id,
    }));
    return copy.id;
  },

  applyStack: (frameId, drafts) => {
    const frame = get().frames.find((f) => f.id === frameId);
    if (!frame) return false;
    const layers = materializeStack(drafts, () => uid("layer"));
    if (layers.length === 0) return false;
    set((s) => ({
      frames: mapFrame(s.frames, frameId, (f) => ({ ...f, layers })),
      selectedId: frameId,
      selectedLayerId: layers[layers.length - 1]?.id ?? null,
    }));
    return true;
  },

  reorderLayer: (frameId, layerId, direction) =>
    set((s) => {
      const frame = s.frames.find((f) => f.id === frameId);
      if (!frame) return {};
      const index = frame.layers.findIndex((l) => l.id === layerId);
      if (index < 0) return {};
      const next = index + (direction === "up" ? 1 : -1);
      if (next < 0 || next >= frame.layers.length) return {};
      const layers = [...frame.layers];
      [layers[index], layers[next]] = [layers[next], layers[index]];
      return { frames: mapFrame(s.frames, frameId, (f) => ({ ...f, layers })) };
    }),

  setLayerShader: (frameId, layerId, shaderId) =>
    set((s) => ({
      frames: mapFrame(s.frames, frameId, (f) =>
        mapLayer(f, layerId, (l) => {
          const shader = getShader(shaderId);
          return { ...l, shaderId: shader.id, params: defaultParams(shader) };
        }),
      ),
    })),

  setLayerParam: (frameId, layerId, key, value) =>
    set((s) => ({
      frames: mapFrame(s.frames, frameId, (f) =>
        mapLayer(f, layerId, (l) => ({ ...l, params: { ...l.params, [key]: value } })),
      ),
    })),

  setLayerParams: (frameId, layerId, patch) =>
    set((s) => ({
      frames: mapFrame(s.frames, frameId, (f) =>
        mapLayer(f, layerId, (l) => ({ ...l, params: { ...l.params, ...patch } })),
      ),
    })),

  resetLayerParams: (frameId, layerId) =>
    set((s) => ({
      frames: mapFrame(s.frames, frameId, (f) =>
        mapLayer(f, layerId, (l) => ({ ...l, params: defaultParams(getShader(l.shaderId)) })),
      ),
    })),

  updateLayer: (frameId, layerId, patch) =>
    set((s) => ({
      frames: mapFrame(s.frames, frameId, (f) => mapLayer(f, layerId, (l) => ({ ...l, ...patch }))),
    })),

  removeFrame: (id) =>
    set((s) => ({
      frames: s.frames.filter((f) => f.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      selectedLayerId: s.selectedId === id ? null : s.selectedLayerId,
    })),

  duplicateFrame: (id) => {
    const source = get().frames.find((f) => f.id === id);
    if (!source) return null;
    const newId = uid("frame");
    const layers = source.layers.map((l) => ({
      ...l,
      id: uid("layer"),
      params: { ...l.params },
    }));
    const copy: Frame = {
      ...source,
      id: newId,
      name: `${source.name} copy`,
      layers,
      x: source.x + 40,
      y: source.y + 40,
    };
    set((s) => ({
      frames: [...s.frames, copy],
      selectedId: newId,
      selectedLayerId: layers[0]?.id ?? null,
    }));
    return newId;
  },

  reorderFrame: (id, direction) =>
    set((s) => {
      const index = s.frames.findIndex((f) => f.id === id);
      if (index < 0) return {};
      const next = index + (direction === "up" ? 1 : -1);
      if (next < 0 || next >= s.frames.length) return {};
      const frames = [...s.frames];
      [frames[index], frames[next]] = [frames[next], frames[index]];
      return { frames };
    }),

  select: (id) => set({ selectedId: id, selectedLayerId: null }),
  selectLayer: (frameId, layerId) => set({ selectedId: frameId, selectedLayerId: layerId }),
  setTool: (tool) => set({ tool }),
  setSpaceHeld: (held) => set({ spaceHeld: held }),
  setViewport: (viewport) => set((s) => ({ viewport: { ...s.viewport, ...viewport } })),
  setViewSize: (viewSize) => set({ viewSize }),

  zoomAt: (factor, screenX, screenY) =>
    set((s) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s.viewport.zoom * factor));
      const ratio = zoom / s.viewport.zoom;
      return {
        viewport: {
          zoom,
          x: screenX - (screenX - s.viewport.x) * ratio,
          y: screenY - (screenY - s.viewport.y) * ratio,
        },
      };
    }),

  zoomCenter: (factor) => {
    const { viewSize, zoomAt } = get();
    zoomAt(factor, viewSize.w / 2, viewSize.h / 2);
  },

  zoomTo: (zoom) => {
    const { viewSize, viewport } = get();
    get().zoomAt(zoom / viewport.zoom, viewSize.w / 2, viewSize.h / 2);
  },

  fitAll: () => {
    const { frames, viewSize } = get();
    const bounds = boundsOf(frames);
    if (!bounds) return;
    set({ viewport: fitBounds(bounds, viewSize) });
  },

  fitSelection: () => {
    const { frames, selectedId, viewSize } = get();
    const selected = frames.filter((f) => f.id === selectedId);
    const bounds = boundsOf(selected.length ? selected : frames);
    if (!bounds) return;
    set({ viewport: fitBounds(bounds, viewSize) });
  },

  setExportOpen: (open) => set({ exportOpen: open }),
  setUiHidden: (hidden) => set({ uiHidden: hidden }),
  toggleUi: () => set((s) => ({ uiHidden: !s.uiHidden })),
  setShadersBypassed: (bypassed) => set({ shadersBypassed: bypassed }),
  toggleShadersBypassed: () => set((s) => ({ shadersBypassed: !s.shadersBypassed })),
}));

/** Places a frame at the viewport center; used by imports that do not come from a drop. */
export function viewportCenterWorld(): { x: number; y: number } {
  const { viewport, viewSize } = useStudio.getState();
  return {
    x: (viewSize.w / 2 - viewport.x) / viewport.zoom,
    y: (viewSize.h / 2 - viewport.y) / viewport.zoom,
  };
}

export function selectSelectedFrame(s: StudioState): Frame | null {
  return s.frames.find((f) => f.id === s.selectedId) ?? null;
}

export function selectSelectedLayer(s: StudioState): ShaderLayer | null {
  const frame = selectSelectedFrame(s);
  if (!frame || !s.selectedLayerId) return null;
  return frame.layers.find((l) => l.id === s.selectedLayerId) ?? null;
}
