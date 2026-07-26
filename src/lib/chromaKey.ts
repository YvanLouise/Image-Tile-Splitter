import type {
  ChromaExcludedColor,
  ChromaKeyParams,
  ChromaKeyResult,
} from "../types";

interface PixelImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ChromaPixelResult {
  resultData: Uint8ClampedArray;
  maskData: Uint8ClampedArray;
  foregroundPixels: number;
  totalPixels: number;
}

export interface ChromaPreviewInput {
  imageData: ImageData;
  sourceWidth: number;
  sourceHeight: number;
}

export const defaultChromaKeyParams: ChromaKeyParams = {
  keyColor: "#00ff00",
  excludedColors: [],
  excludeTolerance: 12,
  tolerance: 26,
  softness: 18,
  edgeContract: 6,
  despill: 55,
  invert: false,
  outerOnly: true,
  outerMode: "canvasEdge",
  livePreview: true,
};

export function processChromaKey(
  imageData: PixelImageData,
  params: ChromaKeyParams,
): ChromaPixelResult {
  const resultData = new Uint8ClampedArray(imageData.data);
  const maskData = new Uint8ClampedArray(imageData.data.length);
  const normalizedParams = normalizeChromaParams(params);
  const [keyR, keyG, keyB] = hexToRgb(normalizedParams.keyColor);
  const keyLab = rgbToLab(keyR, keyG, keyB);
  const excludeTolerance = Math.max(0, normalizedParams.excludeTolerance);
  const threshold = Math.max(0, normalizedParams.tolerance + normalizedParams.edgeContract);
  const softness = Math.max(0, normalizedParams.softness);
  const low = Math.max(0, threshold - softness / 2);
  const high = threshold + softness / 2;
  const despillStrength = clamp01(normalizedParams.despill / 100);
  const keyUnit = normalizeRgb(keyR, keyG, keyB);
  const pixelCount = imageData.width * imageData.height;
  const alphaByPixel = new Uint8ClampedArray(pixelCount);
  const removableByPixel = new Uint8Array(pixelCount);
  const backgroundCoreByPixel = new Uint8Array(pixelCount);
  const excludedByPixel = traceExcludedColorRegions(
    imageData,
    normalizedParams.excludedColors,
    excludeTolerance,
  );
  const coreThreshold = Math.max(0, threshold - Math.min(softness * 0.35, 10));
  let foregroundPixels = 0;

  for (let offset = 0, pixel = 0; offset < imageData.data.length; offset += 4, pixel += 1) {
    const r = imageData.data[offset];
    const g = imageData.data[offset + 1];
    const b = imageData.data[offset + 2];
    const sourceAlphaByte = imageData.data[offset + 3];
    const sourceAlpha = sourceAlphaByte / 255;
    const pixelLab = rgbToLab(r, g, b);
    const distance = deltaE76(pixelLab, keyLab);
    const isExcluded = excludedByPixel[pixel] === 1;
    let alpha = softness === 0
      ? Number(distance > threshold)
      : smoothstep(low, high, distance);
    if (normalizedParams.invert) alpha = 1 - alpha;
    alpha *= sourceAlpha;
    const outputAlpha = isExcluded ? sourceAlphaByte : Math.round(alpha * 255);
    alphaByPixel[pixel] = outputAlpha;
    removableByPixel[pixel] = !isExcluded && outputAlpha < sourceAlphaByte ? 1 : 0;
    backgroundCoreByPixel[pixel] = !isExcluded
      && !normalizedParams.invert
      && sourceAlpha > 0
      && distance <= coreThreshold
      ? 1
      : 0;
  }

  const outerMask = normalizedParams.outerOnly
    ? expandOuterMask(
        traceOuterRemovablePixels(
          normalizedParams.invert ? removableByPixel : backgroundCoreByPixel,
          imageData.width,
          imageData.height,
          normalizedParams.outerMode,
          normalizedParams.samplePoint,
        ),
        removableByPixel,
        imageData.width,
        imageData.height,
      )
    : null;

  for (let offset = 0, pixel = 0; offset < imageData.data.length; offset += 4, pixel += 1) {
    const r = imageData.data[offset];
    const g = imageData.data[offset + 1];
    const b = imageData.data[offset + 2];
    const sourceAlphaByte = imageData.data[offset + 3];
    const shouldApplyKey = excludedByPixel[pixel] === 0
      && (!outerMask || outerMask[pixel] === 1);
    const outputAlpha = shouldApplyKey ? alphaByPixel[pixel] : sourceAlphaByte;
    const alpha = outputAlpha / 255;

    const edgeAmount = (1 - alpha) * despillStrength;
    if (shouldApplyKey && edgeAmount > 0 && !normalizedParams.invert) {
      const corrected = despillRgb(r, g, b, keyUnit, edgeAmount);
      resultData[offset] = corrected[0];
      resultData[offset + 1] = corrected[1];
      resultData[offset + 2] = corrected[2];
    }
    resultData[offset + 3] = outputAlpha;
    maskData[offset] = outputAlpha;
    maskData[offset + 1] = outputAlpha;
    maskData[offset + 2] = outputAlpha;
    maskData[offset + 3] = 255;
    if (outputAlpha > 0) foregroundPixels += 1;
  }

  return {
    resultData,
    maskData,
    foregroundPixels,
    totalPixels: imageData.width * imageData.height,
  };
}

function normalizeChromaParams(params: ChromaKeyParams): ChromaKeyParams {
  return {
    ...defaultChromaKeyParams,
    ...params,
    excludedColors: normalizeExcludedColors(params.excludedColors),
    excludeTolerance: params.excludeTolerance ?? defaultChromaKeyParams.excludeTolerance,
    outerOnly: params.outerOnly ?? defaultChromaKeyParams.outerOnly,
    outerMode: params.outerMode ?? defaultChromaKeyParams.outerMode,
    samplePoint: params.samplePoint,
  };
}

function normalizeExcludedColors(value: unknown): ChromaExcludedColor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isExcludedColor(item)) return [];
    return [{
      color: item.color.toLowerCase(),
      point: { x: item.point.x, y: item.point.y },
    }];
  }).slice(0, 8);
}

function isExcludedColor(value: unknown): value is ChromaExcludedColor {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ChromaExcludedColor>;
  return isHexColor(item.color)
    && Number.isFinite(item.point?.x)
    && Number.isFinite(item.point?.y);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function traceExcludedColorRegions(
  imageData: PixelImageData,
  excludedColors: ChromaExcludedColor[],
  tolerance: number,
) {
  const protectedPixels = new Uint8Array(imageData.width * imageData.height);
  if (!excludedColors.length) return protectedPixels;

  const visited = new Uint8Array(protectedPixels.length);
  const queue = new Int32Array(protectedPixels.length);
  const enqueueNeighbors = (index: number, enqueue: (next: number) => void) => {
    const x = index % imageData.width;
    const y = Math.floor(index / imageData.width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nextX = x + dx;
        const nextY = y + dy;
        if (
          nextX >= 0
          && nextX < imageData.width
          && nextY >= 0
          && nextY < imageData.height
        ) {
          enqueue(nextY * imageData.width + nextX);
        }
      }
    }
  };

  for (const excluded of excludedColors) {
    visited.fill(0);
    const [r, g, b] = hexToRgb(excluded.color);
    const excludedLab = rgbToLab(r, g, b);
    let queueStart = 0;
    let queueEnd = 0;
    const enqueue = (index: number) => {
      if (visited[index] === 1) return;
      visited[index] = 1;
      const offset = index * 4;
      if (imageData.data[offset + 3] === 0) return;
      const pixelLab = rgbToLab(
        imageData.data[offset],
        imageData.data[offset + 1],
        imageData.data[offset + 2],
      );
      if (deltaE76(pixelLab, excludedLab) > tolerance) return;
      queue[queueEnd] = index;
      queueEnd += 1;
    };

    const startX = Math.max(0, Math.min(imageData.width - 1, Math.floor(excluded.point.x)));
    const startY = Math.max(0, Math.min(imageData.height - 1, Math.floor(excluded.point.y)));
    enqueue(startY * imageData.width + startX);
    while (queueStart < queueEnd) {
      const index = queue[queueStart];
      queueStart += 1;
      protectedPixels[index] = 1;
      enqueueNeighbors(index, enqueue);
    }
  }

  return protectedPixels;
}

function traceOuterRemovablePixels(
  removableByPixel: Uint8Array,
  width: number,
  height: number,
  mode: ChromaKeyParams["outerMode"],
  samplePoint?: ChromaKeyParams["samplePoint"],
) {
  const connected = new Uint8Array(removableByPixel.length);
  const queue = new Int32Array(removableByPixel.length);
  let queueStart = 0;
  let queueEnd = 0;
  const enqueue = (index: number) => {
    if (removableByPixel[index] === 0 || connected[index] === 1) return;
    connected[index] = 1;
    queue[queueEnd] = index;
    queueEnd += 1;
  };

  if (mode === "samplePoint" && samplePoint) {
    const x = Math.max(0, Math.min(width - 1, Math.floor(samplePoint.x)));
    const y = Math.max(0, Math.min(height - 1, Math.floor(samplePoint.y)));
    enqueue(y * width + x);
  } else {
    for (let x = 0; x < width; x += 1) {
      enqueue(x);
      enqueue((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      enqueue(y * width);
      enqueue(y * width + width - 1);
    }
  }

  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x < width - 1) enqueue(index + 1);
    if (index >= width) enqueue(index - width);
    if (index < removableByPixel.length - width) enqueue(index + width);
    if (x > 0 && y > 0) enqueue(index - width - 1);
    if (x < width - 1 && y > 0) enqueue(index - width + 1);
    if (x > 0 && y < height - 1) enqueue(index + width - 1);
    if (x < width - 1 && y < height - 1) enqueue(index + width + 1);
  }

  return connected;
}

function expandOuterMask(
  outerMask: Uint8Array,
  removableByPixel: Uint8Array,
  width: number,
  height: number,
) {
  const expanded = new Uint8Array(outerMask);
  for (let index = 0; index < outerMask.length; index += 1) {
    if (outerMask[index] === 0 || removableByPixel[index] === 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (removableByPixel[next] === 1) expanded[next] = 1;
      }
    }
  }
  return expanded;
}

export function getChromaPreviewDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxPreviewEdge = 2048,
  maxPreviewPixels = 2_000_000,
) {
  const width = Math.max(1, Math.floor(sourceWidth));
  const height = Math.max(1, Math.floor(sourceHeight));
  const edgeScale = maxPreviewEdge > 0
    ? maxPreviewEdge / Math.max(width, height)
    : 1;
  const pixelScale = maxPreviewPixels > 0
    ? Math.sqrt(maxPreviewPixels / (width * height))
    : 1;
  const scale = Math.min(1, edgeScale, pixelScale);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function createChromaKeyPreviewInput(
  imageData: ImageData,
  maxPreviewEdge = 2048,
  maxPreviewPixels = 2_000_000,
) {
  const preview = getChromaPreviewDimensions(
    imageData.width,
    imageData.height,
    maxPreviewEdge,
    maxPreviewPixels,
  );
  if (preview.width === imageData.width && preview.height === imageData.height) {
    return {
      imageData,
      sourceWidth: imageData.width,
      sourceHeight: imageData.height,
    };
  }

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = imageData.width;
  sourceCanvas.height = imageData.height;
  const sourceCtx = sourceCanvas.getContext("2d");
  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = preview.width;
  targetCanvas.height = preview.height;
  const targetCtx = targetCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx || !targetCtx) {
    return {
      imageData,
      sourceWidth: imageData.width,
      sourceHeight: imageData.height,
    };
  }

  sourceCtx.putImageData(imageData, 0, 0);
  targetCtx.imageSmoothingEnabled = true;
  targetCtx.imageSmoothingQuality = "high";
  targetCtx.drawImage(sourceCanvas, 0, 0, preview.width, preview.height);
  return {
    imageData: targetCtx.getImageData(0, 0, preview.width, preview.height),
    sourceWidth: imageData.width,
    sourceHeight: imageData.height,
  };
}

export function renderChromaKeyResult(
  imageData: ImageData,
  params: ChromaKeyParams,
): ChromaKeyResult {
  const processed = processChromaKey(imageData, params);
  return {
    resultUrl: pixelsToDataUrl(imageData.width, imageData.height, processed.resultData),
    maskUrl: pixelsToDataUrl(imageData.width, imageData.height, processed.maskData),
    foregroundPixels: processed.foregroundPixels,
    totalPixels: processed.totalPixels,
  };
}

export function renderChromaKeyPreview(
  preview: ChromaPreviewInput,
  params: ChromaKeyParams,
): ChromaKeyResult {
  const processed = processChromaKey(preview.imageData, scaleChromaParamsForPreview(preview, params));
  return buildChromaKeyPreviewResult(preview, processed);
}

export function scaleChromaParamsForPreview(
  preview: ChromaPreviewInput,
  params: ChromaKeyParams,
): ChromaKeyParams {
  const scaleX = preview.imageData.width / preview.sourceWidth;
  const scaleY = preview.imageData.height / preview.sourceHeight;
  return {
    ...params,
    excludedColors: params.excludedColors.map((excluded) => ({
      ...excluded,
      point: {
        x: excluded.point.x * scaleX,
        y: excluded.point.y * scaleY,
      },
    })),
    samplePoint: params.samplePoint
      ? {
          x: params.samplePoint.x * scaleX,
          y: params.samplePoint.y * scaleY,
        }
      : undefined,
  };
}

export function buildChromaKeyPreviewResult(
  preview: ChromaPreviewInput,
  processed: ChromaPixelResult,
): ChromaKeyResult {
  const totalPixels = preview.sourceWidth * preview.sourceHeight;
  const previewPixels = preview.imageData.width * preview.imageData.height || 1;
  return {
    resultUrl: pixelsToDataUrl(
      preview.imageData.width,
      preview.imageData.height,
      processed.resultData,
    ),
    maskUrl: pixelsToDataUrl(
      preview.imageData.width,
      preview.imageData.height,
      processed.maskData,
    ),
    foregroundPixels: Math.round(processed.foregroundPixels * totalPixels / previewPixels),
    totalPixels,
  };
}

export async function renderChromaKeyExportBlob(
  imageData: ImageData,
  params: ChromaKeyParams,
) {
  const processed = processChromaKey(imageData, params);
  return chromaPixelsToBlob(imageData.width, imageData.height, processed.resultData);
}

export function sampleHexColor(imageData: PixelImageData, x: number, y: number) {
  const px = Math.max(0, Math.min(imageData.width - 1, Math.floor(x)));
  const py = Math.max(0, Math.min(imageData.height - 1, Math.floor(y)));
  const offset = (py * imageData.width + px) * 4;
  return rgbToHex(
    imageData.data[offset],
    imageData.data[offset + 1],
    imageData.data[offset + 2],
  );
}

export function canvasToImagePoint(
  screenX: number,
  screenY: number,
  pan: { x: number; y: number },
  zoom: number,
) {
  return {
    x: (screenX - pan.x) / zoom,
    y: (screenY - pan.y) / zoom,
  };
}

function pixelsToDataUrl(width: number, height: number, data: Uint8ClampedArray) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const output = ctx.createImageData(width, height);
  output.data.set(data);
  ctx.putImageData(output, 0, 0);
  return canvas.toDataURL("image/png");
}

export function chromaPixelsToBlob(width: number, height: number, data: Uint8ClampedArray) {
  return new Promise<Blob>((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(new Blob());
      return;
    }
    const output = ctx.createImageData(width, height);
    output.data.set(data);
    ctx.putImageData(output, 0, 0);
    canvas.toBlob((blob) => {
      resolve(blob ?? dataUrlToBlob(canvas.toDataURL("image/png")));
    }, "image/png");
  });
}

function dataUrlToBlob(dataUrl: string) {
  const [header, body] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);/)?.[1] ?? "image/png";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function hexToRgb(value: string): [number, number, number] {
  const normalized = value.trim().replace(/^#/, "");
  const full = normalized.length === 3
    ? normalized.split("").map((digit) => digit + digit).join("")
    : normalized.padEnd(6, "0").slice(0, 6);
  const parsed = Number.parseInt(full, 16);
  if (!Number.isFinite(parsed)) return [0, 255, 0];
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0] * 0.4124564 + linear[1] * 0.3575761 + linear[2] * 0.1804375) / 0.95047;
  const y = linear[0] * 0.2126729 + linear[1] * 0.7151522 + linear[2] * 0.072175;
  const z = (linear[0] * 0.0193339 + linear[1] * 0.119192 + linear[2] * 0.9503041) / 1.08883;
  const transform = (value: number) =>
    value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE76(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function smoothstep(low: number, high: number, value: number) {
  if (high <= low) return Number(value > high);
  const t = clamp01((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}

function normalizeRgb(r: number, g: number, b: number): [number, number, number] {
  const length = Math.hypot(r, g, b) || 1;
  return [r / length, g / length, b / length];
}

function despillRgb(
  r: number,
  g: number,
  b: number,
  keyUnit: [number, number, number],
  amount: number,
): [number, number, number] {
  const projection = r * keyUnit[0] + g * keyUnit[1] + b * keyUnit[2];
  const neutral = (r + g + b) / 3;
  const excess = Math.max(0, projection - neutral);
  return [
    clampByte(r - keyUnit[0] * excess * amount),
    clampByte(g - keyUnit[1] * excess * amount),
    clampByte(b - keyUnit[2] * excess * amount),
  ];
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
