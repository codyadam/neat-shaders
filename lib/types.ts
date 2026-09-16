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

/** One shader in a frame's stack. The first visible layer reads the media; each next layer reads the previous output. */
export interface ShaderLayer {
  id: string;
  shaderId: string;
  params: Record<string, ParamValue>;
  visible: boolean;
  /** Mix with this layer's input (0 = skip the effect, 1 = full). */
  opacity: number;
  /** Optional grayscale mask from another imported asset (luma → effect strength). */
  maskAssetId: string | null;
  maskInvert: boolean;
  /** Blur the mask in source pixels before applying it. */
  maskFeather: number;
  /** Contrast around mid-grey applied to the mask luma. */
  maskContrast: number;
}

export interface Frame {
  id: string;
  name: string;
  assetId: string;
  layers: ShaderLayer[];
  /** World-space position (canvas units at zoom 1). */
  x: number;
  y: number;
  /** Working resolution in pixels (also the on-canvas size at zoom 1). Shaders run at this size. */
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
