"use client";

import type { ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyFrameStack, pasteFrameStack } from "@/components/studio/stack-clipboard";
import { MAX_LAYERS } from "@/lib/shaders/layers";
import { getShader } from "@/lib/shaders/registry";
import { useStudio } from "@/lib/store";
import type { Frame, ShaderLayer } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ShaderStackList({ frame }: { frame: Frame }) {
  const { addLayer } = useStudio.getState();
  const layers = [...frame.layers].reverse();

  return (
    <ul className="border-l border-border/70 pl-1">
      {layers.map((layer) => (
        <ShaderLayerRow key={layer.id} frame={frame} layer={layer} />
      ))}
      <li className="flex items-center gap-0.5">
        <button
          type="button"
          disabled={frame.layers.length >= MAX_LAYERS}
          onClick={() => addLayer(frame.id)}
          className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
        >
          <Plus className="size-3" />
          Add shader
        </button>
        <IconButton label="Copy stack" onClick={() => void copyFrameStack(frame)}>
          <ClipboardCopy />
        </IconButton>
        <IconButton label="Paste stack" onClick={() => void pasteFrameStack(frame.id)}>
          <ClipboardPaste />
        </IconButton>
      </li>
    </ul>
  );
}

export function ShaderLayerRow({ frame, layer }: { frame: Frame; layer: ShaderLayer }) {
  const selected = useStudio((s) => s.selectedId === frame.id && s.selectedLayerId === layer.id);
  const { selectLayer, updateLayer, removeLayer, duplicateLayer, reorderLayer } = useStudio.getState();
  const shader = getShader(layer.shaderId);

  return (
    <li
      className={cn(
        "group flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px]",
        selected ? "bg-(--selection)/15 text-foreground" : "hover:bg-muted/60",
        !layer.visible && "opacity-50",
      )}
      onClick={(e) => {
        e.stopPropagation();
        selectLayer(frame.id, layer.id);
      }}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/70" />
      <span className="min-w-0 flex-1 truncate" title={shader.name}>
        {shader.name}
      </span>
      <div className="hidden items-center group-hover:flex">
        <IconButton label="Move up" onClick={() => reorderLayer(frame.id, layer.id, "up")}>
          <ChevronUp />
        </IconButton>
        <IconButton label="Move down" onClick={() => reorderLayer(frame.id, layer.id, "down")}>
          <ChevronDown />
        </IconButton>
        <IconButton label="Duplicate" onClick={() => duplicateLayer(frame.id, layer.id)}>
          <Copy />
        </IconButton>
        {frame.layers.length > 1 && (
          <IconButton label="Delete" onClick={() => removeLayer(frame.id, layer.id)}>
            <Trash2 />
          </IconButton>
        )}
      </div>
      <IconButton
        label={layer.visible ? "Hide" : "Show"}
        className={cn(layer.visible && "hidden group-hover:inline-flex")}
        onClick={() => updateLayer(frame.id, layer.id, { visible: !layer.visible })}
      >
        {layer.visible ? <Eye /> : <EyeOff />}
      </IconButton>
    </li>
  );
}

export function IconButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn("text-muted-foreground hover:text-foreground", className)}
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
