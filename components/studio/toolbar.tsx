"use client";

import * as React from "react";
import {
  Download,
  EyeOff,
  Hand,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useImportFiles } from "@/components/studio/use-import";
import { usePersistenceStatus } from "@/components/studio/use-persistence";
import { clearWorkspace, type PersistenceStatus } from "@/lib/persistence";
import { useStudio } from "@/lib/store";
import type { Tool } from "@/lib/types";
import { useEngine } from "@/components/studio/engine-context";

const SAVE_LABEL: Record<PersistenceStatus, string | null> = {
  idle: null,
  saving: "Saving…",
  saved: "Saved locally",
  error: "Not saved",
  unavailable: "Local save unavailable",
};

function Hint({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-2">
        {label}
        {shortcut && <kbd className="rounded bg-white/15 px-1 font-mono text-[10px]">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

export function Toolbar() {
  const tool = useStudio((s) => s.tool);
  const setTool = useStudio((s) => s.setTool);
  const zoom = useStudio((s) => s.viewport.zoom);
  const zoomCenter = useStudio((s) => s.zoomCenter);
  const zoomTo = useStudio((s) => s.zoomTo);
  const fitAll = useStudio((s) => s.fitAll);
  const fitSelection = useStudio((s) => s.fitSelection);
  const hasFrames = useStudio((s) => s.frames.length > 0);
  const selectedId = useStudio((s) => s.selectedId);
  const setExportOpen = useStudio((s) => s.setExportOpen);
  const toggleUi = useStudio((s) => s.toggleUi);
  const { openPicker, busy } = useImportFiles();
  const { status } = useEngine();
  const saveStatus = usePersistenceStatus();
  const hasAssets = useStudio((s) => s.assets.length > 0);
  const [clearing, setClearing] = React.useState(false);

  const onClear = async () => {
    if (!confirm("Remove every frame and asset? This also wipes the workspace saved in this browser.")) return;
    setClearing(true);
    try {
      await clearWorkspace();
    } finally {
      setClearing(false);
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
      <div className="flex items-center gap-2 pr-1">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </div>
        <div className="leading-none">
          <div className="text-sm font-semibold">Shader Studio</div>
          <div className="text-[10px] text-muted-foreground">
            {status === "ready"
              ? "WebGPU · vgpu"
              : status === "booting"
                ? "Starting GPU…"
                : "GPU unavailable"}
            {SAVE_LABEL[saveStatus] && ` · ${SAVE_LABEL[saveStatus]}`}
          </div>
        </div>
      </div>

      <Separator orientation="vertical" className="mx-1 h-6!" />

      <ToggleGroup
        type="single"
        value={tool}
        onValueChange={(v) => v && setTool(v as Tool)}
        variant="outline"
        size="sm"
      >
        <Hint label="Select / Move" shortcut="V">
          <ToggleGroupItem value="select" aria-label="Select tool">
            <MousePointer2 />
          </ToggleGroupItem>
        </Hint>
        <Hint label="Hand (pan)" shortcut="H">
          <ToggleGroupItem value="hand" aria-label="Hand tool">
            <Hand />
          </ToggleGroupItem>
        </Hint>
      </ToggleGroup>

      <Separator orientation="vertical" className="mx-1 h-6!" />

      <Hint label="Import images or videos" shortcut="⌘I">
        <Button
          variant="outline"
          size="sm"
          onClick={() => openPicker()}
          disabled={busy || status !== "ready"}
        >
          <Upload data-icon="inline-start" />
          Import
        </Button>
      </Hint>

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        <Hint label="Zoom out" shortcut="−">
          <Button variant="ghost" size="icon-sm" onClick={() => zoomCenter(1 / 1.25)}>
            <Minus />
          </Button>
        </Hint>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="w-16 font-mono tabular-nums">
              {Math.round(zoom * 100)}%
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => zoomCenter(1.25)}>
              Zoom in <DropdownMenuShortcut>+</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => zoomCenter(1 / 1.25)}>
              Zoom out <DropdownMenuShortcut>−</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => zoomTo(1)}>
              Zoom to 100% <DropdownMenuShortcut>⇧0</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => zoomTo(0.5)}>Zoom to 50%</DropdownMenuItem>
            <DropdownMenuItem onClick={() => zoomTo(2)}>Zoom to 200%</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={fitAll} disabled={!hasFrames}>
              Zoom to fit <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={fitSelection} disabled={!selectedId}>
              Zoom to selection <DropdownMenuShortcut>⇧2</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Hint label="Zoom in" shortcut="+">
          <Button variant="ghost" size="icon-sm" onClick={() => zoomCenter(1.25)}>
            <Plus />
          </Button>
        </Hint>
        <Hint label="Zoom to fit" shortcut="⇧1">
          <Button variant="ghost" size="icon-sm" onClick={fitAll} disabled={!hasFrames}>
            <Maximize2 />
          </Button>
        </Hint>
      </div>

      <Separator orientation="vertical" className="mx-1 h-6!" />

      <Hint label="Hide UI" shortcut="⌘\">
        <Button variant="ghost" size="icon-sm" aria-label="Hide UI" onClick={toggleUi}>
          <EyeOff />
        </Button>
      </Hint>

      <Hint label="Clear workspace">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear workspace"
          onClick={onClear}
          disabled={!hasAssets || clearing}
        >
          <Trash2 />
        </Button>
      </Hint>

      <Hint label="Export selected frame" shortcut="⌘E">
        <Button size="sm" onClick={() => setExportOpen(true)} disabled={!selectedId || status !== "ready"}>
          <Download data-icon="inline-start" />
          Export
        </Button>
      </Hint>
    </header>
  );
}
