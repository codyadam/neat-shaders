import type { ParamValue } from "@/lib/shaders/registry";
import { charsetFromParams } from "@/lib/shaders/extra";

const CELL = 64;
const MAX_CHARS = 96;
const LABEL_FONT_PX = 128;
const LABEL_WEIGHT = "400";

export interface AtlasImage {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  cols: number;
  rows: number;
  count: number;
  /** Canvas-pixel width / height of one glyph cell. 1 for the square ASCII grid. */
  cellAspect: number;
  /** Included in the GPU cache key so a late-loaded webfont replaces the fallback bake. */
  fontKey: string;
}

export interface AtlasOptions {
  charset?: string;
  style?: "ascii" | "label";
}

function glyphList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ch of Array.from(raw)) {
    if (ch === "\n" || ch === "\r") continue;
    if (seen.has(ch)) continue;
    seen.add(ch);
    out.push(ch);
    if (out.length >= MAX_CHARS) break;
  }
  return out.length > 0 ? out : ["#"];
}

function makeCanvas(width: number, height: number, preferDom: boolean): OffscreenCanvas | HTMLCanvasElement {
  if (preferDom && typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  return Object.assign(document.createElement("canvas"), { width, height });
}

/** First family from `--font-geist-sans`, skipping the size-adjust Fallback face. */
function geistFamily(): string {
  if (typeof document === "undefined") return `"Geist"`;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-sans").trim();
  if (!raw) return `"Geist"`;
  const parts = raw.split(",").map((part) => part.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  const face = parts.find((name) => name && !/fallback/i.test(name));
  return face ? `"${face.replace(/\\/g, "").replace(/"/g, "")}"` : `"Geist"`;
}

function labelFontSpec(family: string): string {
  return `${LABEL_WEIGHT} ${LABEL_FONT_PX}px ${family}`;
}

function fontReady(spec: string): boolean {
  if (typeof document === "undefined" || !document.fonts) return false;
  try {
    if (!document.fonts.check(spec)) {
      void document.fonts.load(spec);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function measureLabelCell(ctx: CanvasRenderingContext2D, glyphs: string[]): { cellW: number; cellH: number; ascent: number } {
  let maxW = LABEL_FONT_PX * 0.62;
  let maxAscent = LABEL_FONT_PX * 0.72;
  let maxDescent = LABEL_FONT_PX * 0.22;
  for (const ch of glyphs) {
    const m = ctx.measureText(ch);
    const left = Number.isFinite(m.actualBoundingBoxLeft) ? m.actualBoundingBoxLeft : 0;
    const right = Number.isFinite(m.actualBoundingBoxRight) ? m.actualBoundingBoxRight : m.width;
    const inkW = Math.max(m.width, left + right, 1);
    maxW = Math.max(maxW, inkW);
    if (Number.isFinite(m.actualBoundingBoxAscent)) maxAscent = Math.max(maxAscent, m.actualBoundingBoxAscent);
    if (Number.isFinite(m.actualBoundingBoxDescent)) maxDescent = Math.max(maxDescent, m.actualBoundingBoxDescent);
  }
  const padX = Math.ceil(LABEL_FONT_PX * 0.08);
  const padY = Math.ceil(LABEL_FONT_PX * 0.08);
  return {
    cellW: Math.ceil(maxW) + padX * 2,
    cellH: Math.ceil(maxAscent + maxDescent) + padY * 2,
    ascent: maxAscent,
  };
}

function renderLabelAtlas(glyphs: string[]): AtlasImage {
  const family = geistFamily();
  const spec = labelFontSpec(family);
  const ready = fontReady(spec);
  const fontKey = `${spec}:${ready ? "ready" : "pending"}`;

  const probe = makeCanvas(8, 8, true);
  const probeCtx = probe.getContext("2d");
  if (!probeCtx) throw new Error("Could not create a label atlas canvas.");
  probeCtx.font = spec;
  probeCtx.textAlign = "center";
  probeCtx.textBaseline = "alphabetic";
  const { cellW, cellH, ascent } = measureLabelCell(probeCtx as CanvasRenderingContext2D, glyphs);

  const cols = glyphs.length;
  const rows = 1;
  const canvas = makeCanvas(cols * cellW, rows * cellH, true);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a label atlas canvas.");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = spec;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D).letterSpacing = "0px";
  if ("fontKerning" in ctx) (ctx as CanvasRenderingContext2D).fontKerning = "none";

  const padY = Math.ceil(LABEL_FONT_PX * 0.08);
  const baseline = padY + ascent;
  glyphs.forEach((ch, i) => {
    ctx.fillText(ch, i * cellW + cellW / 2, baseline);
  });

  return {
    canvas,
    cols,
    rows,
    count: glyphs.length,
    cellAspect: cellW / cellH,
    fontKey,
  };
}

/** Renders the character ramp into a square-ish atlas (white glyphs on black). */
export function renderCharsetAtlas(params: Record<string, ParamValue>, options?: AtlasOptions): AtlasImage {
  const glyphs = glyphList(options?.charset || charsetFromParams(params));
  if (options?.style === "label") {
    return renderLabelAtlas(glyphs);
  }

  const cols = Math.max(1, Math.ceil(Math.sqrt(glyphs.length)));
  const rows = Math.max(1, Math.ceil(glyphs.length / cols));
  const width = cols * CELL;
  const height = rows * CELL;
  const canvas = makeCanvas(width, height, false);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create an ASCII atlas canvas.");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${CELL * 0.72}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  glyphs.forEach((ch, i) => {
    const x = (i % cols) * CELL + CELL / 2;
    const y = Math.floor(i / cols) * CELL + CELL / 2;
    ctx.fillText(ch, x, y);
  });
  return { canvas, cols, rows, count: glyphs.length, cellAspect: 1, fontKey: "ascii" };
}
