import type { LoadedImage, SliceItem } from "../types";
import { downloadUrl } from "../utils/canvas";
import { renderSliceItemUrl } from "./imageSegmentation";

export interface Metadata {
  sourceWidth: number;
  sourceHeight: number;
  items: Array<{
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    polygon?: Array<{ x: number; y: number }>;
    order: number;
  }>;
}

export function buildMetadata(source: LoadedImage, items: SliceItem[]): Metadata {
  return {
    sourceWidth: source.width,
    sourceHeight: source.height,
    items: items
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item) => ({
        id: item.id,
        x: item.boundingBox.x,
        y: item.boundingBox.y,
        width: item.boundingBox.width,
        height: item.boundingBox.height,
        polygon: item.polygon,
        order: item.order,
      })),
  };
}

export function itemFileName(item: SliceItem) {
  const prefix = item.type === "panel" ? "panel" : "slice";
  return `${prefix}-${String(item.order + 1).padStart(3, "0")}.png`;
}

export function sanitizePngFileName(value: string, fallback: string) {
  const fallbackBase = fallback.replace(/\.png$/i, "");
  const base = value
    .trim()
    .replace(/\.png$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");
  return `${base || fallbackBase}.png`;
}

export function exportSingle(source: LoadedImage, item: SliceItem, fileName?: string) {
  const fallback = itemFileName(item);
  downloadUrl(
    renderSliceItemUrl(source.imageData, item),
    fileName ? sanitizePngFileName(fileName, fallback) : fallback,
  );
}

export function exportMetadata(source: LoadedImage, items: SliceItem[]) {
  const blob = new Blob([JSON.stringify(buildMetadata(source, items), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, "metadata.json");
  URL.revokeObjectURL(url);
}

export async function exportZip(
  source: LoadedImage,
  items: SliceItem[],
  includeMetadata: boolean,
) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const item of items.slice().sort((a, b) => a.order - b.order)) {
    const base64 = renderSliceItemUrl(source.imageData, item).split(",")[1];
    zip.file(itemFileName(item), base64, { base64: true });
  }
  if (includeMetadata) {
    zip.file("metadata.json", JSON.stringify(buildMetadata(source, items), null, 2));
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, "segmented-assets.zip");
  URL.revokeObjectURL(url);
}
