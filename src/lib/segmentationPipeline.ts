import type {
  ComicDetectionParams,
  LoadedImage,
  SegmentParams,
  SliceItem,
} from "../types";
import { detectComicPanelsAdvanced } from "./comicDetection";
import {
  createAlphaMask,
  createComicContentMask,
  segmentMaskImage,
  segmentTransparentImage,
} from "./imageSegmentation";

export interface SegmentationOutput {
  originalMask: Uint8Array;
  edits: Int8Array;
  items: SliceItem[];
  selectedIds: number[];
  status: string;
  warning?: string;
}

type SegmentationMode = "transparent" | "comic";

export async function createInitialSegmentation(
  source: LoadedImage,
  mode: SegmentationMode,
  segmentParams: SegmentParams,
  comicParams: ComicDetectionParams,
): Promise<SegmentationOutput> {
  const originalMask =
    mode === "transparent"
      ? createAlphaMask(source.imageData, segmentParams.alphaThreshold)
      : createComicContentMask(source.imageData);
  const edits = new Int8Array(source.width * source.height);
  const result = await detectItems(source, mode, originalMask, edits, segmentParams, comicParams);
  return {
    originalMask,
    edits,
    items: result.items,
    selectedIds: result.items[0] ? [result.items[0].id] : [],
    status: result.status,
    warning: result.warning,
  };
}

export async function detectItems(
  source: LoadedImage,
  mode: SegmentationMode,
  originalMask: Uint8Array,
  edits: Int8Array,
  segmentParams: SegmentParams,
  comicParams: ComicDetectionParams,
): Promise<{ items: SliceItem[]; status: string; warning?: string }> {
  if (mode === "transparent") {
    const items = segmentTransparentImage(source.imageData, originalMask, edits, segmentParams);
    return { items, status: `已识别 ${items.length} 个图块` };
  }

  const result = await detectComicPanelsAdvanced(source.imageData, comicParams);
  return {
    items: result.items,
    status: `已识别 ${result.items.length} 个漫画格（${result.engine === "opencv" ? "OpenCV" : "Fallback"}）`,
    warning: result.warning,
  };
}

export function resegmentEditedMask(
  source: LoadedImage,
  mode: SegmentationMode,
  originalMask: Uint8Array,
  edits: Int8Array,
  segmentParams: SegmentParams,
) {
  const items =
    mode === "transparent"
      ? segmentTransparentImage(source.imageData, originalMask, edits, segmentParams)
      : segmentMaskImage(source.imageData, originalMask, edits, segmentParams, "panel").map(
          (item) => ({
            ...item,
            source: "manual" as const,
            confidence: 1,
          }),
        );
  return {
    items,
    selectedIds: items[0] ? [items[0].id] : [],
    status: `已重新分割：${items.length} 个${mode === "transparent" ? "图块" : "漫画格"}`,
  };
}
