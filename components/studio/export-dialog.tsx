"use client";

import * as React from "react";
import { Download, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NumberField } from "@/components/studio/param-control";
import { useEngine } from "@/components/studio/engine-context";
import {
  downloadBlob,
  exportImage,
  exportVideo,
  formatBytes,
  formatDuration,
  safeFilename,
  supportedVideoFormats,
  type ImageFormat,
} from "@/lib/gpu/export";
import { getShader } from "@/lib/shaders/registry";
import { selectSelectedFrame, useStudio } from "@/lib/store";
import type { Asset, Frame } from "@/lib/types";

const SCALE_PRESETS = [0.25, 0.5, 1, 2];

export function ExportDialog() {
  const open = useStudio((s) => s.exportOpen);
  const setOpen = useStudio((s) => s.setExportOpen);
  const frame = useStudio(selectSelectedFrame);
  const asset = useStudio((s) => s.assets.find((a) => a.id === frame?.assetId));
  const [busy, setBusy] = React.useState(false);

  return (
    <Dialog
      open={open && !!frame && !!asset}
      onOpenChange={(v) => {
        if (busy) return;
        setOpen(v);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        {frame && asset && (
          <ExportForm
            key={frame.id}
            frame={frame}
            asset={asset}
            busy={busy}
            setBusy={setBusy}
            close={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExportForm({
  frame,
  asset,
  busy,
  setBusy,
  close,
}: {
  frame: Frame;
  asset: Asset;
  busy: boolean;
  setBusy: (b: boolean) => void;
  close: () => void;
}) {
  const { engine } = useEngine();
  const isVideo = asset.kind === "video";
  const [videoFormats] = React.useState(() => supportedVideoFormats());
  const [mode, setMode] = React.useState<"image" | "video">(isVideo ? "video" : "image");
  const [scale, setScale] = React.useState(1);
  const [imageFormat, setImageFormat] = React.useState<ImageFormat>("png");
  const [quality, setQuality] = React.useState(0.92);
  const [filename, setFilename] = React.useState(`${safeFilename(frame.name)}-${frame.shaderId}`);
  const [fps, setFps] = React.useState(30);
  const [bitrate, setBitrate] = React.useState(12);
  const [videoMime, setVideoMime] = React.useState(videoFormats[0]?.mimeType ?? "");
  const [includeAudio, setIncludeAudio] = React.useState(Boolean(asset.hasAudio));
  const [progress, setProgress] = React.useState(0);
  const abortRef = React.useRef<AbortController | null>(null);

  const outW = Math.max(1, Math.round(asset.width * scale));
  const outH = Math.max(1, Math.round(asset.height * scale));
  const maxDim = engine ? engine.gpu.gpu.limits.maxTextureDimension2D : 8192;
  const tooLarge = Math.max(outW, outH) > maxDim;
  const selectedVideoFormat = videoFormats.find((f) => f.mimeType === videoMime);
  const audioCapable = selectedVideoFormat?.mimeType.includes(",") ?? false;

  const run = async () => {
    if (!engine) return;
    setBusy(true);
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (mode === "image") {
        const blob = await exportImage(engine, {
          frameId: frame.id,
          width: outW,
          height: outH,
          format: imageFormat,
          quality,
        });
        downloadBlob(blob, `${filename || "export"}.${imageFormat === "jpeg" ? "jpg" : imageFormat}`);
        toast.success("Image exported", { description: `${outW}×${outH} · ${formatBytes(blob.size)}` });
        close();
      } else {
        if (!selectedVideoFormat) throw new Error("No supported video format.");
        const blob = await exportVideo(engine, {
          frameId: frame.id,
          assetId: asset.id,
          width: outW,
          height: outH,
          fps,
          mimeType: selectedVideoFormat.mimeType,
          bitrateMbps: bitrate,
          includeAudio: includeAudio && audioCapable,
          onProgress: setProgress,
          signal: controller.signal,
        });
        downloadBlob(blob, `${filename || "export"}.${selectedVideoFormat.extension}`);
        toast.success("Video exported", {
          description: `${outW}×${outH} · ${formatDuration(asset.duration ?? 0)} · ${formatBytes(blob.size)}`,
        });
        close();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toast("Export cancelled");
      } else {
        console.error(err);
        toast.error("Export failed", { description: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Export “{frame.name}”</DialogTitle>
        <DialogDescription>
          {getShader(frame.shaderId).name} · source {asset.width}×{asset.height}
          {isVideo && asset.duration ? ` · ${formatDuration(asset.duration)}` : ""}
        </DialogDescription>
      </DialogHeader>

      {isVideo && (
        <Tabs value={mode} onValueChange={(v) => setMode(v as "image" | "video")}>
          <TabsList className="w-full">
            <TabsTrigger value="video" disabled={busy}>
              Video
            </TabsTrigger>
            <TabsTrigger value="image" disabled={busy}>
              Still frame
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">File name</Label>
          <Input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            disabled={busy}
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Scale</Label>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {outW} × {outH}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {SCALE_PRESETS.map((s) => (
                <Button
                  key={s}
                  variant={scale === s ? "secondary" : "outline"}
                  size="xs"
                  onClick={() => setScale(s)}
                  disabled={busy}
                >
                  {s}×
                </Button>
              ))}
            </div>
            <NumberField
              value={scale}
              onChange={setScale}
              min={0.05}
              max={8}
              step={0.05}
              className="w-20"
              suffix="×"
            />
          </div>
          {tooLarge && (
            <p className="text-[11px] text-destructive">
              Exceeds this GPU’s maximum texture size ({maxDim}px). Lower the scale.
            </p>
          )}
        </div>

        {mode === "image" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Format</Label>
                <Select
                  value={imageFormat}
                  onValueChange={(v) => setImageFormat(v as ImageFormat)}
                  disabled={busy}
                >
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="png" className="text-xs">
                      PNG (lossless)
                    </SelectItem>
                    <SelectItem value="jpeg" className="text-xs">
                      JPEG
                    </SelectItem>
                    <SelectItem value="webp" className="text-xs">
                      WebP
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Quality</Label>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {Math.round(quality * 100)}
                  </span>
                </div>
                <Slider
                  min={0.1}
                  max={1}
                  step={0.01}
                  value={[quality]}
                  onValueChange={([v]) => setQuality(v)}
                  disabled={imageFormat === "png" || busy}
                  className="pt-2.5"
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Container / codec</Label>
                <Select
                  value={videoMime}
                  onValueChange={setVideoMime}
                  disabled={busy || videoFormats.length === 0}
                >
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue placeholder="Unsupported" />
                  </SelectTrigger>
                  <SelectContent>
                    {videoFormats.map((f) => (
                      <SelectItem key={f.mimeType} value={f.mimeType} className="text-xs">
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Frame rate</Label>
                <Select value={String(fps)} onValueChange={(v) => setFps(Number(v))} disabled={busy}>
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[24, 25, 30, 50, 60].map((f) => (
                      <SelectItem key={f} value={String(f)} className="text-xs">
                        {f} fps
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Bitrate</Label>
                <span className="font-mono text-[11px] text-muted-foreground">{bitrate} Mbps</span>
              </div>
              <Slider
                min={1}
                max={60}
                step={1}
                value={[bitrate]}
                onValueChange={([v]) => setBitrate(v)}
                disabled={busy}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="export-audio" className="text-xs">
                  Include audio
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  {!asset.hasAudio
                    ? "Source has no audio track."
                    : audioCapable
                      ? "Copies the source audio into the export."
                      : "Pick a codec with audio (e.g. VP9 + Opus)."}
                </p>
              </div>
              <Switch
                id="export-audio"
                checked={includeAudio && audioCapable && Boolean(asset.hasAudio)}
                onCheckedChange={setIncludeAudio}
                disabled={busy || !audioCapable || !asset.hasAudio}
              />
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              The video plays once from the start while the shader output is recorded in real time (
              {formatDuration(asset.duration ?? 0)}).
            </p>
          </>
        )}

        {busy && mode === "video" && (
          <div className="space-y-1.5">
            <Progress value={progress * 100} />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Recording…</span>
              <span className="font-mono">{Math.round(progress * 100)}%</span>
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        {busy ? (
          <Button variant="outline" onClick={() => abortRef.current?.abort()}>
            <X data-icon="inline-start" />
            Cancel
          </Button>
        ) : (
          <Button variant="outline" onClick={close}>
            Close
          </Button>
        )}
        <Button onClick={run} disabled={busy || tooLarge || (mode === "video" && !selectedVideoFormat)}>
          {busy ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <Download data-icon="inline-start" />
          )}
          {mode === "image" ? "Export image" : "Export video"}
        </Button>
      </DialogFooter>
    </>
  );
}
