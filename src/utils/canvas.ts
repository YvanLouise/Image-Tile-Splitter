import type { BoundingBox, LoadedImage } from "../types";

const checkerTiles = new Map<number, HTMLCanvasElement>();

export function createCheckerPattern(ctx: CanvasRenderingContext2D, size = 16) {
  let patternCanvas = checkerTiles.get(size);
  if (!patternCanvas) {
    patternCanvas = document.createElement("canvas");
    patternCanvas.width = size * 2;
    patternCanvas.height = size * 2;
    const pctx = patternCanvas.getContext("2d");
    if (!pctx) return null;
    pctx.fillStyle = "#ffffff";
    pctx.fillRect(0, 0, patternCanvas.width, patternCanvas.height);
    pctx.fillStyle = "#edf1f7";
    pctx.fillRect(0, 0, size, size);
    pctx.fillRect(size, size, size, size);
    checkerTiles.set(size, patternCanvas);
  }
  return ctx.createPattern(patternCanvas, "repeat");
}

export async function fileToLoadedImage(file: File): Promise<LoadedImage> {
  return blobToLoadedImage(file, file.name, file.size);
}

export async function blobToLoadedImage(
  blob: Blob,
  fileName: string,
  size = blob.size,
): Promise<LoadedImage> {
  const url = URL.createObjectURL(blob);
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D context is not available.");
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      fileName,
      width: bitmap.width,
      height: bitmap.height,
      size,
      blob,
      url,
      bitmap,
      imageData,
    };
  } catch (error) {
    bitmap?.close();
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function disposeLoadedImage(image: LoadedImage) {
  image.bitmap.close();
  URL.revokeObjectURL(image.url);
}

export function downloadUrl(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function hitTestBox(box: BoundingBox, x: number, y: number) {
  return (
    x >= box.x &&
    y >= box.y &&
    x <= box.x + box.width &&
    y <= box.y + box.height
  );
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export function getPinchTransform(
  startPoints: [CanvasPoint, CanvasPoint],
  currentPoints: [CanvasPoint, CanvasPoint],
  startZoom: number,
  startPan: CanvasPoint,
  minZoom = 0.05,
  maxZoom = 4,
) {
  const startMidpoint = midpoint(startPoints[0], startPoints[1]);
  const currentMidpoint = midpoint(currentPoints[0], currentPoints[1]);
  const startDistance = Math.max(1, distance(startPoints[0], startPoints[1]));
  const currentDistance = distance(currentPoints[0], currentPoints[1]);
  const zoom = Math.max(minZoom, Math.min(maxZoom, startZoom * currentDistance / startDistance));
  const imagePoint = {
    x: (startMidpoint.x - startPan.x) / startZoom,
    y: (startMidpoint.y - startPan.y) / startZoom,
  };

  return {
    zoom,
    pan: {
      x: currentMidpoint.x - imagePoint.x * zoom,
      y: currentMidpoint.y - imagePoint.y * zoom,
    },
  };
}

function midpoint(a: CanvasPoint, b: CanvasPoint) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: CanvasPoint, b: CanvasPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
