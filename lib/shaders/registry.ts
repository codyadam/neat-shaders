import type { ShaderSource } from "@vgpu/wgsl";
import kuwaharaSource from "./wgsl/kuwahara.wgsl";
import passthroughSource from "./wgsl/passthrough.wgsl";
import pixelateSource from "./wgsl/pixelate.wgsl";

export type ParamValue = number | boolean | [number, number] | [number, number, number];

export type ParamDef =
  | {
      type: "float";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      default: number;
      description?: string;
    }
  | {
      type: "int";
      key: string;
      label: string;
      min: number;
      max: number;
      step?: number;
      default: number;
      description?: string;
    }
  | {
      type: "vec2";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      default: [number, number];
      labels?: [string, string];
      description?: string;
    }
  | {
      type: "bool";
      key: string;
      label: string;
      default: boolean;
      description?: string;
    }
  | {
      type: "color";
      key: string;
      label: string;
      default: [number, number, number];
      description?: string;
    };

export interface ShaderDefinition {
  id: string;
  name: string;
  description: string;
  /** Loader-resolved WGSL. Every shader binds `params` (uniform), `src` (texture_2d) and `samp` (sampler). */
  source: ShaderSource;
  params: ParamDef[];
}

export const SHADERS: ShaderDefinition[] = [
  {
    id: "kuwahara",
    name: "Kuwahara",
    description: "Sector-based Kuwahara filter. Painterly smoothing that keeps edges crisp.",
    source: kuwaharaSource,
    params: [
      {
        type: "float",
        key: "kernel_spread",
        label: "Kernel spread",
        min: 0.001,
        max: 50,
        step: 0.01,
        default: 2,
        description: "Distance between samples, in source pixels.",
      },
      {
        type: "int",
        key: "radius",
        label: "Radius",
        min: 1,
        max: 5,
        default: 3,
        description: "Kernel radius in samples (up to 121 taps).",
      },
      {
        type: "vec2",
        key: "canvas_scale",
        label: "Canvas scale",
        min: 0,
        max: 4,
        step: 0.01,
        default: [1, 1],
        labels: ["X", "Y"],
        description: "Anisotropic multiplier for the kernel step.",
      },
      {
        type: "float",
        key: "edge_clamp",
        label: "Edge clamp",
        min: 0,
        max: 0.02,
        step: 0.0001,
        default: 0.001,
        description: "Inset from the borders to avoid edge bleeding.",
      },
    ],
  },
  {
    id: "pixelate",
    name: "Pixelate",
    description: "Mosaic pixelation with posterize and optional tint.",
    source: pixelateSource,
    params: [
      {
        type: "float",
        key: "cell_size",
        label: "Cell size",
        min: 1,
        max: 128,
        step: 1,
        default: 12,
      },
      {
        type: "int",
        key: "levels",
        label: "Levels",
        min: 2,
        max: 64,
        default: 16,
      },
      { type: "bool", key: "tint_enabled", label: "Tint", default: false },
      { type: "color", key: "tint", label: "Tint color", default: [1, 0.6, 0.2] },
      {
        type: "float",
        key: "tint_strength",
        label: "Tint strength",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.6,
      },
    ],
  },
  {
    id: "passthrough",
    name: "Original",
    description: "No processing. Handy as a reference next to a filtered copy.",
    source: passthroughSource,
    params: [
      {
        type: "float",
        key: "opacity",
        label: "Opacity",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
];

export const DEFAULT_SHADER_ID = SHADERS[0].id;

export function getShader(id: string): ShaderDefinition {
  return SHADERS.find((s) => s.id === id) ?? SHADERS[0];
}

export function defaultParams(def: ShaderDefinition): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of def.params) {
    out[p.key] = Array.isArray(p.default) ? ([...p.default] as ParamValue) : p.default;
  }
  return out;
}

/** Converts UI param values into the uniform field values the WGSL struct expects. */
export function toUniformValues(
  def: ShaderDefinition,
  params: Record<string, ParamValue>,
): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {};
  for (const p of def.params) {
    const value = params[p.key] ?? p.default;
    switch (p.type) {
      case "bool":
        out[p.key] = value ? 1 : 0;
        break;
      case "int":
        out[p.key] = Math.round(Number(value));
        break;
      case "float":
        out[p.key] = Number(value);
        break;
      case "vec2":
      case "color":
        out[p.key] = Array.isArray(value) ? [...value] : [...p.default];
        break;
    }
  }
  return out;
}
