"use client";

import * as React from "react";
import { toast } from "sonner";
import { getEngine, hasWebGPU, resetEngine, StudioEngine } from "@/lib/gpu/engine";
import { useStudio } from "@/lib/store";

export type EngineStatus = "booting" | "ready" | "unsupported" | "error";

interface EngineContextValue {
  engine: StudioEngine | null;
  status: EngineStatus;
  error: string | null;
}

class UnsupportedError extends Error {}

const EngineContext = React.createContext<EngineContextValue>({
  engine: null,
  status: "booting",
  error: null,
});

export function EngineProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = React.useState<EngineContextValue>({
    engine: null,
    status: "booting",
    error: null,
  });

  React.useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      if (!hasWebGPU()) throw new UnsupportedError();
      return getEngine();
    };
    boot()
      .then((engine) => {
        if (cancelled) return;
        engine.sync(useStudio.getState());
        setValue({ engine, status: "ready", error: null });
        void engine.gpu.gpu.lost.then((info) => {
          if (cancelled || info.reason === "destroyed") return;
          resetEngine();
          setValue({
            engine: null,
            status: "error",
            error: `The GPU device was lost (${info.message || info.reason}). Reload the page to restart the studio; imported files will need to be added again.`,
          });
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnsupportedError) {
          setValue({ engine: null, status: "unsupported", error: null });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setValue({ engine: null, status: "error", error: message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const engine = value.engine;
  React.useEffect(() => {
    if (!engine) return;
    const unsubscribeStore = useStudio.subscribe((state, prev) => {
      if (state.assets !== prev.assets || state.frames !== prev.frames) engine.sync(state);
    });
    const unsubscribeErrors = engine.onError((error) => {
      console.error(error);
      toast.error("GPU error", { description: error.message, id: "gpu-error" });
    });
    return () => {
      unsubscribeStore();
      unsubscribeErrors();
    };
  }, [engine]);

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineContextValue {
  return React.useContext(EngineContext);
}
