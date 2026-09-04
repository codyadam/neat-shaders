"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  getPersistenceStatus,
  onPersistenceStatus,
  restoreWorkspace,
  type PersistenceStatus,
} from "@/lib/persistence";

export function usePersistenceStatus(): PersistenceStatus {
  return React.useSyncExternalStore(onPersistenceStatus, getPersistenceStatus, () => "idle" as const);
}

/** Restores the saved workspace on mount and exposes the autosave status. */
export function usePersistence(): { restoring: boolean; status: PersistenceStatus } {
  const [restoring, setRestoring] = React.useState(true);
  const status = usePersistenceStatus();

  React.useEffect(() => {
    let cancelled = false;
    restoreWorkspace()
      .then((result) => {
        if (cancelled) return;
        if (result.failed > 0) {
          toast.warning(
            `${result.failed} saved ${result.failed === 1 ? "asset" : "assets"} could not be restored`,
            { description: "Their frames were removed. Import the files again to recreate them." },
          );
        }
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { restoring, status };
}
