export type AppMode = "transparent" | "comic";
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
}

export interface LoadedImage {
  fileName: string;
  width: number;
  height: number;
  size: number;
  url: string;
  bitmap: ImageBitmap;
  imageData: ImageData;
}

export interface HistoryState {
  edits: Int8Array;
  items: SliceItem[];
  selectedIds: number[];
}
