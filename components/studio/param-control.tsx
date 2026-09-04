"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ParamDef, ParamValue } from "@/lib/shaders/registry";
import { cn } from "@/lib/utils";

interface ParamControlProps {
  def: ParamDef;
  value: ParamValue;
  onChange: (value: ParamValue) => void;
}

function decimalsFor(step: number): number {
  if (step >= 1) return 0;
  return Math.min(6, Math.ceil(-Math.log10(step)));
}

function ParamLabel({ def, htmlFor }: { def: ParamDef; htmlFor?: string }) {
  const label = (
    <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
      {def.label}
    </Label>
  );
  if (!def.description) return label;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-2">{label}</span>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-56">
        {def.description}
      </TooltipContent>
    </Tooltip>
  );
}

/** Numeric input that commits on blur/Enter and supports drag-free typing without fighting the slider. */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  className,
  id,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  id?: string;
  suffix?: string;
}) {
  const decimals = decimalsFor(step ?? 1);
  const format = (v: number) => {
    if (!Number.isFinite(v)) return "";
    const fixed = v.toFixed(decimals);
    return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  };
  const [text, setText] = React.useState(format(value));
  const [focused, setFocused] = React.useState(false);
  const [syncedValue, setSyncedValue] = React.useState(value);

  // Mirror external value changes into the text while the field is not being edited.
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (!focused) setText(format(value));
  }

  const commit = () => {
    const n = Number.parseFloat(text);
    if (Number.isFinite(n)) {
      let v = n;
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      onChange(v);
      setText(format(v));
    } else {
      setText(format(value));
    }
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const delta = (step ?? 1) * (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
            let v = value + delta;
            if (min !== undefined) v = Math.max(min, v);
            if (max !== undefined) v = Math.min(max, v);
            onChange(Number(v.toFixed(6)));
          }
        }}
        className={cn("h-7 px-2 font-mono text-xs tabular-nums", suffix && "pr-5")}
      />
      {suffix && (
        <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[10px] text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

function ScalarControl({
  def,
  value,
  onChange,
}: {
  def: Extract<ParamDef, { type: "float" | "int" }>;
  value: number;
  onChange: (v: number) => void;
}) {
  const step = def.type === "int" ? (def.step ?? 1) : def.step;
  const id = `param-${def.key}`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <ParamLabel def={def} htmlFor={id} />
        <NumberField
          id={id}
          value={value}
          onChange={(v) => onChange(def.type === "int" ? Math.round(v) : v)}
          min={def.min}
          max={def.max}
          step={step}
          className="w-20"
        />
      </div>
      <Slider
        min={def.min}
        max={def.max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(def.type === "int" ? Math.round(v) : v)}
      />
    </div>
  );
}

function Vec2Control({
  def,
  value,
  onChange,
}: {
  def: Extract<ParamDef, { type: "vec2" }>;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const labels = def.labels ?? ["X", "Y"];
  return (
    <div className="space-y-1.5">
      <ParamLabel def={def} />
      <div className="grid grid-cols-2 gap-2">
        {([0, 1] as const).map((i) => (
          <div key={i} className="space-y-1">
            <NumberField
              value={value[i]}
              onChange={(v) => {
                const next: [number, number] = [value[0], value[1]];
                next[i] = v;
                onChange(next);
              }}
              min={def.min}
              max={def.max}
              step={def.step}
              suffix={labels[i]}
            />
            <Slider
              min={def.min}
              max={def.max}
              step={def.step}
              value={[value[i]]}
              onValueChange={([v]) => {
                const next: [number, number] = [value[0], value[1]];
                next[i] = v;
                onChange(next);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

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

export function ParamControl({ def, value, onChange }: ParamControlProps) {
  switch (def.type) {
    case "float":
    case "int":
      return <ScalarControl def={def} value={Number(value)} onChange={onChange} />;
    case "vec2":
      return (
        <Vec2Control
          def={def}
          value={Array.isArray(value) && value.length === 2 ? value : def.default}
          onChange={onChange}
        />
      );
    case "bool":
      return (
        <div className="flex items-center justify-between">
          <ParamLabel def={def} htmlFor={`param-${def.key}`} />
          <Switch id={`param-${def.key}`} checked={Boolean(value)} onCheckedChange={onChange} />
        </div>
      );
    case "color": {
      const rgb = Array.isArray(value) && value.length === 3 ? value : def.default;
      const hex = rgbToHex(rgb);
      return (
        <div className="flex items-center justify-between">
          <ParamLabel def={def} htmlFor={`param-${def.key}`} />
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground uppercase">{hex}</span>
            <input
              id={`param-${def.key}`}
              type="color"
              value={hex}
              onChange={(e) => onChange(hexToRgb(e.target.value))}
              className="size-7 cursor-pointer rounded-md border bg-transparent p-0.5"
            />
          </div>
        </div>
      );
    }
  }
}
