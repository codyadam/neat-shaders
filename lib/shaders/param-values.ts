import type { ParamDef, ParamValue } from "@/lib/shaders/registry";

/** One knot on a tone curve. x and y are both 0–1. */
export type CurvePoint = { x: number; y: number };

/** A hue window. `start` may be greater than `end` when the window wraps past red. */
export type ColorRangeValue = {
  color: [number, number, number];
  start: number;
  end: number;
  softness: number;
};

export const CURVE_MAX_POINTS = 8;

export const IDENTITY_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function finite(n: unknown, fallback: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

export function cloneCurve(points: readonly CurvePoint[]): CurvePoint[] {
  return points.map((p) => ({ x: p.x, y: p.y }));
}

export function cloneColorRange(value: ColorRangeValue): ColorRangeValue {
  return {
    color: [value.color[0], value.color[1], value.color[2]],
    start: value.start,
    end: value.end,
    softness: value.softness,
  };
}

export function cloneParamDefault(def: ParamDef): ParamValue {
  if (def.type === "curve") return cloneCurve(def.default);
  if (def.type === "colorRange") return cloneColorRange(def.default);
  if (Array.isArray(def.default)) return [...def.default] as ParamValue;
  return def.default;
}

/** Sorted, deduped knots with endpoints pinned to x = 0 and x = 1. */
export function normalizeCurve(value: unknown, fallback: readonly CurvePoint[] = IDENTITY_CURVE): CurvePoint[] {
  const raw = Array.isArray(value) ? value : fallback;
  const points: CurvePoint[] = [];
  for (const item of raw) {
    if (Array.isArray(item) && item.length >= 2) {
      points.push({ x: clamp01(Number(item[0])), y: clamp01(Number(item[1])) });
      continue;
    }
    if (item && typeof item === "object" && "x" in item && "y" in item) {
      const point = item as { x: unknown; y: unknown };
      points.push({ x: clamp01(finite(point.x, 0)), y: clamp01(finite(point.y, 0)) });
    }
  }
  points.sort((a, b) => a.x - b.x);
  const unique: CurvePoint[] = [];
  for (const point of points) {
    const prev = unique.at(-1);
    if (prev && Math.abs(prev.x - point.x) < 0.0001) unique[unique.length - 1] = point;
    else unique.push(point);
    if (unique.length === CURVE_MAX_POINTS) break;
  }
  if (unique.length < 2) return cloneCurve(fallback);
  unique[0] = { x: 0, y: unique[0].y };
  unique[unique.length - 1] = { x: 1, y: unique[unique.length - 1].y };
  return unique;
}

export function curveIsIdentity(points: readonly CurvePoint[]): boolean {
  return points.every((p) => Math.abs(p.x - p.y) <= 0.004);
}

export function normalizeColorRange(value: unknown, fallback: ColorRangeValue): ColorRangeValue {
  const source = value && typeof value === "object" ? (value as Partial<ColorRangeValue>) : {};
  const colorRaw = Array.isArray(source.color) ? source.color : fallback.color;
  return {
    color: [
      clamp01(finite(colorRaw[0], fallback.color[0])),
      clamp01(finite(colorRaw[1], fallback.color[1])),
      clamp01(finite(colorRaw[2], fallback.color[2])),
    ],
    start: clamp01(finite(source.start, fallback.start)),
    end: clamp01(finite(source.end, fallback.end)),
    softness: Math.min(0.5, Math.max(0.001, finite(source.softness, fallback.softness))),
  };
}

export function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-5) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  if (h < 0) h += 6;
  return h / 6;
}

/** Hue 0–1 to an sRGB-ish display color at full saturation. */
export function hueToRgb(h: number): [number, number, number] {
  const hue = ((h % 1) + 1) % 1;
  const x = 1 - Math.abs(((hue * 6) % 2) - 1);
  const sector = Math.floor(hue * 6) % 6;
  const rgb: [number, number, number][] = [
    [1, x, 0],
    [x, 1, 0],
    [0, 1, x],
    [0, x, 1],
    [x, 0, 1],
    [1, 0, x],
  ];
  return rgb[sector];
}

export function curveUniforms(key: string, value: unknown): Record<string, number | number[]> {
  const points = normalizeCurve(value);
  const padded = points.slice(0, CURVE_MAX_POINTS);
  const last = padded[padded.length - 1];
  while (padded.length < CURVE_MAX_POINTS) padded.push(last);
  const out: Record<string, number | number[]> = { [`${key}_n`]: points.length };
  for (let i = 0; i < 4; i++) {
    const a = padded[i * 2];
    const b = padded[i * 2 + 1];
    out[`${key}_${i}`] = [a.x, a.y, b.x, b.y];
  }
  return out;
}

export function colorRangeUniforms(key: string, value: unknown, fallback: ColorRangeValue): Record<string, number[]> {
  const range = normalizeColorRange(value, fallback);
  return {
    [`${key}_color`]: range.color,
    [`${key}_window`]: [range.start, range.end, range.softness],
  };
}

export function coerceParamValue(def: ParamDef, value: unknown): ParamValue {
  if (def.type === "curve") return normalizeCurve(value, def.default);
  if (def.type === "colorRange") return normalizeColorRange(value, def.default);
  return value as ParamValue;
}
