"use client";

import * as React from "react";
import { useEngine } from "@/components/studio/engine-context";
import type { Frame } from "@/lib/types";

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FrameViewProps {
  frame: Frame;
  /** Where the whole frame sits in viewport space. */
  screen: ScreenRect;
  /** Part of `screen` that is inside the viewport; null when the frame is fully off-screen. */
  clip: ScreenRect | null;
  onPointerDown: (e: React.PointerEvent, frame: Frame) => void;
  interactive: boolean;
  /** Hide the GPU canvas so the checkerboard host shows (move/resize drag). */
  placeholder?: boolean;
}

/**
 * One media+shader frame on the canvas.
 *
 * The outer element spans the whole frame (it is the hit target and carries the shadow and
 * checkerboard), but the WebGPU canvas inside it only covers the visible part. Zoomed in, that keeps
 * the backing store at viewport size instead of the frame's size, and the engine renders just that
 * window of the frame at native screen resolution.
 */
export const FrameView = React.memo(function FrameView({
  frame,
  screen,
  clip,
  onPointerDown,
  interactive,
  placeholder = false,
}: FrameViewProps) {
  const { engine } = useEngine();
  const hostRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!engine || !canvas) return;
    engine.attachCanvas(frame.id, canvas, hostRef.current ?? undefined);
    return () => engine.detachCanvas(frame.id, canvas);
  }, [engine, frame.id]);

  React.useLayoutEffect(() => {
    if (!engine || placeholder) return;
    if (!clip || screen.w < 1 || screen.h < 1) {
      engine.setPreviewWindow(frame.id, null);
      return;
    }
    engine.setPreviewWindow(frame.id, [
      (clip.x - screen.x) / screen.w,
      (clip.y - screen.y) / screen.h,
      clip.w / screen.w,
      clip.h / screen.h,
    ]);
  }, [engine, frame.id, clip, screen.x, screen.y, screen.w, screen.h, placeholder]);

  return (
    <div
      ref={hostRef}
      data-frame-id={frame.id}
        className="absolute"
        style={{
          left: screen.x,
          top: screen.y,
          width: Math.max(1, screen.w),
          height: Math.max(1, screen.h),
          overflow: "hidden",
        display: frame.visible ? "block" : "none",
        cursor: interactive ? (frame.locked ? "default" : "move") : undefined,
        boxShadow: "0 1px 3px rgba(0,0,0,0.25), 0 8px 24px -12px rgba(0,0,0,0.35)",
        background:
          "repeating-conic-gradient(rgba(127,127,127,0.18) 0% 25%, transparent 0% 50%) 50% / 16px 16px",
      }}
      onPointerDown={interactive ? (e) => onPointerDown(e, frame) : undefined}
    >
      <canvas
        ref={canvasRef}
        className="absolute select-none"
        style={
          !clip
            ? { display: "none" }
            : {
                left: clip.x - screen.x,
                top: clip.y - screen.y,
                width: clip.w,
                height: clip.h,
                visibility: placeholder ? "hidden" : "visible",
              }
        }
        draggable={false}
      />
    </div>
  );
});
