"use client";

import type { Asset, AssetKind } from "@/lib/types";
import { uid } from "@/lib/store";

export type MediaSource =
  | { kind: "image"; bitmap: ImageBitmap; width: number; height: number }
  | { kind: "video"; video: HTMLVideoElement; width: number; height: number };

const registry = new Map<string, MediaSource>();

export function getMedia(assetId: string): MediaSource | undefined {
  return registry.get(assetId);
}

export function getVideo(assetId: string): HTMLVideoElement | undefined {
  const media = registry.get(assetId);
  return media?.kind === "video" ? media.video : undefined;
}

export function releaseMedia(assetId: string): void {
  const media = registry.get(assetId);
  if (!media) return;
  if (media.kind === "image") media.bitmap.close();
  else {
    media.video.pause();
    media.video.removeAttribute("src");
    media.video.load();
  }
  registry.delete(assetId);
}

export function kindForFile(file: File): AssetKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(ext)) return "video";
  return null;
}

const THUMB_SIZE = 96;
/** Conservative WebGPU `maxTextureDimension2D`; larger images are downscaled at import. */
const MAX_TEXTURE_DIM = 8192;

function thumbnailFrom(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, THUMB_SIZE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

/** Decodes a file into a GPU-uploadable media source and registers it. */
export async function loadAsset(file: File): Promise<Asset> {
  const kind = kindForFile(file);
  if (!kind) throw new Error(`Unsupported file type: ${file.name}`);
  const id = uid("asset");
  const url = URL.createObjectURL(file);

  if (kind === "image") {
    let bitmap = await createImageBitmap(file, { colorSpaceConversion: "default" });
    const largest = Math.max(bitmap.width, bitmap.height);
    if (largest > MAX_TEXTURE_DIM) {
      // Larger than any WebGPU texture may be; resample once at import time.
      const scale = MAX_TEXTURE_DIM / largest;
      const resized = await createImageBitmap(bitmap, {
        resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
        resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
        resizeQuality: "high",
      });
      bitmap.close();
      bitmap = resized;
    }
    registry.set(id, { kind, bitmap, width: bitmap.width, height: bitmap.height });
    return {
      id,
      name: file.name,
      kind,
      width: bitmap.width,
      height: bitmap.height,
      url,
      thumbnail: thumbnailFrom(bitmap, bitmap.width, bitmap.height),
      fileSize: file.size,
      mimeType: file.type,
    };
  }

  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";

  await new Promise<void>((resolve, reject) => {
    const onError = () => reject(new Error(`Could not decode video: ${file.name}`));
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener("error", onError, { once: true });
  });

  // Seek slightly in so the thumbnail is not a black first frame.
  if (video.duration > 0.2) {
    video.currentTime = Math.min(0.1, video.duration / 10);
    await new Promise<void>((resolve) => {
      video.addEventListener("seeked", () => resolve(), { once: true });
    });
  }

  const width = video.videoWidth;
  const height = video.videoHeight;
  const thumbnail = thumbnailFrom(video, width, height);
  video.currentTime = 0;
  void video.play().catch(() => undefined);

  const hasAudio = detectAudio(video);
  registry.set(id, { kind, video, width, height });
  return {
    id,
    name: file.name,
    kind,
    width,
    height,
    url,
    thumbnail,
    duration: video.duration,
    hasAudio,
    fileSize: file.size,
    mimeType: file.type,
  };
}

function detectAudio(video: HTMLVideoElement): boolean {
  const v = video as HTMLVideoElement & {
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
    audioTracks?: { length: number };
  };
  if (typeof v.mozHasAudio === "boolean") return v.mozHasAudio;
  if (typeof v.webkitAudioDecodedByteCount === "number") return v.webkitAudioDecodedByteCount > 0;
  if (v.audioTracks) return v.audioTracks.length > 0;
  return true;
}
