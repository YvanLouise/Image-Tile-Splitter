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
  livePreview: true,
};

export function processChromaKey(
  imageData: PixelImageData,
  params: ChromaKeyParams,
): ChromaPixelResult {
  const resultData = new Uint8ClampedArray(imageData.data);
  const maskData = new Uint8ClampedArray(imageData.data.length);
  const [keyR, keyG, keyB] = hexToRgb(params.keyColor);
  const keyLab = rgbToLab(keyR, keyG, keyB);
  const threshold = Math.max(0, params.tolerance + params.edgeContract);
  const softness = Math.max(0, params.softness);
  const low = Math.max(0, threshold - softness / 2);
  const high = threshold + softness / 2;
  const despillStrength = clamp01(params.despill / 100);
  const keyUnit = normalizeRgb(keyR, keyG, keyB);
  let foregroundPixels = 0;

  for (let offset = 0; offset < imageData.data.length; offset += 4) {
    const r = imageData.data[offset];
    const g = imageData.data[offset + 1];
    const b = imageData.data[offset + 2];
    const sourceAlpha = imageData.data[offset + 3] / 255;
    const distance = deltaE76(rgbToLab(r, g, b), keyLab);
    let alpha = softness === 0
      ? Number(distance > threshold)
      : smoothstep(low, high, distance);
    if (params.invert) alpha = 1 - alpha;
    alpha *= sourceAlpha;

    const edgeAmount = (1 - alpha) * despillStrength;
    if (edgeAmount > 0 && !params.invert) {
      const corrected = despillRgb(r, g, b, keyUnit, edgeAmount);
      resultData[offset] = corrected[0];
      resultData[offset + 1] = corrected[1];
      resultData[offset + 2] = corrected[2];
    }
    const outputAlpha = Math.round(alpha * 255);
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
