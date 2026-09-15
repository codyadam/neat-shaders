"use client";

import * as React from "react";
import { ClipboardCopy, ClipboardPaste, Download, Link2, Link2Off, Pause, Play, Plus, Repeat, RotateCcw, Scan, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NumberField, ParamControl } from "@/components/studio/param-control";
import { ParamGroup } from "@/components/studio/param-group";
import { ShaderCombobox } from "@/components/studio/shader-combobox";
import { ShaderStackList } from "@/components/studio/shader-stack-list";
import { copyFrameStack, pasteFrameStack } from "@/components/studio/stack-clipboard";
import { useImportFiles } from "@/components/studio/use-import";
import { formatBytes, formatDuration } from "@/lib/gpu/export";
import { getVideo } from "@/lib/gpu/media";
import {
  COLOR_MAP_CUSTOM_PRESET,
  COLOR_MAP_STOP_KEYS,
  colorMapStopsFromPreset,
  isColorMapStopKey,
} from "@/lib/shaders/color-map";
import { MAX_LAYERS } from "@/lib/shaders/layers";
import {
  SHADERS,
  getShader,
  groupParamDefs,
  isParamEnabled,
  type ParamValue,
} from "@/lib/shaders/registry";
import { selectSelectedFrame, selectSelectedLayer, useStudio } from "@/lib/store";
import type { Asset, Frame, ShaderLayer } from "@/lib/types";
import { truncateName, cn } from "@/lib/utils";

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 px-3 py-3">
      <div className="flex h-6 items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Inspector() {
  const frame = useStudio(selectSelectedFrame);
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l bg-background">
      {frame ? <FrameInspector frame={frame} /> : <EmptyInspector />}
    </aside>
  );
}

function EmptyInspector() {
  return (
    <ScrollArea className="h-full">
      <Section title="Shaders">
        <ul className="space-y-2">
          {SHADERS.map((s) => (
            <li key={s.id} className="rounded-lg border p-2.5">
              <div className="text-xs font-medium">{s.name}</div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.description}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {s.params.map((p) => (
                  <Badge key={p.key} variant="outline" className="h-4 px-1 text-[9px] font-normal">
                    {p.label}
                  </Badge>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Section>
      <Separator />
      <Section title="Shortcuts">
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-[11px]">
          {[
            ["Pan", "Space + drag · wheel"],
            ["Zoom", "⌘ + wheel · pinch"],
            ["Select / Hand", "V · H"],
            ["Import", "⌘ I"],
            ["Paste image or stack", "⌘ V"],
            ["Export", "⌘ E"],
            ["Duplicate", "⌘ D"],
            ["Delete", "⌫"],
            ["Zoom to fit", "⇧ 1"],
            ["Zoom to selection", "⇧ 2"],
            ["Zoom 100%", "⇧ 0"],
            ["Hide / show UI", "⇧ G"],
            ["Compare original", "Space (hold)"],
          ].map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-mono">{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      </Section>
    </ScrollArea>
  );
}

function FrameInspector({ frame }: { frame: Frame }) {
  const asset = useStudio((s) => s.assets.find((a) => a.id === frame.assetId));
  const layer = useStudio(selectSelectedLayer);
  const { setExportOpen } = useStudio.getState();

  return (
    <ScrollArea className="h-full">
      <FrameSection frame={frame} asset={asset} />
      <Separator />
      {asset && <MediaSection frame={frame} asset={asset} />}
      <Separator />
      <ShaderStackSection frame={frame} layer={layer} />
      <Separator />
      <Section title="Export">
        <Button className="w-full" size="sm" onClick={() => setExportOpen(true)}>
          <Download data-icon="inline-start" />
          Export {asset?.kind === "video" ? "video or still" : "image"}
        </Button>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Renders at the source resolution (or a scale of it), independent of on-canvas zoom. Export always includes the
          shader stack.
        </p>
      </Section>
    </ScrollArea>
  );
}

function ShaderStackSection({ frame, layer }: { frame: Frame; layer: ShaderLayer | null }) {
  const { addLayer } = useStudio.getState();
  return (
    <Section
      title="Shader stack"
      action={
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={() => void copyFrameStack(frame)}>
                <ClipboardCopy />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Copy stack</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={() => void pasteFrameStack(frame.id)}>
                <ClipboardPaste />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Paste stack</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={frame.layers.length >= MAX_LAYERS}
            onClick={() => addLayer(frame.id)}
          >
            <Plus />
          </Button>
        </div>
      }
    >
      <p className="text-[11px] leading-snug text-muted-foreground">
        Output of each layer feeds the next. Click a layer to edit it, or copy the stack as JSON onto another frame.
      </p>
      <ShaderStackList frame={frame} />
      {layer ? (
        <LayerEditor frame={frame} layer={layer} />
      ) : (
        <p className="text-[11px] leading-snug text-muted-foreground">Select a shader layer to edit its parameters.</p>
      )}
    </Section>
  );
}

function LayerEditor({ frame, layer }: { frame: Frame; layer: ShaderLayer }) {
  const shader = getShader(layer.shaderId);
  const assets = useStudio((s) => s.assets);
  const { setLayerShader, setLayerParam, setLayerParams, resetLayerParams, updateLayer } = useStudio.getState();
  const { openPicker, busy } = useImportFiles();
  const charsetPreset = Number(layer.params.charset_preset ?? 0);
  const colorMapPreset = Number(layer.params.preset ?? 0);
  const pixelSortInterval = Number(layer.params.interval ?? 0);
  const isPixelSort = layer.shaderId.startsWith("pixel-sort");
  const visibleParams = shader.params.filter((p) => {
    if (p.key === "charset" && charsetPreset !== 4) return false;
    if (shader.id === "color-map" && isColorMapStopKey(p.key) && colorMapPreset !== COLOR_MAP_CUSTOM_PRESET) {
      return false;
    }
    if (isPixelSort) {
      if (p.key === "length" && pixelSortInterval < 2) return false;
      if (p.key === "upper" && pixelSortInterval !== 0) return false;
      if (p.key === "lower" && pixelSortInterval > 1) return false;
      if (p.key === "invert_interval" && pixelSortInterval > 1) return false;
    }
    return true;
  });
  const paramGroups = groupParamDefs(visibleParams);
  const maskOn = Boolean(layer.maskAssetId);

  const renderParam = (p: (typeof shader.params)[number]) => (
    <ParamControl
      key={p.key}
      def={p}
      disabled={!isParamEnabled(p, layer.params)}
      value={layer.params[p.key] ?? p.default}
      onChange={(v) => {
        if (shader.id === "color-map" && p.key === "preset") {
          const next = Number(v);
          const patch: Record<string, ParamValue> = { preset: next };
          if (next === COLOR_MAP_CUSTOM_PRESET) {
            const stops = colorMapStopsFromPreset(colorMapPreset);
            COLOR_MAP_STOP_KEYS.forEach((key, i) => {
              const [r, g, b] = stops[i];
              patch[key] = [r, g, b];
            });
          }
          setLayerParams(frame.id, layer.id, patch);
          return;
        }
        setLayerParam(frame.id, layer.id, p.key, v);
      }}
    />
  );

  return (
    <div className="space-y-3 border-t border-border/70 pt-3">
      <div className="flex h-6 items-center justify-between">
        <h4 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Shader</h4>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={() => resetLayerParams(frame.id, layer.id)}>
              <RotateCcw />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Reset parameters</TooltipContent>
        </Tooltip>
      </div>
      <ShaderCombobox value={layer.shaderId} onChange={(id) => setLayerShader(frame.id, layer.id, id)} />
      <p className="text-[11px] leading-snug text-muted-foreground">{shader.description}</p>
      <div className="space-y-3 pt-1">
        {paramGroups.map((group) => (
          <ParamGroup key={group.title || "parameters"} title={group.title}>
            {group.params.map(renderParam)}
          </ParamGroup>
        ))}
      </div>
      <ParamGroup title="Blend">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Opacity</Label>
            <span className="font-mono text-[11px] tabular-nums">{layer.opacity.toFixed(2)}</span>
          </div>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={[layer.opacity]}
            onValueChange={([v]) => updateLayer(frame.id, layer.id, { opacity: v })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Mask</Label>
          <div className="flex gap-1">
            <Select
              value={layer.maskAssetId ?? "none"}
              onValueChange={(v) => updateLayer(frame.id, layer.id, { maskAssetId: v === "none" ? null : v })}
            >
              <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
                <SelectValue placeholder="No mask" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">
                  None
                </SelectItem>
                {assets.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="text-xs">
                    {truncateName(a.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={busy}
              onClick={async () => {
                const ids = await openPicker({ placeFrames: false });
                if (ids[0]) updateLayer(frame.id, layer.id, { maskAssetId: ids[0] });
              }}
            >
              <Upload data-icon="inline-start" />
              Import
            </Button>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Another imported image or video, used as a luma mask. A depth map here gives a depth-of-field look on blur.
          </p>
        </div>
        <div className={cn("flex items-center justify-between", !maskOn && "opacity-50")}>
          <Label className="text-xs text-muted-foreground" htmlFor="mask-invert">
            Invert mask
          </Label>
          <Switch
            id="mask-invert"
            size="sm"
            checked={layer.maskInvert}
            disabled={!maskOn}
            onCheckedChange={(v) => updateLayer(frame.id, layer.id, { maskInvert: v })}
          />
        </div>
        <div className={cn("space-y-1.5", !maskOn && "opacity-50")}>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Feather</Label>
            <span className="font-mono text-[11px] tabular-nums">{layer.maskFeather.toFixed(1)}</span>
          </div>
          <Slider
            min={0}
            max={8}
            step={0.1}
            value={[layer.maskFeather]}
            disabled={!maskOn}
            onValueChange={([v]) => updateLayer(frame.id, layer.id, { maskFeather: v })}
          />
        </div>
        <div className={cn("space-y-1.5", !maskOn && "opacity-50")}>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Mask contrast</Label>
            <span className="font-mono text-[11px] tabular-nums">{layer.maskContrast.toFixed(2)}</span>
          </div>
          <Slider
            min={0}
            max={4}
            step={0.05}
            value={[layer.maskContrast]}
            disabled={!maskOn}
            onValueChange={([v]) => updateLayer(frame.id, layer.id, { maskContrast: v })}
          />
        </div>
      </ParamGroup>
    </div>
  );
}

function FrameSection({ frame, asset }: { frame: Frame; asset?: Asset }) {
  const { updateFrame } = useStudio.getState();
  const [lockAspect, setLockAspect] = React.useState(true);
  const aspect = frame.width / Math.max(1, frame.height);

  const setSize = (patch: { width?: number; height?: number }) => {
    let { width, height } = { ...frame, ...patch };
    if (lockAspect) {
      if (patch.width !== undefined) height = Math.round(patch.width / aspect);
      if (patch.height !== undefined) width = Math.round(patch.height * aspect);
    }
    updateFrame(frame.id, { width: Math.max(1, width), height: Math.max(1, height) });
  };

  return (
    <Section
      title="Frame"
      action={
        <div className="flex items-center gap-1">
          <Label htmlFor="frame-visible" className="text-[11px] text-muted-foreground">
            Visible
          </Label>
          <Switch
            id="frame-visible"
            size="sm"
            checked={frame.visible}
            onCheckedChange={(v) => updateFrame(frame.id, { visible: v })}
          />
        </div>
      }
    >
      <Input
        value={frame.name}
        onChange={(e) => updateFrame(frame.id, { name: e.target.value })}
        className="h-8 text-xs"
        aria-label="Frame name"
      />
      <div className="grid grid-cols-2 gap-2">
        <Field label="X">
          <NumberField
            value={frame.x}
            onChange={(v) => updateFrame(frame.id, { x: Math.round(v) })}
            step={1}
          />
        </Field>
        <Field label="Y">
          <NumberField
            value={frame.y}
            onChange={(v) => updateFrame(frame.id, { y: Math.round(v) })}
            step={1}
          />
        </Field>
        <Field label="W">
          <NumberField
            value={frame.width}
            onChange={(v) => setSize({ width: Math.round(v) })}
            min={1}
            step={1}
          />
        </Field>
        <Field label="H">
          <NumberField
            value={frame.height}
            onChange={(v) => setSize({ height: Math.round(v) })}
            min={1}
            step={1}
          />
        </Field>
      </div>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={lockAspect ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => setLockAspect((v) => !v)}
              aria-label="Lock aspect ratio"
            >
              {lockAspect ? <Link2 /> : <Link2Off />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {lockAspect ? "Aspect ratio locked" : "Aspect ratio free"}
          </TooltipContent>
        </Tooltip>
        {asset && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateFrame(frame.id, { width: asset.width, height: asset.height })}
              >
                <Scan data-icon="inline-start" />
                Native size
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Resize to {asset.width} × {asset.height}
            </TooltipContent>
          </Tooltip>
        )}
        <div className="flex-1" />
        <Label htmlFor="frame-locked" className="text-[11px] text-muted-foreground">
          Lock
        </Label>
        <Switch
          id="frame-locked"
          size="sm"
          checked={frame.locked}
          onCheckedChange={(v) => updateFrame(frame.id, { locked: v })}
        />
      </div>
    </Section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3 text-[11px] text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function MediaSection({ frame, asset }: { frame: Frame; asset: Asset }) {
  const assets = useStudio((s) => s.assets);
  const { updateFrame } = useStudio.getState();
  return (
    <Section title="Media">
      <div className="flex gap-2.5">
        <div
          className="size-14 shrink-0 rounded-md border bg-cover bg-center"
          style={{ backgroundImage: `url(${asset.thumbnail})` }}
        />
        <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
          <div className="truncate font-medium" title={asset.name}>
            {truncateName(asset.name)}
          </div>
          <div className="text-muted-foreground">
            {asset.width} × {asset.height} · {formatBytes(asset.fileSize)}
          </div>
          <div className="text-muted-foreground">
            {asset.kind === "video" ? `Video · ${formatDuration(asset.duration ?? 0)}` : "Image"}
          </div>
        </div>
      </div>
      {assets.length > 1 && (
        <Select value={frame.assetId} onValueChange={(v) => updateFrame(frame.id, { assetId: v })}>
          <SelectTrigger className="h-8 w-full text-xs [&>span]:truncate">
            <SelectValue placeholder="Replace media" />
          </SelectTrigger>
          <SelectContent className="max-w-64">
            {assets.map((a) => (
              <SelectItem key={a.id} value={a.id} className="text-xs" title={a.name}>
                <span className="truncate">{truncateName(a.name)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {asset.kind === "video" && <VideoControls assetId={asset.id} />}
    </Section>
  );
}

interface VideoSnapshot {
  paused: boolean;
  loop: boolean;
  currentTime: number;
  duration: number;
}

function readVideo(assetId: string): VideoSnapshot | null {
  const v = getVideo(assetId);
  if (!v) return null;
  return { paused: v.paused, loop: v.loop, currentTime: v.currentTime, duration: v.duration || 0 };
}

function VideoControls({ assetId }: { assetId: string }) {
  const [snap, setSnap] = React.useState<VideoSnapshot | null>(() => readVideo(assetId));
  const scrubbingRef = React.useRef(false);

  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      setSnap((prev) => {
        const next = readVideo(assetId);
        if (
          prev &&
          next &&
          prev.paused === next.paused &&
          prev.loop === next.loop &&
          prev.currentTime === next.currentTime &&
          prev.duration === next.duration
        ) {
          return prev;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [assetId]);

  if (!snap) return null;

  return (
    <div className="space-y-2 rounded-lg border p-2">
      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={snap.paused ? "Play" : "Pause"}
          onClick={() => {
            const v = getVideo(assetId);
            if (!v) return;
            if (v.paused) void v.play();
            else v.pause();
          }}
        >
          {snap.paused ? <Play /> : <Pause />}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={snap.loop ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label="Loop"
              onClick={() => {
                const v = getVideo(assetId);
                if (v) v.loop = !v.loop;
              }}
            >
              <Repeat />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Loop playback</TooltipContent>
        </Tooltip>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
          {formatDuration(snap.currentTime)} / {formatDuration(snap.duration)}
        </span>
      </div>
      <Slider
        min={0}
        max={Math.max(0.01, snap.duration)}
        step={1 / 60}
        value={[snap.currentTime]}
        onValueChange={([t]) => {
          const v = getVideo(assetId);
          if (!v) return;
          if (!scrubbingRef.current) {
            scrubbingRef.current = true;
            v.pause();
          }
          v.currentTime = t;
        }}
        onValueCommit={() => {
          scrubbingRef.current = false;
        }}
      />
    </div>
  );
}
