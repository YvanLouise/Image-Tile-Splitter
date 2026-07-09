import type { ChromaKeyParams, ChromaKeyResult } from "../types";

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

export const defaultChromaKeyParams: ChromaKeyParams = {
  keyColor: "#00ff00",
  tolerance: 26,
  softness: 18,
  edgeContract: 0,
  despill: 55,
  invert: false,
  outerOnly: false,
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
  const threshold = Math.max(0, normalizedParams.tolerance + normalizedParams.edgeContract);
  const softness = Math.max(0, normalizedParams.softness);
  const low = Math.max(0, threshold - softness / 2);
  const high = threshold + softness / 2;
  const despillStrength = clamp01(normalizedParams.despill / 100);
  const keyUnit = normalizeRgb(keyR, keyG, keyB);
  const pixelCount = imageData.width * imageData.height;
  const alphaByPixel = new Uint8ClampedArray(pixelCount);
  const removableByPixel = new Uint8Array(pixelCount);
  let foregroundPixels = 0;

  for (let offset = 0, pixel = 0; offset < imageData.data.length; offset += 4, pixel += 1) {
    const r = imageData.data[offset];
    const g = imageData.data[offset + 1];
    const b = imageData.data[offset + 2];
    const sourceAlpha = imageData.data[offset + 3] / 255;
    const distance = deltaE76(rgbToLab(r, g, b), keyLab);
    let alpha = softness === 0
      ? Number(distance > threshold)
      : smoothstep(low, high, distance);
    if (normalizedParams.invert) alpha = 1 - alpha;
    alpha *= sourceAlpha;
    const outputAlpha = Math.round(alpha * 255);
    alphaByPixel[pixel] = outputAlpha;
    removableByPixel[pixel] = outputAlpha < imageData.data[offset + 3] ? 1 : 0;
  }

  const outerMask = normalizedParams.outerOnly
    ? traceOuterRemovablePixels(
        removableByPixel,
        imageData.width,
        imageData.height,
        normalizedParams.outerMode,
        normalizedParams.samplePoint,
      )
    : null;

  for (let offset = 0, pixel = 0; offset < imageData.data.length; offset += 4, pixel += 1) {
    const r = imageData.data[offset];
    const g = imageData.data[offset + 1];
    const b = imageData.data[offset + 2];
    const sourceAlphaByte = imageData.data[offset + 3];
    const shouldApplyKey = !outerMask || outerMask[pixel] === 1;
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
    outerOnly: params.outerOnly ?? defaultChromaKeyParams.outerOnly,
    outerMode: params.outerMode ?? defaultChromaKeyParams.outerMode,
    samplePoint: params.samplePoint,
  };
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
    if (x > 0) enqueue(index - 1);
    if (x < width - 1) enqueue(index + 1);
    if (index >= width) enqueue(index - width);
    if (index < removableByPixel.length - width) enqueue(index + width);
  }

  return connected;
}

function scaleImageDataForPreview(
  imageData: ImageData,
  params: ChromaKeyParams,
  maxPreviewEdge: number,
) {
  const maxSourceEdge = Math.max(imageData.width, imageData.height);
  const scale = maxSourceEdge > 0 ? Math.min(1, maxPreviewEdge / maxSourceEdge) : 1;
  if (scale >= 1) return { imageData, params };

  const width = Math.max(1, Math.round(imageData.width * scale));
  const height = Math.max(1, Math.round(imageData.height * scale));
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = imageData.width;
  sourceCanvas.height = imageData.height;
  const sourceCtx = sourceCanvas.getContext("2d");
  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = width;
  targetCanvas.height = height;
  const targetCtx = targetCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx || !targetCtx) return { imageData, params };

  sourceCtx.putImageData(imageData, 0, 0);
  targetCtx.imageSmoothingEnabled = true;
  targetCtx.imageSmoothingQuality = "medium";
  targetCtx.drawImage(sourceCanvas, 0, 0, width, height);
  return {
    imageData: targetCtx.getImageData(0, 0, width, height),
    params: {
      ...params,
      samplePoint: params.samplePoint
        ? {
            x: params.samplePoint.x * scale,
            y: params.samplePoint.y * scale,
          }
        : undefined,
    },
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
  imageData: ImageData,
  params: ChromaKeyParams,
  maxPreviewEdge = 900,
): ChromaKeyResult {
  const preview = scaleImageDataForPreview(imageData, params, maxPreviewEdge);
  const processed = processChromaKey(preview.imageData, preview.params);
  const totalPixels = imageData.width * imageData.height;
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
  return pixelsToBlob(imageData.width, imageData.height, processed.resultData);
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

function pixelsToBlob(width: number, height: number, data: Uint8ClampedArray) {
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
