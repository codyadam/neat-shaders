"use client";

import { create } from "zustand";
import type { Asset, Frame, Tool, Viewport } from "@/lib/types";
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
  viewport: Viewport;
  tool: Tool;
  spaceHeld: boolean;
  exportOpen: boolean;
  /** Hide every panel and canvas chrome to look at the result alone (Figma's ⌘\). */
  uiHidden: boolean;

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
  updateFrame: (id: string, patch: Partial<Omit<Frame, "id">>) => void;
  setFrameShader: (id: string, shaderId: string) => void;
  setFrameParam: (id: string, key: string, value: ParamValue) => void;
  resetFrameParams: (id: string) => void;
  removeFrame: (id: string) => void;
  duplicateFrame: (id: string) => string | null;
  reorderFrame: (id: string, direction: "up" | "down") => void;

  select: (id: string | null) => void;
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

export const useStudio = create<StudioState>((set, get) => ({
  assets: [],
  frames: [],
  selectedId: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  tool: "select",
  spaceHeld: false,
  exportOpen: false,
  uiHidden: false,
  viewSize: { w: 1200, h: 800 },

  addAsset: (asset) => set((s) => ({ assets: [...s.assets, asset] })),

  removeAsset: (id) =>
    set((s) => {
      const frames = s.frames.filter((f) => f.assetId !== id);
      const selectedId = s.selectedId && frames.some((f) => f.id === s.selectedId) ? s.selectedId : null;
      return { assets: s.assets.filter((a) => a.id !== id), frames, selectedId };
    }),

  addFrame: ({ assetId, x, y, width, height, shaderId, name }) => {
    const state = get();
    const asset = state.assets.find((a) => a.id === assetId);
    if (!asset) return "";
    const shader = getShader(shaderId ?? DEFAULT_SHADER_ID);
    const w = width ?? asset.width;
    const h = height ?? (width ? (width * asset.height) / asset.width : asset.height);
    const id = uid("frame");
    const frame: Frame = {
      id,
      name: name ?? `${asset.name.replace(/\.[^.]+$/, "")}`,
      assetId,
      shaderId: shader.id,
      params: defaultParams(shader),
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(w),
      height: Math.round(h),
      visible: true,
      locked: false,
    };
    set((s) => ({ frames: [...s.frames, frame], selectedId: id }));
    return id;
  },

  updateFrame: (id, patch) =>
    set((s) => ({
      frames: s.frames.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })),

  setFrameShader: (id, shaderId) =>
    set((s) => ({
      frames: s.frames.map((f) =>
        f.id === id ? { ...f, shaderId, params: defaultParams(getShader(shaderId)) } : f,
      ),
    })),

  setFrameParam: (id, key, value) =>
    set((s) => ({
      frames: s.frames.map((f) => (f.id === id ? { ...f, params: { ...f.params, [key]: value } } : f)),
    })),

  resetFrameParams: (id) =>
    set((s) => ({
      frames: s.frames.map((f) => (f.id === id ? { ...f, params: defaultParams(getShader(f.shaderId)) } : f)),
    })),

  removeFrame: (id) =>
    set((s) => ({
      frames: s.frames.filter((f) => f.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  duplicateFrame: (id) => {
    const source = get().frames.find((f) => f.id === id);
    if (!source) return null;
    const newId = uid("frame");
    const copy: Frame = {
      ...source,
      id: newId,
      name: `${source.name} copy`,
      params: { ...source.params },
      x: source.x + 40,
      y: source.y + 40,
    };
    set((s) => ({ frames: [...s.frames, copy], selectedId: newId }));
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

  select: (id) => set({ selectedId: id }),
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
