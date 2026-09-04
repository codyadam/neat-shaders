"use client";

import type { StudioEngine } from "@/lib/gpu/engine";
import { getVideo } from "@/lib/gpu/media";

export type ImageFormat = "png" | "jpeg" | "webp";

export interface ImageExportOptions {
  frameId: string;
  width: number;
  height: number;
  format: ImageFormat;
  /** 0..1, ignored for PNG. */
  quality: number;
}

export interface VideoExportOptions {
  frameId: string;
  assetId: string;
  width: number;
  height: number;
  fps: number;
  mimeType: string;
  bitrateMbps: number;
  includeAudio: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export const IMAGE_MIME: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function exportImage(engine: StudioEngine, opts: ImageExportOptions): Promise<Blob> {
  const width = Math.max(1, Math.round(opts.width));
  const height = Math.max(1, Math.round(opts.height));
  const bytes = await engine.renderToBytes(opts.frameId, width, height);
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels.set(bytes.subarray(0, pixels.length));
  const imageData = new ImageData(pixels, width, height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is unavailable for encoding.");
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, IMAGE_MIME[opts.format], opts.format === "png" ? undefined : opts.quality),
  );
  if (!blob) throw new Error("Image encoding failed.");
  return blob;
}

export interface VideoCodecOption {
  label: string;
  mimeType: string;
  extension: string;
}

const VIDEO_CANDIDATES: VideoCodecOption[] = [
  { label: "MP4 (H.264)", mimeType: "video/mp4;codecs=avc1", extension: "mp4" },
  { label: "MP4 (H.264 + AAC)", mimeType: "video/mp4;codecs=avc1,mp4a.40.2", extension: "mp4" },
  { label: "MP4", mimeType: "video/mp4", extension: "mp4" },
  { label: "WebM (VP9)", mimeType: "video/webm;codecs=vp9", extension: "webm" },
  { label: "WebM (VP9 + Opus)", mimeType: "video/webm;codecs=vp9,opus", extension: "webm" },
  { label: "WebM (AV1)", mimeType: "video/webm;codecs=av1", extension: "webm" },
  { label: "WebM (VP8)", mimeType: "video/webm;codecs=vp8", extension: "webm" },
  { label: "WebM", mimeType: "video/webm", extension: "webm" },
];

export function supportedVideoFormats(): VideoCodecOption[] {
  if (typeof MediaRecorder === "undefined") return [];
  return VIDEO_CANDIDATES.filter((c) => MediaRecorder.isTypeSupported(c.mimeType));
}

const audioGraphs = new WeakMap<
  HTMLVideoElement,
  { context: AudioContext; source: MediaElementAudioSourceNode; destination: MediaStreamAudioDestinationNode }
>();

/**
 * Routes the element's audio into a MediaStream without playing it out loud.
 * `createMediaElementSource` can only be called once per element, so the graph is cached.
 */
function audioStreamFor(video: HTMLVideoElement): MediaStream | null {
  try {
    let graph = audioGraphs.get(video);
    if (!graph) {
      const context = new AudioContext();
      const source = context.createMediaElementSource(video);
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      graph = { context, source, destination };
      audioGraphs.set(video, graph);
    }
    void graph.context.resume();
    return graph.destination.stream;
  } catch {
    return null;
  }
}

function waitForEvent(target: EventTarget, name: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDone = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Export cancelled", "AbortError"));
    };
    const cleanup = () => {
      target.removeEventListener(name, onDone);
      signal?.removeEventListener("abort", onAbort);
    };
    target.addEventListener(name, onDone, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Plays the source video from start to end once while recording the shader output. */
export async function exportVideo(engine: StudioEngine, opts: VideoExportOptions): Promise<Blob> {
  const video = getVideo(opts.assetId);
  if (!video) throw new Error("This frame does not use a video asset.");
  if (typeof MediaRecorder === "undefined") throw new Error("MediaRecorder is not supported here.");

  const width = Math.max(2, Math.round(opts.width / 2) * 2);
  const height = Math.max(2, Math.round(opts.height / 2) * 2);

  const canvas = document.createElement("canvas");
  const exportSurface = engine.createExportSurface(canvas, width, height);
  const stream = canvas.captureStream(opts.fps);

  const wasLooping = video.loop;
  const wasMuted = video.muted;
  const wasPaused = video.paused;
  const previousTime = video.currentTime;

  if (opts.includeAudio) {
    const audio = audioStreamFor(video);
    if (audio) {
      for (const track of audio.getAudioTracks()) stream.addTrack(track);
      video.muted = false;
    }
  }

  const recorder = new MediaRecorder(stream, {
    mimeType: opts.mimeType,
    videoBitsPerSecond: Math.round(opts.bitrateMbps * 1_000_000),
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  let rafId = 0;
  const stopRendering = () => cancelAnimationFrame(rafId);

  try {
    video.loop = false;
    video.pause();
    video.currentTime = 0;
    await waitForEvent(video, "seeked", opts.signal);

    engine.renderToSurface(opts.frameId, exportSurface);
    recorder.start();
    await video.play();

    const duration = video.duration || 1;
    const tick = () => {
      engine.renderToSurface(opts.frameId, exportSurface);
      opts.onProgress?.(Math.min(1, video.currentTime / duration));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    await waitForEvent(video, "ended", opts.signal);
    stopRendering();
    engine.renderToSurface(opts.frameId, exportSurface);
    opts.onProgress?.(1);

    const stopped = waitForEvent(recorder, "stop");
    recorder.stop();
    await stopped;
    return new Blob(chunks, { type: opts.mimeType.split(";")[0] });
  } finally {
    stopRendering();
    if (recorder.state !== "inactive") recorder.stop();
    for (const track of stream.getTracks()) track.stop();
    exportSurface.dispose();
    video.loop = wasLooping;
    video.muted = wasMuted;
    video.currentTime = previousTime;
    if (!wasPaused) void video.play().catch(() => undefined);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeFilename(name: string): string {
  return (
    name
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "export"
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const frac = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${frac}`;
}
