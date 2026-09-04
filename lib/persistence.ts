"use client";

import { loadAsset, releaseMedia } from "@/lib/gpu/media";
import { defaultParams, getShader } from "@/lib/shaders/registry";
import { useStudio } from "@/lib/store";
import type { Asset, Frame, Viewport } from "@/lib/types";

/**
 * Local persistence for the studio: imported files live in IndexedDB as blobs,
 * and the workspace (asset list, frames, viewport, selection) is snapshotted
 * alongside them. On boot the snapshot is restored and every asset is decoded
 * again from its stored file, so closing the tab no longer loses progress.
 *
 * Saving is debounced and only starts once hydration has finished, so an
 * empty initial store can never overwrite a saved workspace.
 */

const DB_NAME = "shader-studio";
const DB_VERSION = 1;
const FILES_STORE = "files";
const WORKSPACE_STORE = "workspace";
const WORKSPACE_KEY = "current";
const WORKSPACE_VERSION = 1;
const SAVE_DEBOUNCE_MS = 400;

interface StoredFile {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
}

interface StoredAsset {
  id: string;
  name: string;
}

interface StoredWorkspace {
  version: number;
  savedAt: number;
  assets: StoredAsset[];
  frames: Frame[];
  viewport: Viewport;
  selectedId: string | null;
}

export interface RestoreResult {
  /** Assets decoded from storage. */
  restored: number;
  /** Assets whose file was missing or could not be decoded (their frames are dropped). */
  failed: number;
}

export type PersistenceStatus = "idle" | "saving" | "saved" | "error" | "unavailable";
type StatusListener = (status: PersistenceStatus) => void;

let dbPromise: Promise<IDBDatabase | null> | null = null;
let hydrated = false;
let restorePromise: Promise<RestoreResult> | null = null;
let saveTimer: number | null = null;
let saveChain: Promise<void> = Promise.resolve();
let stopAutosave: (() => void) | null = null;
let status: PersistenceStatus = "idle";
const statusListeners = new Set<StatusListener>();

function setStatus(next: PersistenceStatus): void {
  if (status === next) return;
  status = next;
  for (const cb of statusListeners) cb(next);
}

export function getPersistenceStatus(): PersistenceStatus {
  return status;
}

export function onPersistenceStatus(cb: StatusListener): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

export function isPersistenceAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!isPersistenceAvailable()) {
      setStatus("unavailable");
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      setStatus("unavailable");
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) db.createObjectStore(FILES_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(WORKSPACE_STORE)) db.createObjectStore(WORKSPACE_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgraded the schema; drop our handle so the next call reopens.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      console.warn("Local persistence unavailable:", request.error);
      setStatus("unavailable");
      resolve(null);
    };
    request.onblocked = () => {
      setStatus("unavailable");
      resolve(null);
    };
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  const tx = db.transaction(storeName, mode);
  const result = run(tx.objectStore(storeName));
  const value = result instanceof IDBRequest ? await requestToPromise(result) : await result;
  await transactionDone(tx);
  return value;
}

// ---------------------------------------------------------------------------
// Files

/** Stores the original file of an asset so it can be decoded again after a reload. */
export async function persistAssetFile(id: string, file: File): Promise<void> {
  const record: StoredFile = {
    id,
    blob: file,
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
  };
  try {
    await withStore(FILES_STORE, "readwrite", (store) => store.put(record));
  } catch (error) {
    setStatus("error");
    throw error;
  }
}

async function deleteAssetFile(id: string): Promise<void> {
  await withStore(FILES_STORE, "readwrite", (store) => store.delete(id));
}

async function readAssetFile(id: string): Promise<File | null> {
  const record = await withStore<StoredFile | undefined>(FILES_STORE, "readonly", (store) => store.get(id));
  if (!record) return null;
  return new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified });
}

async function listFileIds(): Promise<string[]> {
  const keys = await withStore<IDBValidKey[]>(FILES_STORE, "readonly", (store) => store.getAllKeys());
  return (keys ?? []).map(String);
}

// ---------------------------------------------------------------------------
// Workspace snapshot

function snapshot(): StoredWorkspace {
  const s = useStudio.getState();
  return {
    version: WORKSPACE_VERSION,
    savedAt: Date.now(),
    assets: s.assets.map((a) => ({ id: a.id, name: a.name })),
    frames: s.frames,
    viewport: s.viewport,
    selectedId: s.selectedId,
  };
}

async function writeWorkspace(): Promise<void> {
  await withStore(WORKSPACE_STORE, "readwrite", (store) => store.put(snapshot(), WORKSPACE_KEY));
}

async function readWorkspace(): Promise<StoredWorkspace | null> {
  const record = await withStore<StoredWorkspace | undefined>(WORKSPACE_STORE, "readonly", (store) =>
    store.get(WORKSPACE_KEY),
  );
  if (!record || typeof record !== "object" || !Array.isArray(record.frames) || !Array.isArray(record.assets)) {
    return null;
  }
  return record;
}

/** Fills in defaults for params added since the frame was saved and drops unknown shaders. */
function sanitizeFrame(frame: Frame): Frame {
  const shader = getShader(frame.shaderId);
  const params = { ...defaultParams(shader) };
  for (const p of shader.params) {
    if (frame.params && p.key in frame.params) params[p.key] = frame.params[p.key];
  }
  return {
    ...frame,
    shaderId: shader.id,
    params,
    visible: frame.visible ?? true,
    locked: frame.locked ?? false,
  };
}

// ---------------------------------------------------------------------------
// Restore

/**
 * Loads the saved workspace into the store and decodes its assets. Safe to
 * call more than once (React strict-mode double effects); the work runs once.
 */
export function restoreWorkspace(): Promise<RestoreResult> {
  if (restorePromise) return restorePromise;
  restorePromise = (async () => {
    const result: RestoreResult = { restored: 0, failed: 0 };
    try {
      const stored = await readWorkspace();
      if (stored) {
        const assets: Asset[] = [];
        for (const entry of stored.assets) {
          try {
            const file = await readAssetFile(entry.id);
            if (!file) {
              result.failed += 1;
              continue;
            }
            assets.push(await loadAsset(file, { id: entry.id }));
            result.restored += 1;
          } catch (error) {
            console.warn(`Could not restore ${entry.name}:`, error);
            result.failed += 1;
          }
        }

        const assetIds = new Set(assets.map((a) => a.id));
        const frames = stored.frames.filter((f) => assetIds.has(f.assetId)).map(sanitizeFrame);
        const selectedId = frames.some((f) => f.id === stored.selectedId) ? stored.selectedId : null;
        const viewport =
          stored.viewport && Number.isFinite(stored.viewport.zoom) && stored.viewport.zoom > 0
            ? stored.viewport
            : useStudio.getState().viewport;

        useStudio.setState({ assets, frames, selectedId, viewport });
        if (status === "idle") setStatus("saved");

        // Drop files that no longer belong to any asset (e.g. a crash between delete and save).
        void listFileIds().then((ids) =>
          Promise.all(ids.filter((id) => !assetIds.has(id)).map((id) => deleteAssetFile(id))),
        );
      }
    } catch (error) {
      console.warn("Could not restore the saved workspace:", error);
      setStatus("error");
    } finally {
      hydrated = true;
      startAutosave();
    }
    return result;
  })();
  return restorePromise;
}

// ---------------------------------------------------------------------------
// Autosave

function queueSave(task: () => Promise<void>): void {
  saveChain = saveChain
    .then(task)
    .then(() => {
      if (status !== "unavailable") setStatus("saved");
    })
    .catch((error) => {
      console.warn("Could not save the workspace locally:", error);
      setStatus("error");
    });
}

function scheduleSave(): void {
  if (!hydrated) return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  setStatus(status === "unavailable" ? "unavailable" : "saving");
  saveTimer = window.setTimeout(flushSave, SAVE_DEBOUNCE_MS);
}

/** Writes the pending snapshot immediately (used before the page hides). */
export function flushSave(): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!hydrated) return;
  queueSave(writeWorkspace);
}

function startAutosave(): void {
  if (stopAutosave || typeof window === "undefined") return;

  const unsubscribe = useStudio.subscribe((state, prev) => {
    if (state.assets !== prev.assets) {
      const live = new Set(state.assets.map((a) => a.id));
      for (const asset of prev.assets) {
        if (!live.has(asset.id)) queueSave(() => deleteAssetFile(asset.id));
      }
    }
    if (
      state.assets !== prev.assets ||
      state.frames !== prev.frames ||
      state.viewport !== prev.viewport ||
      state.selectedId !== prev.selectedId
    ) {
      scheduleSave();
    }
  });

  const onHide = () => {
    if (document.visibilityState === "hidden") flushSave();
  };
  window.addEventListener("pagehide", flushSave);
  document.addEventListener("visibilitychange", onHide);

  stopAutosave = () => {
    unsubscribe();
    window.removeEventListener("pagehide", flushSave);
    document.removeEventListener("visibilitychange", onHide);
    stopAutosave = null;
  };
}

// ---------------------------------------------------------------------------
// Clear

/** Removes every asset and frame from the studio and wipes the saved workspace. */
export async function clearWorkspace(): Promise<void> {
  const { assets } = useStudio.getState();
  for (const asset of assets) {
    releaseMedia(asset.id);
    URL.revokeObjectURL(asset.url);
  }
  useStudio.setState({ assets: [], frames: [], selectedId: null });
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  queueSave(async () => {
    await withStore(FILES_STORE, "readwrite", (store) => store.clear());
    await withStore(WORKSPACE_STORE, "readwrite", (store) => store.clear());
  });
  await saveChain;
}
