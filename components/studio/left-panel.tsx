"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Film,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ASSET_DRAG_TYPE } from "@/components/studio/canvas-viewport";
import { useImportFiles } from "@/components/studio/use-import";
import { useEngine } from "@/components/studio/engine-context";
import { formatBytes, formatDuration } from "@/lib/gpu/export";
import { releaseMedia } from "@/lib/gpu/media";
import { getShader } from "@/lib/shaders/registry";
import { useStudio, viewportCenterWorld } from "@/lib/store";
import type { Asset, Frame } from "@/lib/types";
import { cn, truncateName } from "@/lib/utils";

export function LeftPanel() {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-background">
      <Tabs defaultValue="layers" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList variant="line" className="h-10 w-full justify-start rounded-none border-b px-2">
          <TabsTrigger value="layers" className="flex-none px-2">
            Layers
          </TabsTrigger>
          <TabsTrigger value="assets" className="flex-none px-2">
            Assets
          </TabsTrigger>
        </TabsList>
        <TabsContent value="layers" className="min-h-0 flex-1">
          <LayersTab />
        </TabsContent>
        <TabsContent value="assets" className="min-h-0 flex-1">
          <AssetsTab />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function LayersTab() {
  const frames = useStudio((s) => s.frames);
  const ordered = React.useMemo(() => [...frames].reverse(), [frames]);

  if (frames.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">No frames yet. Import media to create one.</div>
    );
  }
  return (
    <ScrollArea className="h-full">
      <ul className="p-1.5">
        {ordered.map((f) => (
          <LayerRow key={f.id} frame={f} />
        ))}
      </ul>
    </ScrollArea>
  );
}

function LayerRow({ frame }: { frame: Frame }) {
  const selected = useStudio((s) => s.selectedId === frame.id);
  const asset = useStudio((s) => s.assets.find((a) => a.id === frame.assetId));
  const { select, updateFrame, removeFrame, duplicateFrame, reorderFrame } = useStudio.getState();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(frame.name);

  const commit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== frame.name) updateFrame(frame.id, { name });
    else setDraft(frame.name);
  };

  return (
    <li
      className={cn(
        "group flex h-8 items-center gap-1.5 rounded-md px-1.5 text-xs",
        selected ? "bg-(--selection)/15 text-foreground" : "hover:bg-muted/60",
        !frame.visible && "opacity-50",
      )}
      onClick={() => select(frame.id)}
      onDoubleClick={() => {
        setDraft(frame.name);
        setEditing(true);
      }}
    >
      {asset?.kind === "video" ? (
        <Film className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(frame.name);
              setEditing(false);
            }
          }}
          className="h-6 min-w-0 flex-1 rounded border bg-background px-1 outline-none"
        />
      ) : (
        <span className="flex min-w-0 flex-1 items-baseline gap-1" title={frame.name}>
          <span className="min-w-0 truncate">{truncateName(frame.name)}</span>
          <span className="shrink-0 truncate text-muted-foreground">· {getShader(frame.shaderId).name}</span>
        </span>
      )}

      <div className="hidden items-center group-hover:flex">
        <IconButton label="Move up" onClick={() => reorderFrame(frame.id, "up")}>
          <ChevronUp />
        </IconButton>
        <IconButton label="Move down" onClick={() => reorderFrame(frame.id, "down")}>
          <ChevronDown />
        </IconButton>
        <IconButton label="Duplicate" onClick={() => duplicateFrame(frame.id)}>
          <Copy />
        </IconButton>
        <IconButton label="Delete" onClick={() => removeFrame(frame.id)}>
          <Trash2 />
        </IconButton>
      </div>
      <IconButton
        label={frame.locked ? "Unlock" : "Lock"}
        className={cn(!frame.locked && "hidden group-hover:inline-flex")}
        onClick={() => updateFrame(frame.id, { locked: !frame.locked })}
      >
        {frame.locked ? <Lock /> : <LockOpen />}
      </IconButton>
      <IconButton
        label={frame.visible ? "Hide" : "Show"}
        className={cn(frame.visible && "hidden group-hover:inline-flex")}
        onClick={() => updateFrame(frame.id, { visible: !frame.visible })}
      >
        {frame.visible ? <Eye /> : <EyeOff />}
      </IconButton>
    </li>
  );
}

function IconButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
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

function AssetsTab() {
  const assets = useStudio((s) => s.assets);
  const { openPicker, busy } = useImportFiles();
  const { status } = useEngine();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {assets.length} {assets.length === 1 ? "asset" : "assets"}
        </span>
        <Button
          variant="outline"
          size="xs"
          onClick={() => openPicker({ placeFrames: false })}
          disabled={busy || status !== "ready"}
        >
          <Upload data-icon="inline-start" />
          Add
        </Button>
      </div>
      {assets.length === 0 ? (
        <div className="p-4 text-xs text-muted-foreground">
          Imported images and videos appear here. Drag one onto the canvas to create another frame from it.
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="grid grid-cols-2 gap-2 p-2">
            {assets.map((a) => (
              <AssetCard key={a.id} asset={a} />
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}

function AssetCard({ asset }: { asset: Asset }) {
  const usage = useStudio((s) => s.frames.filter((f) => f.assetId === asset.id).length);
  const { addFrame, removeAsset } = useStudio.getState();

  const place = () => {
    const c = viewportCenterWorld();
    addFrame({ assetId: asset.id, x: c.x - asset.width / 2, y: c.y - asset.height / 2 });
  };

  return (
    <li
      className="group relative overflow-hidden rounded-lg border bg-muted/40"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDoubleClick={place}
      title={`${asset.name}\n${asset.width}×${asset.height} · ${formatBytes(asset.fileSize)}`}
    >
      <div
        className="aspect-square w-full bg-cover bg-center"
        style={{ backgroundImage: `url(${asset.thumbnail})` }}
      />
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 to-transparent p-1.5 text-[10px] text-white">
        <div className="truncate font-medium">{truncateName(asset.name)}</div>
        <div className="flex items-center gap-1 opacity-80">
          {asset.kind === "video" ? <Film className="size-2.5" /> : <ImageIcon className="size-2.5" />}
          {asset.width}×{asset.height}
          {asset.duration ? ` · ${formatDuration(asset.duration)}` : ""}
        </div>
      </div>
      <div className="absolute top-1 right-1 hidden gap-0.5 group-hover:flex">
        <Button
          size="icon-xs"
          variant="secondary"
          aria-label="Add to canvas"
          onClick={place}
          className="shadow"
        >
          <Plus />
        </Button>
        <Button
          size="icon-xs"
          variant="secondary"
          aria-label="Remove asset"
          className="shadow"
          onClick={() => {
            if (usage > 0 && !confirm(`Remove "${truncateName(asset.name)}" and its ${usage} frame(s)?`)) return;
            removeAsset(asset.id);
            releaseMedia(asset.id);
            URL.revokeObjectURL(asset.url);
          }}
        >
          <Trash2 />
        </Button>
      </div>
      {usage > 0 && (
        <span className="absolute top-1 left-1 rounded bg-black/60 px-1 font-mono text-[9px] text-white group-hover:hidden">
          ×{usage}
        </span>
      )}
    </li>
  );
}
