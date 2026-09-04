"use client";

import * as React from "react";
import { Download, Link2, Link2Off, Pause, Play, Repeat, RotateCcw, Scan } from "lucide-react";
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
import { formatBytes, formatDuration } from "@/lib/gpu/export";
import { getVideo } from "@/lib/gpu/media";
import { SHADERS, getShader } from "@/lib/shaders/registry";
import { selectSelectedFrame, useStudio } from "@/lib/store";
import type { Asset, Frame } from "@/lib/types";
import { truncateName } from "@/lib/utils";

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
            ["Export", "⌘ E"],
            ["Duplicate", "⌘ D"],
            ["Delete", "⌫"],
            ["Zoom to fit", "⇧ 1"],
            ["Zoom to selection", "⇧ 2"],
            ["Zoom 100%", "⇧ 0"],
            ["Hide / show UI", "⌘ \\"],
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
  const shader = getShader(frame.shaderId);
  const { setFrameShader, setFrameParam, resetFrameParams, setExportOpen } = useStudio.getState();

  return (
    <ScrollArea className="h-full">
      <FrameSection frame={frame} asset={asset} />
      <Separator />
      {asset && <MediaSection frame={frame} asset={asset} />}
      <Separator />
      <Section
        title="Shader"
        action={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={() => resetFrameParams(frame.id)}>
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Reset parameters</TooltipContent>
          </Tooltip>
        }
      >
        <Select value={frame.shaderId} onValueChange={(v) => setFrameShader(frame.id, v)}>
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHADERS.map((s) => (
              <SelectItem key={s.id} value={s.id} className="text-xs">
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] leading-snug text-muted-foreground">{shader.description}</p>
        <div className="space-y-4 pt-1">
          {shader.params.map((p) => (
            <ParamControl
              key={p.key}
              def={p}
              value={frame.params[p.key] ?? p.default}
              onChange={(v) => setFrameParam(frame.id, p.key, v)}
            />
          ))}
        </div>
      </Section>
      <Separator />
      <Section title="Export">
        <Button className="w-full" size="sm" onClick={() => setExportOpen(true)}>
          <Download data-icon="inline-start" />
          Export {asset?.kind === "video" ? "video or still" : "image"}
        </Button>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Renders at the source resolution (or a scale of it), independent of the on-canvas size.
        </p>
      </Section>
    </ScrollArea>
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
