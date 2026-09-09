import { DEFAULT_SHADER_ID, defaultParams, getShader } from "@/lib/shaders/registry";
import type { Frame, ShaderLayer } from "@/lib/types";

export const MAX_LAYERS = 16;

export const DEFAULT_LAYER: Pick<
  ShaderLayer,
  "visible" | "opacity" | "maskAssetId" | "maskInvert" | "maskFeather" | "maskContrast"
> = {
  visible: true,
  opacity: 1,
  maskAssetId: null,
  maskInvert: false,
  maskFeather: 0,
  maskContrast: 1,
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

/** A layer ready to store, with unknown shader ids remapped and new params filled in. */
export function sanitizeLayer(layer: Partial<ShaderLayer> & { id: string }): ShaderLayer {
  const shader = getShader(layer.shaderId ?? DEFAULT_SHADER_ID);
  const params = { ...defaultParams(shader) };
  if (layer.params) {
    for (const p of shader.params) {
      if (p.key in layer.params) params[p.key] = layer.params[p.key];
    }
  }
  return {
    id: layer.id,
    shaderId: shader.id,
    params,
    visible: layer.visible ?? true,
    opacity: clamp01(layer.opacity ?? 1),
    maskAssetId: layer.maskAssetId ?? null,
    maskInvert: Boolean(layer.maskInvert),
    maskFeather: Number.isFinite(layer.maskFeather) ? Math.max(0, Number(layer.maskFeather)) : 0,
    maskContrast: Number.isFinite(layer.maskContrast) ? Number(layer.maskContrast) : 1,
  };
}

type LegacyFrame = Partial<Frame> & {
  id: string;
  name: string;
  assetId: string;
  shaderId?: string;
  params?: ShaderLayer["params"];
  layers?: ShaderLayer[];
};

/** Turns a saved frame (stack or legacy single shader) into the current shape. */
export function sanitizeFrame(frame: LegacyFrame, nextId: () => string): Frame {
  let layers: ShaderLayer[];
  if (Array.isArray(frame.layers) && frame.layers.length > 0) {
    layers = frame.layers.map((layer) => sanitizeLayer({ ...layer, id: layer.id || nextId() }));
  } else {
    const shader = getShader(frame.shaderId ?? DEFAULT_SHADER_ID);
    layers = [
      sanitizeLayer({
        id: nextId(),
        shaderId: shader.id,
        params: frame.params,
        ...DEFAULT_LAYER,
      }),
    ];
  }
  return {
    id: frame.id,
    name: frame.name,
    assetId: frame.assetId,
    layers,
    x: frame.x ?? 0,
    y: frame.y ?? 0,
    width: Math.max(1, frame.width ?? 1),
    height: Math.max(1, frame.height ?? 1),
    visible: frame.visible ?? true,
    locked: frame.locked ?? false,
  };
}

export function needsMix(layer: ShaderLayer): boolean {
  if (layer.opacity < 0.999) return true;
  return Boolean(layer.maskAssetId);
}

export function visibleLayers(frame: Frame): ShaderLayer[] {
  return frame.layers.filter((l) => l.visible);
}

export function stackLabel(frame: Frame): string {
  const vis = visibleLayers(frame);
  if (vis.length === 0) return "Original";
  if (vis.length === 1) return getShader(vis[0].shaderId).name;
  return `${vis.length} shaders`;
}
