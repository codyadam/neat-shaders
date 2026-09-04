import type { ShaderSource } from "@vgpu/wgsl";
import dotGridSource from "./wgsl/dot-grid.wgsl";
import halftoneSource from "./wgsl/halftone.wgsl";
import kuwaharaSource from "./wgsl/kuwahara.wgsl";
import litSurfaceSource from "./wgsl/lit-surface.wgsl";
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
    }
  | {
      /** Enumerated choice, packed as an `i32` holding the selected option's `value`. */
      type: "select";
      key: string;
      label: string;
      options: { value: number; label: string }[];
      default: number;
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
    id: "dot-grid",
    name: "Dot grid",
    description:
      "Halftone dot field that enters as a staggered wave, then idles with a roaming highlight that swells nearby dots.",
    source: dotGridSource,
    params: [
      {
        type: "float",
        key: "pitch",
        label: "Pitch",
        min: 2,
        max: 200,
        step: 0.5,
        default: 14,
        description: "Distance between neighbouring dots, in source pixels.",
      },
      {
        type: "float",
        key: "dot_size_min",
        label: "Dot size (idle)",
        min: 0,
        max: 100,
        step: 0.5,
        default: 1,
        description: "Dot diameter before the entrance.",
      },
      {
        type: "float",
        key: "dot_size_max",
        label: "Dot size (settled)",
        min: 0,
        max: 200,
        step: 0.5,
        default: 10,
        description: "Dot diameter once the entrance has finished.",
      },
      {
        type: "float",
        key: "padding",
        label: "Padding",
        min: 0,
        max: 500,
        step: 1,
        default: 24,
        description: "Inset from the frame edge to the dot field.",
      },
      {
        type: "select",
        key: "shape",
        label: "Shape",
        options: [
          { value: 0, label: "Circle" },
          { value: 1, label: "Square" },
          { value: 2, label: "Diamond" },
        ],
        default: 0,
      },
      {
        type: "float",
        key: "softness",
        label: "Softness",
        min: 0,
        max: 20,
        step: 0.1,
        default: 0,
        description: "Extra edge feather on every dot, in source pixels.",
      },
      {
        type: "select",
        key: "size_source",
        label: "Halftone",
        options: [
          { value: 0, label: "Off" },
          { value: 1, label: "Bright = large" },
          { value: 2, label: "Dark = large" },
        ],
        default: 2,
        description: "Scale the settled dot size by the source luminance under each dot.",
      },
      {
        type: "float",
        key: "size_influence",
        label: "Halftone amount",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
      {
        type: "float",
        key: "size_gamma",
        label: "Halftone gamma",
        min: 0.1,
        max: 4,
        step: 0.01,
        default: 1,
        description: "Curve applied to luminance before sizing (>1 pushes midtones smaller).",
      },
      {
        type: "select",
        key: "color_mode",
        label: "Dot color",
        options: [
          { value: 0, label: "Solid" },
          { value: 1, label: "Source" },
          { value: 2, label: "Source × active" },
        ],
        default: 0,
      },
      { type: "color", key: "active_color", label: "Active color", default: [0.973, 0.682, 0] },
      { type: "color", key: "idle_color", label: "Idle color", default: [0.45, 0.45, 0.45] },
      {
        type: "float",
        key: "idle_alpha",
        label: "Idle opacity",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.4,
      },
      { type: "color", key: "background", label: "Background", default: [0.04, 0.04, 0.04] },
      {
        type: "float",
        key: "background_alpha",
        label: "Background opacity",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
        description: "0 leaves the area between dots transparent.",
      },
      {
        type: "float",
        key: "source_backdrop",
        label: "Source backdrop",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0,
        description: "Opacity of the original media drawn behind the dots.",
      },
      { type: "bool", key: "entrance_enabled", label: "Entrance wave", default: true },
      {
        type: "select",
        key: "entrance_order",
        label: "Entrance order",
        options: [
          { value: 0, label: "Rows" },
          { value: 1, label: "Columns" },
          { value: 2, label: "Diagonal" },
          { value: 3, label: "Radial" },
          { value: 4, label: "Random" },
        ],
        default: 0,
      },
      {
        type: "float",
        key: "enter_spread",
        label: "Entrance spread",
        min: 0,
        max: 30,
        step: 0.05,
        default: 3,
        description: "Seconds between the first and the last dot starting to grow.",
      },
      {
        type: "float",
        key: "enter_duration",
        label: "Entrance duration",
        min: 0.01,
        max: 5,
        step: 0.01,
        default: 0.35,
        description: "Seconds for one dot to grow to its settled size.",
      },
      { type: "bool", key: "loop_enabled", label: "Loop entrance", default: true },
      {
        type: "float",
        key: "loop_hold",
        label: "Loop hold",
        min: 0,
        max: 60,
        step: 0.1,
        default: 8,
        description: "Seconds to stay settled before the entrance replays.",
      },
      {
        type: "float",
        key: "time_offset",
        label: "Time offset",
        min: -60,
        max: 60,
        step: 0.05,
        default: 0,
        description: "Shifts the animation timeline; handy to line up a still export.",
      },
      { type: "bool", key: "highlight_enabled", label: "Roaming highlight", default: true },
      {
        type: "float",
        key: "highlight_cycle",
        label: "Highlight cycle",
        min: 0.1,
        max: 10,
        step: 0.05,
        default: 2,
        description: "Seconds before the highlight jumps to another random cell.",
      },
      {
        type: "float",
        key: "influence_radius",
        label: "Influence radius",
        min: 1,
        max: 600,
        step: 1,
        default: 50,
        description: "Dots closer than this to the highlighted cell swell.",
      },
      {
        type: "float",
        key: "grow_scale",
        label: "Grow scale",
        min: 1,
        max: 6,
        step: 0.05,
        default: 2.2,
        description: "Size multiplier at the centre of the highlight.",
      },
      {
        type: "float",
        key: "grow_rate",
        label: "Grow rate",
        min: 0.5,
        max: 60,
        step: 0.5,
        default: 30,
        description: "How snappily dots swell (exponential rate per second).",
      },
      {
        type: "float",
        key: "shrink_rate",
        label: "Shrink rate",
        min: 0.5,
        max: 60,
        step: 0.5,
        default: 6,
        description: "How quickly the previous highlight relaxes.",
      },
      { type: "bool", key: "speck_enabled", label: "Corner speck", default: true },
      {
        type: "color",
        key: "speck_color",
        label: "Speck color",
        default: [1, 1, 1],
        description: "Colour of the single top-left dot that keeps its own fill.",
      },
    ],
  },
  {
    id: "halftone",
    name: "Halftone",
    description:
      "Fixed-grid dot halftone: dot size follows darkness (or brightness when inverted), near-background cells are skipped, dots take a tint or the quantised source colour.",
    source: halftoneSource,
    params: [
      {
        type: "float",
        key: "size",
        label: "Cell size",
        min: 2,
        max: 200,
        step: 0.5,
        default: 20,
        description: "Distance between neighbouring dots, in source pixels. Smaller = denser.",
      },
      {
        type: "float",
        key: "max_diameter",
        label: "Max diameter",
        min: 0,
        max: 200,
        step: 0.5,
        default: 10,
        description: "Dot diameter for a fully dark (or fully bright, inverted) sample. Keep ≤ cell size so dots don't merge.",
      },
      {
        type: "float",
        key: "min_diameter",
        label: "Min diameter",
        min: 0,
        max: 200,
        step: 0.5,
        default: 0,
        description: "Floor diameter for background cells. 0 skips them entirely.",
      },
      {
        type: "float",
        key: "threshold",
        label: "Threshold",
        min: 0,
        max: 1,
        step: 0.005,
        default: 0.92,
        description: "Luma past this is background. Normal: near-white. Inverted: near-black.",
      },
      { type: "bool", key: "invert", label: "Invert", default: false },
      {
        type: "float",
        key: "gamma",
        label: "Gamma",
        min: 0.1,
        max: 4,
        step: 0.01,
        default: 1,
        description: "Curve applied to the darkness weight before sizing.",
      },
      {
        type: "float",
        key: "alpha_cutoff",
        label: "Alpha cutoff",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.03,
        description: "Cells more transparent than this draw nothing.",
      },
      {
        type: "select",
        key: "shape",
        label: "Shape",
        options: [
          { value: 0, label: "Circle" },
          { value: 1, label: "Square" },
          { value: 2, label: "Diamond" },
        ],
        default: 0,
      },
      {
        type: "float",
        key: "softness",
        label: "Softness",
        min: 0,
        max: 20,
        step: 0.1,
        default: 0,
        description: "Extra edge feather on every dot, in source pixels.",
      },
      {
        type: "bool",
        key: "sample_color",
        label: "Sample colour",
        default: false,
        description: "Paint each dot with the source colour instead of the tint.",
      },
      {
        type: "int",
        key: "color_bits",
        label: "Colour bits",
        min: 1,
        max: 8,
        default: 4,
        description: "Bits kept per RGB channel when sampling colour. Lower = coarser palette.",
      },
      { type: "color", key: "tint", label: "Tint", default: [0, 0, 0] },
      { type: "color", key: "background", label: "Background", default: [1, 1, 1] },
      {
        type: "float",
        key: "background_alpha",
        label: "Background opacity",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
        description: "0 leaves the area between dots transparent.",
      },
      {
        type: "float",
        key: "source_backdrop",
        label: "Source backdrop",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0,
        description: "Opacity of the original media drawn behind the dots.",
      },
    ],
  },
  {
    id: "lit-surface",
    name: "Lit surface",
    description:
      "Hashed rounded cells on a spacing grid light up around a focus: brighter cells grow, take a palette colour and split chromatically. The focus can sweep, sit still or flood the field; ripples are optional.",
    source: litSurfaceSource,
    params: [
      {
        type: "select",
        key: "light_mode",
        label: "Light",
        options: [
          { value: 0, label: "Sweep" },
          { value: 1, label: "Static focus" },
          { value: 2, label: "Flood" },
        ],
        default: 0,
        description: "Sweep moves the focus along a path; Static keeps it at the offset; Flood lights every cell.",
      },
      {
        type: "select",
        key: "sweep_path",
        label: "Sweep path",
        options: [
          { value: 0, label: "Linear" },
          { value: 1, label: "Diagonal" },
          { value: 2, label: "Bounce" },
          { value: 3, label: "Orbit" },
          { value: 4, label: "Figure eight" },
        ],
        default: 0,
      },
      {
        type: "float",
        key: "sweep_cycle",
        label: "Sweep cycle",
        min: 0.2,
        max: 60,
        step: 0.1,
        default: 6,
        description: "Seconds for one full pass of the path.",
      },
      {
        type: "float",
        key: "sweep_ease",
        label: "Sweep ease",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0,
        description: "0 = constant speed, 1 = slows down at both ends.",
      },
      {
        type: "float",
        key: "path_extent",
        label: "Path extent",
        min: 0,
        max: 2,
        step: 0.01,
        default: 0.8,
        description: "Travel of the bounce / orbit / figure-eight paths, as a fraction of the frame.",
      },
      {
        type: "vec2",
        key: "focus_offset",
        label: "Focus offset",
        min: -1,
        max: 1,
        step: 0.01,
        default: [0, 0],
        labels: ["X", "Y"],
        description: "Shifts the focus / path (−1 … 1 spans half the frame).",
      },
      {
        type: "float",
        key: "time_offset",
        label: "Time offset",
        min: -60,
        max: 60,
        step: 0.05,
        default: 0,
        description: "Shifts the animation timeline; handy to line up a still export.",
      },
      {
        type: "float",
        key: "falloff_radius",
        label: "Falloff radius",
        min: 10,
        max: 2000,
        step: 1,
        default: 260,
        description: "Distance from the focus (source pixels) at which cells stop lighting.",
      },
      {
        type: "float",
        key: "opacity",
        label: "Light opacity",
        min: 0,
        max: 2,
        step: 0.01,
        default: 0.9,
        description: "Peak cell brightness under the focus.",
      },
      {
        type: "float",
        key: "flood_level",
        label: "Flood level",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.6,
        description: "Proximity every cell is given in Flood mode (1 = as if under the focus).",
      },
      {
        type: "float",
        key: "dot_spacing",
        label: "Cell spacing",
        min: 3,
        max: 200,
        step: 0.5,
        default: 14,
        description: "Grid pitch in source pixels.",
      },
      {
        type: "float",
        key: "dot_radius",
        label: "Cell radius",
        min: 0.5,
        max: 100,
        step: 0.25,
        default: 2.5,
        description: "Base half-width of a cell before jitter and brightness growth.",
      },
      {
        type: "float",
        key: "dot_aspect",
        label: "Cell aspect",
        min: 0.2,
        max: 4,
        step: 0.05,
        default: 1.5,
        description: "Height / width of each cell.",
      },
      {
        type: "float",
        key: "corner_radius",
        label: "Corner radius",
        min: 0,
        max: 0.5,
        step: 0.01,
        default: 0.22,
        description: "Rounded corner as a fraction of the cell's shorter side.",
      },
      {
        type: "float",
        key: "size_jitter",
        label: "Size jitter",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
        description: "Per-cell hashed size variation (0.72× … 1.2× at 1).",
      },
      {
        type: "float",
        key: "brightness_growth",
        label: "Brightness growth",
        min: 0,
        max: 4,
        step: 0.05,
        default: 1.2,
        description: "How much brighter cells grow (width × (0.85 + brightness × growth)).",
      },
      { type: "color", key: "main_color", label: "Main colour", default: [1, 0.91, 0.82] },
      {
        type: "float",
        key: "palette_variation",
        label: "Palette variation",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
        description: "Spread of the four-colour palette derived from the main colour.",
      },
      {
        type: "float",
        key: "chromatic_strength",
        label: "Chromatic strength",
        min: 0,
        max: 2,
        step: 0.01,
        default: 0.6,
      },
      {
        type: "float",
        key: "chromatic_offset",
        label: "Chromatic offset",
        min: 0,
        max: 60,
        step: 0.5,
        default: 6,
        description: "Max radial split of the warm / cool copies, in source pixels.",
      },
      {
        type: "select",
        key: "composite",
        label: "Composite",
        options: [
          { value: 0, label: "Additive" },
          { value: 1, label: "Normal" },
        ],
        default: 0,
        description: "Additive matches the canvas 'lighter' mode; Normal is plain source-over.",
      },
      { type: "color", key: "background", label: "Background", default: [0.04, 0.04, 0.05] },
      {
        type: "float",
        key: "background_alpha",
        label: "Background opacity",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
      {
        type: "float",
        key: "source_backdrop",
        label: "Source backdrop",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.2,
        description: "Opacity of the original media drawn behind the cells.",
      },
      { type: "bool", key: "ripples_enabled", label: "Ripples", default: false },
      {
        type: "float",
        key: "ripple_period",
        label: "Ripple period",
        min: 0.1,
        max: 20,
        step: 0.1,
        default: 1.6,
        description: "Seconds between rings emitted from the focus.",
      },
      {
        type: "float",
        key: "ripple_duration",
        label: "Ripple duration",
        min: 0.1,
        max: 10,
        step: 0.01,
        default: 0.62,
      },
      {
        type: "float",
        key: "ripple_opacity",
        label: "Ripple opacity",
        min: 0,
        max: 2,
        step: 0.01,
        default: 0.9,
      },
      {
        type: "float",
        key: "ripple_max_radius",
        label: "Ripple reach",
        min: 0.1,
        max: 8,
        step: 0.1,
        default: 2.6,
        description: "Ring travel as a multiple of the falloff radius.",
      },
      {
        type: "float",
        key: "ripple_ring_width",
        label: "Ripple ring width",
        min: 0.02,
        max: 2,
        step: 0.01,
        default: 0.42,
        description: "Ring thickness as a fraction of the falloff radius.",
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
      case "select":
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
