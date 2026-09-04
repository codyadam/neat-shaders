import type { ParamValue } from "@/lib/shaders/registry";

export type AssetKind = "image" | "video";

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  width: number;
  height: number;
  /** Object URL for the original file. */
  url: string;
  /** Data URL thumbnail used by the assets panel. */
  thumbnail: string;
  duration?: number;
  hasAudio?: boolean;
  fileSize: number;
  mimeType: string;
}

export interface Frame {
  id: string;
  name: string;
  assetId: string;
  shaderId: string;
  params: Record<string, ParamValue>;
  /** World-space position and size (canvas units at zoom 1). */
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  locked: boolean;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export type Tool = "select" | "hand";
