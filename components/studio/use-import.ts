"use client";

import * as React from "react";
import { toast } from "sonner";
import { loadAsset, kindForFile } from "@/lib/gpu/media";
import { persistAssetFile } from "@/lib/persistence";
import { useStudio, viewportCenterWorld } from "@/lib/store";
import type { AssetKind } from "@/lib/types";
import { truncateName } from "@/lib/utils";

export const ACCEPTED_TYPES = "image/*,video/*";

/** OS / browser clipboard images often arrive as a generic `image.png` (or no name). */
const GENERIC_CLIPBOARD_NAME = /^(image|picture|untitled|download|unknown)?(\.(png|jpe?g|gif|webp|bmp|avif|mp4|webm|mov|m4v))?$/i;

export interface ImportTarget {
  /** World-space point the media should be centered on. Defaults to the viewport center. */
  x?: number;
  y?: number;
  /** Also create a frame for each asset (default true). */
  placeFrames?: boolean;
}

/**
 * Collects image/video files from a paste or drop DataTransfer.
 * Screenshots and copied bitmaps show up on `items`, not always on `files`.
 */
export function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const raw: File[] = [];
  const seen = new Set<string>();

  const push = (file: File | null, fallbackType?: string) => {
    if (!file) return;
    const typed =
      file.type || !fallbackType
        ? file
        : new File([file], file.name, { type: fallbackType, lastModified: file.lastModified });
    const key = `${typed.name}\0${typed.size}\0${typed.type}\0${typed.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    raw.push(typed);
  };

  for (const file of Array.from(data.files)) push(file);
  for (const item of Array.from(data.items)) {
    if (item.kind === "file") push(item.getAsFile(), item.type);
  }

  const supported = raw.filter((f) => kindForFile(f));
  return supported.map((file, i) => nameClipboardFile(file, i));
}

function nameClipboardFile(file: File, index: number): File {
  const kind = kindForFile(file);
  const name = file.name.trim();
  if (!kind || (name && !GENERIC_CLIPBOARD_NAME.test(name))) return file;
  const ext = extensionForClipboardFile(file, kind);
  const suffix = index === 0 ? "" : ` ${index + 1}`;
  const labeled = `${kind === "video" ? "Pasted video" : "Pasted image"}${suffix}.${ext}`;
  return new File([file], labeled, { type: file.type, lastModified: file.lastModified || Date.now() });
}

function extensionForClipboardFile(file: File, kind: AssetKind): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && fromName !== file.name.toLowerCase()) return fromName;
  const mime = file.type.split("/")[1]?.split(";")[0]?.split("+")[0];
  if (mime === "jpeg") return "jpg";
  if (mime) return mime;
  return kind === "video" ? "mp4" : "png";
}

export function useImportFiles() {
  const [busy, setBusy] = React.useState(false);

  const importFiles = React.useCallback(async (files: FileList | File[], target?: ImportTarget) => {
    const list = Array.from(files).filter((f) => kindForFile(f));
    if (list.length === 0) {
      toast.error("No supported images or videos in the selection.");
      return [] as string[];
    }
    setBusy(true);
    const ids: string[] = [];
    const hadFrames = useStudio.getState().frames.length > 0;
    const center = viewportCenterWorld();
    const cx = target?.x ?? center.x;
    const cy = target?.y ?? center.y;
    let offset = 0;
    try {
      for (const file of list) {
        try {
          const asset = await loadAsset(file);
          const state = useStudio.getState();
          state.addAsset(asset);
          ids.push(asset.id);
          persistAssetFile(asset.id, file).catch((err: unknown) => {
            toast.warning(`${truncateName(file.name)} will not survive a reload`, {
              description:
                err instanceof Error && err.name === "QuotaExceededError"
                  ? "Local storage is full. Remove unused assets to free space."
                  : "Could not store the file in this browser.",
              id: `persist-${asset.id}`,
            });
          });
          if (target?.placeFrames !== false) {
            state.addFrame({
              assetId: asset.id,
              x: cx - asset.width / 2 + offset,
              y: cy - asset.height / 2 + offset,
            });
            offset += 48;
          }
        } catch (err) {
          toast.error(`Could not import ${truncateName(file.name)}`, {
            description: err instanceof Error ? err.message : undefined,
          });
        }
      }
    } finally {
      setBusy(false);
    }
    if (!hadFrames && target?.placeFrames !== false && ids.length > 0) {
      useStudio.getState().fitAll();
    }
    return ids;
  }, []);

  const openPicker = React.useCallback(
    (target?: ImportTarget) =>
      new Promise<string[]>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = ACCEPTED_TYPES;
        input.onchange = async () => {
          resolve(input.files ? await importFiles(input.files, target) : []);
        };
        input.oncancel = () => resolve([]);
        input.click();
      }),
    [importFiles],
  );

  return { importFiles, openPicker, busy };
}
