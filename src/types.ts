export type AppMode = "transparent" | "comic" | "chroma";
export type NeighborMode = 4 | 8;
export type ToolMode =
  | "pan"
  | "select"
  | "splitLine"
  | "eraser"
  | "restore"
  | "rect"
  | "polygon";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SegmentParams {
  alphaThreshold: number;
  neighborMode: NeighborMode;
  minPixels: number;
}

export interface ComicDetectionParams {
  gutterSensitivity: number;
  borderSensitivity: number;
  minPanelAreaRatio: number;
  maxPanelAreaRatio: number;
  approxEpsilonRatio: number;
  mergeNearbyPanels: boolean;
  showConfidence: boolean;
}

export interface ChromaKeyParams {
  keyColor: string;
  tolerance: number;
  softness: number;
  edgeContract: number;
  despill: number;
  invert: boolean;
  livePreview: boolean;
}

export type ChromaPreviewMode = "original" | "result" | "mask";

export interface ChromaKeyResult {
  resultUrl: string;
  maskUrl: string;
  foregroundPixels: number;
  totalPixels: number;
}

export type PanelDetectionSource = "opencv" | "manual" | "fallback";

export interface SliceItem {
  id: number;
  type: "slice" | "panel";
  boundingBox: BoundingBox;
  pixelCount: number;
  mask: Uint8Array;
  previewUrl: string;
  exportUrl: string;
  order: number;
  polygon?: Array<{ x: number; y: number }>;
  confidence?: number;
  source?: PanelDetectionSource;
}

export interface LoadedImage {
  fileName: string;
  width: number;
  height: number;
  size: number;
  blob: Blob;
  url: string;
  bitmap: ImageBitmap;
  imageData: ImageData;
}

export interface HistoryState {
  edits: Int8Array;
  items: SliceItem[];
  selectedIds: number[];
}
