"use client";

import * as React from "react";
import { toast } from "sonner";
import { loadAsset, kindForFile } from "@/lib/gpu/media";
import { persistAssetFile } from "@/lib/persistence";
import { useStudio, viewportCenterWorld } from "@/lib/store";
import { truncateName } from "@/lib/utils";

export const ACCEPTED_TYPES = "image/*,video/*";

export interface ImportTarget {
  /** World-space point the media should be centered on. Defaults to the viewport center. */
  x?: number;
  y?: number;
  /** Also create a frame for each asset (default true). */
  placeFrames?: boolean;
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
