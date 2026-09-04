"use client";

import * as React from "react";
import { FrameView } from "@/components/studio/frame-view";
import { useImportFiles } from "@/components/studio/use-import";
import { getShader } from "@/lib/shaders/registry";
import { useStudio } from "@/lib/store";
import type { Frame } from "@/lib/types";
import { cn } from "@/lib/utils";

type Corner = "nw" | "ne" | "sw" | "se";

type Drag =
  | { kind: "pan"; startX: number; startY: number; originX: number; originY: number }
  | {
      kind: "move";
      frameId: string;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      moved: boolean;
    }
  | {
      kind: "resize";
      frameId: string;
      corner: Corner;
      startX: number;
      startY: number;
      origin: { x: number; y: number; width: number; height: number };
      aspect: number;
    };

const HANDLE = 8;
export const ASSET_DRAG_TYPE = "application/x-shader-studio-asset";

export function CanvasViewport() {
  const ref = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<Drag | null>(null);
  const [dropActive, setDropActive] = React.useState(false);
  const [panning, setPanning] = React.useState(false);
  const { importFiles } = useImportFiles();

  const frames = useStudio((s) => s.frames);
  const assets = useStudio((s) => s.assets);
  const selectedId = useStudio((s) => s.selectedId);
  const viewport = useStudio((s) => s.viewport);
  const tool = useStudio((s) => s.tool);
  const spaceHeld = useStudio((s) => s.spaceHeld);
  const panMode = tool === "hand" || spaceHeld;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      useStudio.getState().setViewSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    useStudio.getState().setViewSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Wheel: native listener so preventDefault works (React wheel listeners are passive).
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const state = useStudio.getState();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
        state.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        const scale = e.deltaMode === 1 ? 16 : 1;
        state.setViewport({
          x: state.viewport.x - e.deltaX * scale,
          y: state.viewport.y - e.deltaY * scale,
        });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const toWorld = (p: { x: number; y: number }) => ({
    x: (p.x - viewport.x) / viewport.zoom,
    y: (p.y - viewport.y) / viewport.zoom,
  });

  const beginPan = (e: React.PointerEvent) => {
    const p = localPoint(e);
    dragRef.current = {
      kind: "pan",
      startX: p.x,
      startY: p.y,
      originX: viewport.x,
      originY: viewport.y,
    };
    setPanning(true);
    ref.current?.setPointerCapture(e.pointerId);
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || panMode) {
      e.preventDefault();
      beginPan(e);
      return;
    }
    if (e.button === 0) {
      useStudio.getState().select(null);
    }
  };

  const onFramePointerDown = (e: React.PointerEvent, frame: Frame) => {
    if (e.button === 1 || panMode) {
      e.preventDefault();
      beginPan(e);
      return;
    }
    if (e.button !== 0) return;
    e.stopPropagation();
    const state = useStudio.getState();
    state.select(frame.id);
    if (frame.locked) return;
    const p = localPoint(e);
    dragRef.current = {
      kind: "move",
      frameId: frame.id,
      startX: p.x,
      startY: p.y,
      originX: frame.x,
      originY: frame.y,
      moved: false,
    };
    ref.current?.setPointerCapture(e.pointerId);
  };

  const onHandlePointerDown = (e: React.PointerEvent, frame: Frame, corner: Corner) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = localPoint(e);
    dragRef.current = {
      kind: "resize",
      frameId: frame.id,
      corner,
      startX: p.x,
      startY: p.y,
      origin: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      aspect: frame.width / Math.max(1, frame.height),
    };
    ref.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = localPoint(e);
    const state = useStudio.getState();
    const zoom = state.viewport.zoom;
    const dx = (p.x - drag.startX) / zoom;
    const dy = (p.y - drag.startY) / zoom;

    if (drag.kind === "pan") {
      state.setViewport({ x: drag.originX + (p.x - drag.startX), y: drag.originY + (p.y - drag.startY) });
    } else if (drag.kind === "move") {
      drag.moved = true;
      let nx = drag.originX + dx;
      let ny = drag.originY + dy;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) ny = drag.originY;
        else nx = drag.originX;
      }
      state.updateFrame(drag.frameId, { x: Math.round(nx), y: Math.round(ny) });
    } else {
      const o = drag.origin;
      const signX = drag.corner.includes("e") ? 1 : -1;
      const signY = drag.corner.includes("s") ? 1 : -1;
      let w = Math.max(8, o.width + dx * signX);
      let h = Math.max(8, o.height + dy * signY);
      if (!e.altKey) {
        // Lock aspect ratio; follow whichever axis moved further.
        if (Math.abs(dx) * drag.aspect > Math.abs(dy)) h = w / drag.aspect;
        else w = h * drag.aspect;
      }
      const x = signX === 1 ? o.x : o.x + o.width - w;
      const y = signY === 1 ? o.y : o.y + o.height - h;
      state.updateFrame(drag.frameId, {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(w),
        height: Math.round(h),
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      dragRef.current = null;
      setPanning(false);
      if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!dropActive) setDropActive(true);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropActive(false);
    const world = toWorld(localPoint(e));
    const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (assetId) {
      const state = useStudio.getState();
      const asset = state.assets.find((a) => a.id === assetId);
      if (asset) {
        state.addFrame({ assetId, x: world.x - asset.width / 2, y: world.y - asset.height / 2 });
      }
      return;
    }
    if (e.dataTransfer.files.length) await importFiles(e.dataTransfer.files, world);
  };

  const selected = frames.find((f) => f.id === selectedId) ?? null;
  const toScreen = (f: Frame) => ({
    x: f.x * viewport.zoom + viewport.x,
    y: f.y * viewport.zoom + viewport.y,
    w: f.width * viewport.zoom,
    h: f.height * viewport.zoom,
  });

  const gridSize = gridStep(viewport.zoom);

  return (
    <div
      ref={ref}
      className={cn(
        "studio-grid relative h-full w-full touch-none overflow-hidden select-none",
        panning ? "cursor-grabbing" : panMode ? "cursor-grab" : "cursor-default",
      )}
      style={{
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragOver={onDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {frames.map((f) => (
        <FrameView
          key={f.id}
          frame={f}
          screen={toScreen(f)}
          onPointerDown={onFramePointerDown}
          interactive={!panMode}
        />
      ))}

      {/* Overlay: labels and selection chrome in screen space. */}
      <div className="pointer-events-none absolute inset-0">
        {frames.map((f) => {
          if (!f.visible) return null;
          const s = toScreen(f);
          const asset = assets.find((a) => a.id === f.assetId);
          const isSelected = f.id === selectedId;
          return (
            <div
              key={f.id}
              className={cn(
                "absolute flex max-w-full items-center gap-1.5 truncate text-[11px] leading-none",
                isSelected ? "text-(--selection)" : "text-muted-foreground",
              )}
              style={{ left: s.x, top: s.y - 18, width: Math.max(s.w, 120) }}
            >
              <span className="truncate font-medium">{f.name}</span>
              <span className="opacity-70">· {getShader(f.shaderId).name}</span>
              {asset?.kind === "video" && <span className="opacity-70">· video</span>}
            </div>
          );
        })}

        {selected && selected.visible && (
          <SelectionChrome
            frame={selected}
            screen={toScreen(selected)}
            onHandlePointerDown={onHandlePointerDown}
          />
        )}
      </div>

      {dropActive && (
        <div className="pointer-events-none absolute inset-2 rounded-xl border-2 border-dashed border-(--selection) bg-(--selection)/5" />
      )}

      {frames.length === 0 && <EmptyHint />}
    </div>
  );
}

function SelectionChrome({
  frame,
  screen,
  onHandlePointerDown,
}: {
  frame: Frame;
  screen: { x: number; y: number; w: number; h: number };
  onHandlePointerDown: (e: React.PointerEvent, frame: Frame, corner: Corner) => void;
}) {
  const corners: { c: Corner; x: number; y: number; cursor: string }[] = [
    { c: "nw", x: screen.x, y: screen.y, cursor: "nwse-resize" },
    { c: "ne", x: screen.x + screen.w, y: screen.y, cursor: "nesw-resize" },
    { c: "sw", x: screen.x, y: screen.y + screen.h, cursor: "nesw-resize" },
    { c: "se", x: screen.x + screen.w, y: screen.y + screen.h, cursor: "nwse-resize" },
  ];
  return (
    <>
      <div
        className="absolute border border-(--selection)"
        style={{ left: screen.x, top: screen.y, width: screen.w, height: screen.h }}
      />
      {!frame.locked &&
        corners.map((k) => (
          <div
            key={k.c}
            className="pointer-events-auto absolute rounded-[2px] border border-(--selection) bg-white shadow-sm"
            style={{
              left: k.x - HANDLE / 2,
              top: k.y - HANDLE / 2,
              width: HANDLE,
              height: HANDLE,
              cursor: k.cursor,
            }}
            onPointerDown={(e) => onHandlePointerDown(e, frame, k.c)}
          />
        ))}
      <div
        className="absolute rounded-sm bg-(--selection) px-1.5 py-0.5 font-mono text-[10px] text-white"
        style={{ left: screen.x + screen.w / 2, top: screen.y + screen.h + 8, transform: "translateX(-50%)" }}
      >
        {frame.width} × {frame.height}
      </div>
    </>
  );
}

function EmptyHint() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="max-w-sm rounded-2xl border border-dashed bg-background/70 p-8 text-center backdrop-blur">
        <p className="text-sm font-medium">Drop an image or video here</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Each file becomes a frame with a shader applied. Use the Import button, or press{" "}
          <kbd className="rounded border px-1 font-mono text-[10px]">⌘ I</kbd>.
        </p>
      </div>
    </div>
  );
}

/** Grid spacing that stays between 24 and 96 screen pixels across zoom levels. */
function gridStep(zoom: number): number {
  let step = 32 * zoom;
  while (step < 24) step *= 2;
  while (step > 96) step /= 2;
  return step;
}
