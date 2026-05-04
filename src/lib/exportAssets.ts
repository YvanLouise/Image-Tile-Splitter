import JSZip from "jszip";
import type { LoadedImage, SliceItem } from "../types";
import { downloadUrl } from "../utils/canvas";

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

export function exportSingle(item: SliceItem) {
  downloadUrl(item.exportUrl, itemFileName(item));
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
  const zip = new JSZip();
  for (const item of items.slice().sort((a, b) => a.order - b.order)) {
    const base64 = item.exportUrl.split(",")[1];
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
