import type { ParamValue } from "@/lib/shaders/registry";
import { charsetFromParams } from "@/lib/shaders/extra";

const CELL = 64;
const MAX_CHARS = 96;

export interface AtlasImage {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  cols: number;
  rows: number;
  count: number;
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

/** Renders the character ramp into a square-ish atlas (white glyphs on black). */
export function renderCharsetAtlas(params: Record<string, ParamValue>): AtlasImage {
  const glyphs = glyphList(charsetFromParams(params));
  const cols = Math.max(1, Math.ceil(Math.sqrt(glyphs.length)));
  const rows = Math.max(1, Math.ceil(glyphs.length / cols));
  const width = cols * CELL;
  const height = rows * CELL;
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
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
  return { canvas, cols, rows, count: glyphs.length };
}
