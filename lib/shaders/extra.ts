import type { ShaderDefinition } from "./registry";
import asciiSource from "./wgsl/ascii.wgsl";
import bloomCompositeSource from "./wgsl/bloom-composite.wgsl";
import bloomExtractSource from "./wgsl/bloom-extract.wgsl";
import blurKawaseSource from "./wgsl/blur-kawase.wgsl";
import blurMotionSource from "./wgsl/blur-motion.wgsl";
import blurSeparableSource from "./wgsl/blur-separable.wgsl";
import contrastSource from "./wgsl/contrast.wgsl";
import grainSource from "./wgsl/grain.wgsl";
import grayscaleSource from "./wgsl/grayscale.wgsl";
import hueSource from "./wgsl/hue.wgsl";
import kuwaharaAnisoSource from "./wgsl/kuwahara-aniso.wgsl";
import kuwaharaAnisoTensorSource from "./wgsl/kuwahara-aniso-tensor.wgsl";
import kuwaharaClassicSource from "./wgsl/kuwahara-classic.wgsl";
import kuwaharaPapariSource from "./wgsl/kuwahara-papari.wgsl";
import opacitySource from "./wgsl/opacity.wgsl";
import saturationSource from "./wgsl/saturation.wgsl";
import snnSource from "./wgsl/snn.wgsl";
import tintSource from "./wgsl/tint.wgsl";
import tomitaTsujiSource from "./wgsl/tomita-tsuji.wgsl";
import vignetteSource from "./wgsl/vignette.wgsl";

export const CHARSET_PRESETS: { value: number; label: string; chars: string }[] = [
  { value: 0, label: "Standard", chars: "@#S08Xx+=-;:,. " },
  {
    value: 1,
    label: "Detailed",
    chars: "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ",
  },
  { value: 2, label: "Minimal", chars: ".:-=+*#%@" },
  { value: 3, label: "Blocks", chars: "█▓▒░ " },
  { value: 4, label: "Custom", chars: "" },
];

export function charsetFromParams(params: Record<string, unknown>): string {
  const preset = Number(params.charset_preset ?? 0);
  if (preset === 4) {
    const custom = String(params.charset ?? "");
    return custom.length > 0 ? custom : CHARSET_PRESETS[0].chars;
  }
  return CHARSET_PRESETS[preset]?.chars ?? CHARSET_PRESETS[0].chars;
}

const radiusInt = (max: number, def: number, description: string) =>
  ({
    type: "int" as const,
    key: "radius",
    label: "Radius",
    min: 1,
    max,
    default: def,
    description,
  });

export const EXTRA_SHADERS: ShaderDefinition[] = [
  {
    id: "kuwahara-classic",
    name: "Kuwahara (classic)",
    group: "Painterly",
    description: "Original 4-quadrant Kuwahara: overlapping boxes, keep the lowest-variance mean.",
    source: kuwaharaClassicSource,
    params: [radiusInt(8, 3, "Half-width of each quadrant, in source pixels.")],
  },
  {
    id: "kuwahara-papari",
    name: "Kuwahara (Papari)",
    group: "Painterly",
    description:
      "Papari extension: circular 8-sector kernel, polynomial weights, and a soft inverse-variance blend.",
    source: kuwaharaPapariSource,
    params: [
      radiusInt(8, 4, "Kernel radius in source pixels."),
      {
        type: "float",
        key: "sharpness",
        label: "Sharpness",
        min: 0.1,
        max: 8,
        step: 0.05,
        default: 2,
        description: "How strongly low-variance sectors win the blend. Higher is closer to a hard pick.",
      },
    ],
  },
  {
    id: "kuwahara-anisotropic",
    name: "Kuwahara (anisotropic)",
    group: "Painterly",
    description:
      "Structure-tensor Kuwahara: elliptical sectors follow local edges. Two GPU passes (tensor then filter).",
    passes: [{ source: kuwaharaAnisoTensorSource }, { source: kuwaharaAnisoSource }],
    params: [
      radiusInt(5, 3, "Ellipse radius in source pixels. Higher is much more expensive."),
      {
        type: "float",
        key: "eccentricity",
        label: "Eccentricity",
        min: 0,
        max: 4,
        step: 0.05,
        default: 1.5,
        description: "How strongly the kernel stretches along edges.",
      },
      {
        type: "float",
        key: "sharpness",
        label: "Sharpness",
        min: 0.1,
        max: 8,
        step: 0.05,
        default: 2,
      },
    ],
  },
  {
    id: "tomita-tsuji",
    name: "Tomita–Tsuji",
    group: "Painterly",
    description: "Five overlapping windows (four corners plus centre); pick the lowest-variance mean.",
    source: tomitaTsujiSource,
    params: [radiusInt(6, 2, "Window radius. Classic Tomita–Tsuji is a 5×5 (radius 2).")],
  },
  {
    id: "snn",
    name: "Symmetric nearest neighbour",
    group: "Painterly",
    description:
      "For each opposite pair of pixels, keep the one closer to the centre colour, then average. Cheap edge-preserving smooth.",
    source: snnSource,
    params: [radiusInt(8, 2, "Chebyshev radius of paired samples.")],
  },
  {
    id: "ascii",
    name: "ASCII",
    group: "ASCII",
    description:
      "Map brightness to glyphs from a character ramp. Custom sets, source colour, contrast, coverage and edge emphasis.",
    source: asciiSource,
    usesAtlas: true,
    params: [
      {
        type: "float",
        key: "cell_size",
        label: "Cell size",
        min: 4,
        max: 64,
        step: 1,
        default: 10,
        description: "Glyph cell size in source pixels.",
      },
      {
        type: "select",
        key: "charset_preset",
        label: "Character set",
        options: CHARSET_PRESETS.map(({ value, label }) => ({ value, label })),
        default: 0,
      },
      {
        type: "string",
        key: "charset",
        label: "Custom characters",
        default: "@#S08Xx+=-;:,. ",
        placeholder: "Dark → light",
        description: "Used when Character set is Custom. Dense glyphs first for dark areas.",
      },
      {
        type: "float",
        key: "contrast",
        label: "Contrast",
        min: 0.2,
        max: 4,
        step: 0.05,
        default: 1.2,
      },
      { type: "bool", key: "invert", label: "Invert", default: false },
      {
        type: "select",
        key: "color_mode",
        label: "Color",
        options: [
          { value: 0, label: "Ink" },
          { value: 1, label: "Source" },
        ],
        default: 0,
      },
      { type: "color", key: "ink", label: "Ink", default: [0.95, 0.95, 0.92] },
      { type: "color", key: "background", label: "Background", default: [0.05, 0.05, 0.06] },
      {
        type: "float",
        key: "coverage",
        label: "Coverage",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
        description: "Cells brighter than this stay as background.",
      },
      {
        type: "float",
        key: "edge",
        label: "Edge emphasis",
        min: 0,
        max: 2,
        step: 0.01,
        default: 0,
        description: "Adds Sobel edges into the brightness used to pick a glyph.",
      },
    ],
  },
  {
    id: "blur-gaussian",
    name: "Blur (Gaussian)",
    group: "Blur",
    description: "Separable Gaussian blur (horizontal then vertical pass).",
    passes: [
      { source: blurSeparableSource, constants: { axis: [1, 0], mode: 0 } },
      { source: blurSeparableSource, constants: { axis: [0, 1], mode: 0 } },
    ],
    params: [
      {
        type: "float",
        key: "radius",
        label: "Radius",
        min: 1,
        max: 24,
        step: 1,
        default: 8,
      },
      {
        type: "float",
        key: "sigma",
        label: "Sigma",
        min: 0.2,
        max: 16,
        step: 0.1,
        default: 4,
      },
    ],
  },
  {
    id: "blur-box",
    name: "Blur (box)",
    group: "Blur",
    description: "Separable box blur.",
    passes: [
      { source: blurSeparableSource, constants: { axis: [1, 0], mode: 1 } },
      { source: blurSeparableSource, constants: { axis: [0, 1], mode: 1 } },
    ],
    params: [
      {
        type: "float",
        key: "radius",
        label: "Radius",
        min: 1,
        max: 24,
        step: 1,
        default: 6,
      },
    ],
  },
  {
    id: "blur-kawase",
    name: "Blur (Kawase)",
    group: "Blur",
    description: "Wide Dual Kawase-style blur. Cheaper large-radius look than a Gaussian.",
    passes: [{ source: blurKawaseSource }, { source: blurKawaseSource }],
    params: [
      {
        type: "float",
        key: "offset",
        label: "Offset",
        min: 0.5,
        max: 12,
        step: 0.1,
        default: 2.5,
      },
    ],
  },
  {
    id: "blur-motion",
    name: "Blur (motion)",
    group: "Blur",
    description: "Directional streak along an angle.",
    source: blurMotionSource,
    params: [
      {
        type: "float",
        key: "distance",
        label: "Distance",
        min: 0,
        max: 200,
        step: 1,
        default: 24,
        description: "Streak length in source pixels.",
      },
      {
        type: "float",
        key: "angle",
        label: "Angle",
        min: 0,
        max: 6.2832,
        step: 0.01,
        default: 0,
        description: "Radians. 0 is to the right.",
      },
      {
        type: "int",
        key: "samples",
        label: "Samples",
        min: 3,
        max: 32,
        default: 12,
      },
    ],
  },
  {
    id: "hue",
    name: "Hue",
    group: "Color",
    description: "Rotate hues around the grey axis.",
    source: hueSource,
    params: [
      {
        type: "float",
        key: "degrees",
        label: "Degrees",
        min: -180,
        max: 180,
        step: 1,
        default: 0,
      },
    ],
  },
  {
    id: "contrast",
    name: "Contrast",
    group: "Color",
    description: "Scale RGB around mid-grey.",
    source: contrastSource,
    params: [
      {
        type: "float",
        key: "amount",
        label: "Amount",
        min: 0,
        max: 3,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    id: "saturation",
    name: "Saturation",
    group: "Color",
    description: "0 is greyscale, 1 is original, above 1 pushes chroma.",
    source: saturationSource,
    params: [
      {
        type: "float",
        key: "amount",
        label: "Amount",
        min: 0,
        max: 3,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    id: "grayscale",
    name: "Grayscale",
    group: "Color",
    description: "Mix towards luminance.",
    source: grayscaleSource,
    params: [
      {
        type: "float",
        key: "amount",
        label: "Amount",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    id: "tint",
    name: "Tint",
    group: "Color",
    description: "Tint by luminance toward a colour.",
    source: tintSource,
    params: [
      { type: "color", key: "tint", label: "Tint", default: [1, 0.72, 0.45] },
      {
        type: "float",
        key: "strength",
        label: "Strength",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.35,
      },
    ],
  },
  {
    id: "opacity",
    name: "Opacity",
    group: "Color",
    description: "Multiply the layer alpha. Combine with a mask for fades.",
    source: opacitySource,
    params: [
      {
        type: "float",
        key: "amount",
        label: "Amount",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    id: "grain",
    name: "Grain",
    group: "Atmosphere",
    description: "Film-like luminance grain. Enable animated for video.",
    source: grainSource,
    params: [
      {
        type: "float",
        key: "amount",
        label: "Amount",
        min: 0,
        max: 0.4,
        step: 0.005,
        default: 0.08,
      },
      {
        type: "float",
        key: "size",
        label: "Size",
        min: 0.5,
        max: 8,
        step: 0.1,
        default: 1,
      },
      { type: "bool", key: "animated", label: "Animated", default: false },
    ],
  },
  {
    id: "vignette",
    name: "Vignette",
    group: "Atmosphere",
    description: "Darken the frame edges.",
    source: vignetteSource,
    params: [
      {
        type: "float",
        key: "intensity",
        label: "Intensity",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.45,
      },
      {
        type: "float",
        key: "roundness",
        label: "Roundness",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
      {
        type: "float",
        key: "smoothness",
        label: "Smoothness",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.45,
      },
    ],
  },
  {
    id: "bloom",
    name: "Bloom",
    group: "Atmosphere",
    description: "Extract highlights, blur them, and add them back. Four GPU passes.",
    passes: [
      { source: bloomExtractSource },
      { source: blurSeparableSource, constants: { axis: [1, 0], mode: 0 } },
      { source: blurSeparableSource, constants: { axis: [0, 1], mode: 0 } },
      { source: bloomCompositeSource },
    ],
    params: [
      {
        type: "float",
        key: "threshold",
        label: "Threshold",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.7,
      },
      {
        type: "float",
        key: "radius",
        label: "Radius",
        min: 1,
        max: 24,
        step: 1,
        default: 12,
      },
      {
        type: "float",
        key: "sigma",
        label: "Sigma",
        min: 0.2,
        max: 16,
        step: 0.1,
        default: 6,
      },
      {
        type: "float",
        key: "strength",
        label: "Strength",
        min: 0,
        max: 4,
        step: 0.01,
        default: 0.8,
      },
    ],
  },
];
