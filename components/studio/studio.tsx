"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { CanvasViewport } from "@/components/studio/canvas-viewport";
import { EngineProvider, useEngine } from "@/components/studio/engine-context";
import { ExportDialog } from "@/components/studio/export-dialog";
import { Inspector } from "@/components/studio/inspector";
import { LeftPanel } from "@/components/studio/left-panel";
import { Toolbar } from "@/components/studio/toolbar";
import { useImportFiles } from "@/components/studio/use-import";
import { useStudio } from "@/lib/store";

export function Studio() {
  return (
    <EngineProvider>
      <StudioShell />
    </EngineProvider>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function StudioShell() {
  const { status, error } = useEngine();
  const { openPicker } = useImportFiles();

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = useStudio.getState();
      const mod = e.metaKey || e.ctrlKey;

      if (e.code === "Space" && !isTypingTarget(e.target)) {
        if (!e.repeat) s.setSpaceHeld(true);
        e.preventDefault();
        return;
      }
      if (isTypingTarget(e.target)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (s.exportOpen) return;

      if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        void openPicker();
      } else if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (s.selectedId) s.setExportOpen(true);
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (s.selectedId) s.duplicateFrame(s.selectedId);
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        s.zoomCenter(1.25);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        s.zoomCenter(1 / 1.25);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        s.zoomTo(1);
      } else if (mod) {
        return;
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (s.selectedId) {
          e.preventDefault();
          s.removeFrame(s.selectedId);
        }
      } else if (e.key === "Escape") {
        s.select(null);
      } else if (e.key.toLowerCase() === "v") {
        s.setTool("select");
      } else if (e.key.toLowerCase() === "h") {
        s.setTool("hand");
      } else if (e.shiftKey && e.code === "Digit1") {
        s.fitAll();
      } else if (e.shiftKey && e.code === "Digit2") {
        s.fitSelection();
      } else if (e.shiftKey && e.code === "Digit0") {
        s.zoomTo(1);
      } else if (e.key === "=" || e.key === "+") {
        s.zoomCenter(1.25);
      } else if (e.key === "-") {
        s.zoomCenter(1 / 1.25);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") useStudio.getState().setSpaceHeld(false);
    };
    const onBlur = () => useStudio.getState().setSpaceHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [openPicker]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <main className="relative min-w-0 flex-1">
          <CanvasViewport />
          {status !== "ready" && <GpuGate status={status} error={error} />}
        </main>
        <Inspector />
      </div>
      <ExportDialog />
    </div>
  );
}

function GpuGate({ status, error }: { status: "booting" | "unsupported" | "error"; error: string | null }) {
  if (status === "booting") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Starting WebGPU…
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
      <div className="max-w-md rounded-2xl border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="size-5" />
          <h2 className="text-base font-semibold">
            {status === "unsupported" ? "WebGPU is not available" : "The GPU could not be initialized"}
          </h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {status === "unsupported"
            ? "This studio renders with WebGPU. Use a recent Chrome, Edge, or Safari 26+, or enable WebGPU in Firefox (about:config → dom.webgpu.enabled)."
            : error}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          On Linux Chrome you may need <code className="font-mono">chrome://flags/#enable-unsafe-webgpu</code>
          .
        </p>
      </div>
    </div>
  );
}
