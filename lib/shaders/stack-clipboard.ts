import { DEFAULT_LAYER, MAX_LAYERS, sanitizeLayer } from "@/lib/shaders/layers";
import type { ParamValue } from "@/lib/shaders/registry";
import type { ShaderLayer } from "@/lib/types";

export const STACK_KIND = "shader-studio-stack";
export const STACK_VERSION = 1;

/** One layer in a copied stack. Mask asset ids are omitted — they are workspace-local. */
export interface StackClipboardLayer {
  shaderId: string;
  params: Record<string, ParamValue>;
  visible?: boolean;
  opacity?: number;
  maskInvert?: boolean;
  maskFeather?: number;
  maskContrast?: number;
}

export interface StackClipboard {
  kind: typeof STACK_KIND;
  version: number;
  layers: StackClipboardLayer[];
}

export function serializeStack(layers: ShaderLayer[]): string {
  const payload: StackClipboard = {
    kind: STACK_KIND,
    version: STACK_VERSION,
    layers: layers.map((l) => ({
      shaderId: l.shaderId,
      params: { ...l.params },
      visible: l.visible,
      opacity: l.opacity,
      maskInvert: l.maskInvert,
      maskFeather: l.maskFeather,
      maskContrast: l.maskContrast,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

function asLayerDraft(raw: unknown): StackClipboardLayer | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.shaderId !== "string" || rec.shaderId.length === 0) return null;
  const params =
    rec.params && typeof rec.params === "object" && !Array.isArray(rec.params)
      ? (rec.params as Record<string, ParamValue>)
      : {};
  return {
    shaderId: rec.shaderId,
    params,
    visible: typeof rec.visible === "boolean" ? rec.visible : undefined,
    opacity: typeof rec.opacity === "number" ? rec.opacity : undefined,
    maskInvert: typeof rec.maskInvert === "boolean" ? rec.maskInvert : undefined,
    maskFeather: typeof rec.maskFeather === "number" ? rec.maskFeather : undefined,
    maskContrast: typeof rec.maskContrast === "number" ? rec.maskContrast : undefined,
  };
}

function layersFromUnknown(data: unknown): StackClipboardLayer[] | null {
  if (Array.isArray(data)) {
    const layers = data.map(asLayerDraft).filter((l): l is StackClipboardLayer => l !== null);
    return layers.length > 0 ? layers : null;
  }
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  if ("layers" in rec) return layersFromUnknown(rec.layers);
  if (typeof rec.shaderId === "string") {
    const one = asLayerDraft(rec);
    return one ? [one] : null;
  }
  return null;
}

/** True when clipboard text looks like a shader stack (object or layer array), not a random JSON blob. */
export function looksLikeStack(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    const data = JSON.parse(trimmed) as unknown;
    if (Array.isArray(data)) return data.some((item) => item && typeof item === "object" && "shaderId" in item);
    if (!data || typeof data !== "object") return false;
    const rec = data as Record<string, unknown>;
    if (rec.kind === STACK_KIND) return true;
    if (Array.isArray(rec.layers)) return true;
    return typeof rec.shaderId === "string";
  } catch {
    return false;
  }
}

export function parseStack(text: string): StackClipboardLayer[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return layersFromUnknown(JSON.parse(trimmed) as unknown);
  } catch {
    return null;
  }
}

export function materializeStack(
  drafts: StackClipboardLayer[],
  nextId: () => string,
): ShaderLayer[] {
  return drafts.slice(0, MAX_LAYERS).map((draft) =>
    sanitizeLayer({
      id: nextId(),
      shaderId: draft.shaderId,
      params: draft.params,
      ...DEFAULT_LAYER,
      visible: draft.visible,
      opacity: draft.opacity,
      maskInvert: draft.maskInvert,
      maskFeather: draft.maskFeather,
      maskContrast: draft.maskContrast,
      maskAssetId: null,
    }),
  );
}
