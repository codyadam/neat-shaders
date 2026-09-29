"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { hueOf, hueToRgb, normalizeColorRange, type ColorRangeValue } from "@/lib/shaders/param-values";
import { cn } from "@/lib/utils";

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function wrapWidth(start: number, end: number): number {
  const w = (end - start + 1) % 1;
  return w === 0 ? 1 : w;
}

function recenter(range: ColorRangeValue, color: [number, number, number]): ColorRangeValue {
  const hue = hueOf(color[0], color[1], color[2]);
  const width = Math.max(0.04, wrapWidth(range.start, range.end));
  const half = width / 2;
  return {
    color,
    start: (hue - half + 1) % 1,
    end: (hue + half) % 1,
    softness: range.softness,
  };
}

export function ColorRangeControl({
  label,
  value,
  fallback,
  onChange,
  disabled,
}: {
  label: string;
  value: ColorRangeValue;
  fallback: ColorRangeValue;
  onChange: (value: ColorRangeValue) => void;
  disabled?: boolean;
}) {
  const range = normalizeColorRange(value, fallback);
  const barRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<null | { mode: "start" | "end" | "move"; start: number; end: number; origin: number }>(null);

  const hueAt = (event: React.PointerEvent) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };

  const segments = range.start <= range.end
    ? [{ left: range.start, width: range.end - range.start }]
    : [
        { left: 0, width: range.end },
        { left: range.start, width: 1 - range.start },
      ];

  const swatch = hueToRgb((range.start + wrapWidth(range.start, range.end) / 2) % 1);

  return (
    <div className={cn("space-y-2", disabled && "pointer-events-none opacity-50")}>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {Math.round(range.start * 360)}–{Math.round(range.end * 360)}°
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} color`}
          value={rgbToHex(range.color)}
          disabled={disabled}
          onChange={(e) => onChange(recenter(range, hexToRgb(e.target.value)))}
          className="size-7 shrink-0 cursor-pointer rounded-full border bg-transparent p-0.5"
          style={{ boxShadow: `0 0 0 2px rgb(${swatch.map((c) => Math.round(c * 255)).join(" ")})` }}
        />
        <div
          ref={barRef}
          className="relative h-7 flex-1 touch-none overflow-hidden rounded-full border"
          style={{
            background:
              "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
          }}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            const hue = hueAt(event);
            drag.current = { mode: "move", start: range.start, end: range.end, origin: hue };
            const width = wrapWidth(range.start, range.end);
            const half = width / 2;
            onChange({
              ...range,
              start: (hue - half + 1) % 1,
              end: (hue + half) % 1,
            });
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (!current) return;
            const hue = hueAt(event);
            if (current.mode === "start") {
              onChange({ ...range, start: hue });
              return;
            }
            if (current.mode === "end") {
              onChange({ ...range, end: hue });
              return;
            }
            const delta = hue - current.origin;
            onChange({
              ...range,
              start: (current.start + delta + 1) % 1,
              end: (current.end + delta + 1) % 1,
            });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        >
          {segments.map((seg) => (
            <div
              key={`${seg.left}`}
              className="absolute inset-y-0 bg-white/25"
              style={{ left: `${seg.left * 100}%`, width: `${Math.max(seg.width, 0.01) * 100}%` }}
            />
          ))}
          {[
            { mode: "start" as const, at: range.start },
            { mode: "end" as const, at: range.end },
          ].map((handle) => (
            <button
              key={handle.mode}
              type="button"
              aria-label={handle.mode === "start" ? "Range start" : "Range end"}
              className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-neutral-900 shadow"
              style={{ left: `${handle.at * 100}%` }}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (disabled) return;
                drag.current = { mode: handle.mode, start: range.start, end: range.end, origin: hueAt(event) };
                barRef.current?.setPointerCapture(event.pointerId);
              }}
            />
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Softness</span>
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {Math.round(range.softness * 1000) / 10}
          </span>
        </div>
        <Slider
          min={0.001}
          max={0.2}
          step={0.001}
          value={[range.softness]}
          disabled={disabled}
          onValueChange={([softness]) => onChange({ ...range, softness })}
        />
      </div>
    </div>
  );
}
