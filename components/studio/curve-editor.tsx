"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CURVE_MAX_POINTS, IDENTITY_CURVE, normalizeCurve, type CurvePoint } from "@/lib/shaders/param-values";
import { cn } from "@/lib/utils";

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function CurveEditor({
  label,
  value,
  onChange,
  disabled,
  description,
}: {
  label: string;
  value: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
  disabled?: boolean;
  description?: string;
}) {
  const points = normalizeCurve(value);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<number | null>(null);

  const toLocal = (event: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01(1 - (event.clientY - rect.top) / rect.height),
    };
  };

  const movePoint = (index: number, x: number, y: number) => {
    const next = points.map((p) => ({ ...p }));
    if (index === 0) next[0] = { x: 0, y };
    else if (index === next.length - 1) next[index] = { x: 1, y };
    else {
      const minX = next[index - 1].x + 0.01;
      const maxX = next[index + 1].x - 0.01;
      next[index] = { x: Math.min(maxX, Math.max(minX, x)), y };
    }
    onChange(next);
  };

  const addPoint = (x: number, y: number) => {
    if (points.length >= CURVE_MAX_POINTS) return;
    const next = [...points.map((p) => ({ ...p })), { x: clamp01(x), y: clamp01(y) }];
    next.sort((a, b) => a.x - b.x);
    onChange(normalizeCurve(next));
  };

  const removePoint = (index: number) => {
    if (index === 0 || index === points.length - 1 || points.length <= 2) return;
    onChange(points.filter((_, i) => i !== index));
  };

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * 100} ${(1 - p.y) * 100}`).join(" ");

  return (
    <div className={cn("space-y-1.5", disabled && "pointer-events-none opacity-50")}>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-6 px-1.5 text-[10px]"
          disabled={disabled}
          onClick={() => onChange(IDENTITY_CURVE.map((p) => ({ ...p })))}
        >
          Reset
        </Button>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        className="aspect-square w-full touch-none rounded-md border bg-muted/40"
        role="img"
        aria-label={description ?? `${label} curve`}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          const local = toLocal(event);
          const hit = points.findIndex((p) => {
            const dx = (p.x - local.x) * (svgRef.current?.clientWidth ?? 100);
            const dy = ((1 - p.y) - (1 - local.y)) * (svgRef.current?.clientHeight ?? 100);
            return dx * dx + dy * dy < 12 * 12;
          });
          if (hit >= 0) {
            drag.current = hit;
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
          }
          addPoint(local.x, local.y);
        }}
        onPointerMove={(event) => {
          if (drag.current == null) return;
          const local = toLocal(event);
          movePoint(drag.current, local.x, local.y);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        {[25, 50, 75].map((g) => (
          <g key={g} stroke="currentColor" className="text-muted-foreground/30" strokeWidth="0.4">
            <line x1={g} y1="0" x2={g} y2="100" />
            <line x1="0" y1={g} x2="100" y2={g} />
          </g>
        ))}
        <line x1="0" y1="100" x2="100" y2="0" stroke="currentColor" className="text-muted-foreground/25" strokeWidth="0.5" />
        <path d={d} fill="none" stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle
            key={`${i}-${p.x}`}
            cx={p.x * 100}
            cy={(1 - p.y) * 100}
            r="2.6"
            fill="#171717"
            stroke="white"
            strokeWidth="1.1"
            onDoubleClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              removePoint(i);
            }}
          />
        ))}
      </svg>
    </div>
  );
}
