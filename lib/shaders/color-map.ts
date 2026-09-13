import type { ParamDef } from "./registry";

/** Six-stop ramps, dark → light. Keep in sync with `wgsl/color-map.wgsl`. */
export type ColorStop = [number, number, number];

export const COLOR_MAP_STOP_KEYS = ["stop_0", "stop_1", "stop_2", "stop_3", "stop_4", "stop_5"] as const;

/** Sampled from the WeatherNext 3 sky key art (cobalt cloud → aqua → sunlit yellow-green). */
export const WEATHERNEXT_STOPS: ColorStop[] = [
  [0.157, 0.282, 0.855],
  [0.176, 0.463, 0.933],
  [0.208, 0.694, 0.957],
  [0.239, 0.82, 0.945],
  [0.525, 0.918, 0.855],
  [0.843, 0.973, 0.722],
];

export const COLOR_MAP_PRESETS: { value: number; label: string; colors: ColorStop[] }[] = [
  { value: 0, label: "WeatherNext", colors: WEATHERNEXT_STOPS },
  {
    value: 1,
    label: "Thermal",
    colors: [
      [0.0, 0.0, 0.016],
      [0.231, 0.059, 0.439],
      [0.549, 0.161, 0.506],
      [0.871, 0.286, 0.408],
      [0.996, 0.624, 0.427],
      [0.988, 0.992, 0.749],
    ],
  },
  {
    value: 2,
    label: "Sunset",
    colors: [
      [0.051, 0.106, 0.165],
      [0.106, 0.227, 0.294],
      [0.769, 0.271, 0.212],
      [0.89, 0.392, 0.078],
      [0.957, 0.635, 0.38],
      [1.0, 0.91, 0.639],
    ],
  },
  {
    value: 3,
    label: "Ember",
    colors: [
      [0.102, 0.02, 0.0],
      [0.29, 0.082, 0.0],
      [0.608, 0.173, 0.0],
      [0.91, 0.365, 0.016],
      [0.957, 0.549, 0.024],
      [1.0, 0.953, 0.69],
    ],
  },
  {
    value: 4,
    label: "Twilight",
    colors: [
      [0.043, 0.063, 0.149],
      [0.18, 0.102, 0.278],
      [0.545, 0.227, 0.384],
      [0.878, 0.478, 0.373],
      [0.949, 0.8, 0.561],
      [1.0, 0.965, 0.878],
    ],
  },
  {
    value: 5,
    label: "Mono",
    colors: [
      [0, 0, 0],
      [0.2, 0.2, 0.2],
      [0.4, 0.4, 0.4],
      [0.6, 0.6, 0.6],
      [0.8, 0.8, 0.8],
      [1, 1, 1],
    ],
  },
  { value: 6, label: "Custom", colors: WEATHERNEXT_STOPS },
];

export const COLOR_MAP_CUSTOM_PRESET = 6;

const STOP_LABELS = ["Shadow", "Dark", "Low mid", "High mid", "Light", "Highlight"] as const;

export function colorMapStopsFromPreset(preset: number): ColorStop[] {
  return COLOR_MAP_PRESETS.find((p) => p.value === preset)?.colors ?? WEATHERNEXT_STOPS;
}

export function isColorMapStopKey(key: string): boolean {
  return (COLOR_MAP_STOP_KEYS as readonly string[]).includes(key);
}

export const COLOR_MAP_STOP_PARAMS: ParamDef[] = COLOR_MAP_STOP_KEYS.map((key, i) => ({
  type: "color" as const,
  key,
  label: STOP_LABELS[i],
  default: [...WEATHERNEXT_STOPS[i]] as ColorStop,
  description: "Used when Palette is Custom. Stops run from darkest (Shadow) to brightest (Highlight).",
}));
