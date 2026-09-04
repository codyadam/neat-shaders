"use client";

import * as React from "react";
import { useEngine } from "@/components/studio/engine-context";
import type { Frame } from "@/lib/types";

interface FrameViewProps {
  frame: Frame;
  screen: { x: number; y: number; w: number; h: number };
  onPointerDown: (e: React.PointerEvent, frame: Frame) => void;
  interactive: boolean;
}

/** One media+shader frame on the canvas: a WebGPU canvas positioned in screen space. */
export const FrameView = React.memo(function FrameView({
  frame,
  screen,
  onPointerDown,
  interactive,
}: FrameViewProps) {
  const { engine } = useEngine();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!engine || !canvas) return;
    engine.attachCanvas(frame.id, canvas);
    return () => engine.detachCanvas(frame.id, canvas);
  }, [engine, frame.id]);

  return (
    <div
      data-frame-id={frame.id}
      className="absolute"
      style={{
        left: screen.x,
        top: screen.y,
        width: Math.max(1, screen.w),
        height: Math.max(1, screen.h),
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
        className="block h-full w-full select-none"
        style={{ imageRendering: "auto" }}
        draggable={false}
      />
    </div>
  );
});
