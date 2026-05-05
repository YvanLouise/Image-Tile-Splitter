import type { BoundingBox, ComicDetectionParams, SliceItem } from "../types";
import { buildSliceItem, connectedComponents, createComicContentMask } from "./imageSegmentation";
import { loadOpenCv } from "./opencvLoader";

export const defaultComicDetectionParams: ComicDetectionParams = {
  gutterSensitivity: 58,
  borderSensitivity: 54,
  minPanelAreaRatio: 0.015,
  maxPanelAreaRatio: 0.82,
  approxEpsilonRatio: 0.025,
  mergeNearbyPanels: true,
  showConfidence: true,
};

export interface ComicDetectionResult {
  items: SliceItem[];
  engine: "opencv" | "fallback";
  warning?: string;
}

interface PanelCandidate {
  box: BoundingBox;
  mask?: Uint8Array;
  polygon?: Array<{ x: number; y: number }>;
  confidence: number;
}

export async function detectComicPanelsAdvanced(
  imageData: ImageData,
  params: ComicDetectionParams,
): Promise<ComicDetectionResult> {
  try {
    const items = await detectComicPanelsWithOpenCv(imageData, params);
    const fallbackItems = detectComicPanelsFallback(imageData, params);
    if (hasIrregularMasks(fallbackItems) && fallbackItems.length >= Math.max(2, items.length)) {
      return { items: fallbackItems, engine: "fallback" };
    }
    if (items.length > 0) return { items, engine: "opencv" };
    return {
      items: fallbackItems,
      engine: "fallback",
      warning: "OpenCV 未找到稳定漫画格，已使用基础规则检测。",
    };
  } catch (error) {
    return {
      items: detectComicPanelsFallback(imageData, params),
      engine: "fallback",
      warning: `OpenCV 加载或检测失败，已使用基础规则检测。${error instanceof Error ? error.message : ""}`,
    };
  }
}

export async function detectComicPanelsWithOpenCv(
  imageData: ImageData,
  params: ComicDetectionParams,
): Promise<SliceItem[]> {
  const cv = await loadOpenCv();
  const mats: any[] = [];
  const vectors: any[] = [];

  try {
    const src = cv.matFromImageData(imageData);
    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const binary = new cv.Mat();
    const edges = new cv.Mat();
    const morphed = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const kernelSize = Math.max(3, makeOdd(Math.round(3 + params.gutterSensitivity / 18)));
    const kernel = cv.getStructuringElement(
      cv.MORPH_RECT,
      new cv.Size(kernelSize, kernelSize),
    );
    mats.push(src, gray, blurred, binary, edges, morphed, hierarchy, kernel);
    vectors.push(contours);

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.adaptiveThreshold(
      blurred,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      makeOdd(Math.max(11, Math.round(19 + params.gutterSensitivity / 4))),
      Math.max(2, Math.round(12 - params.borderSensitivity / 12)),
    );
    cv.Canny(blurred, edges, 40, Math.max(90, params.borderSensitivity * 3));
    cv.bitwise_or(binary, edges, morphed);
    cv.morphologyEx(morphed, morphed, cv.MORPH_CLOSE, kernel);
    cv.findContours(morphed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates: PanelCandidate[] = [];
    const pageArea = imageData.width * imageData.height;
    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      const approx = new cv.Mat();
      mats.push(contour, approx);
      const perimeter = cv.arcLength(contour, true);
      cv.approxPolyDP(contour, approx, params.approxEpsilonRatio * perimeter, true);
      const rect = cv.boundingRect(approx);
      const box = clampBox(
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        imageData.width,
        imageData.height,
      );
      const area = box.width * box.height;
      const contourArea = Math.abs(cv.contourArea(contour));
      if (!isPanelBox(box, pageArea, params)) continue;
      const fillRatio = contourArea / Math.max(1, area);
      const rectangularity = Math.min(1, contourArea / Math.max(1, area));
      const confidence = clamp01(0.35 + fillRatio * 0.35 + rectangularity * 0.3);
      candidates.push({
        box,
        polygon: matToPolygon(approx),
        confidence,
      });
    }

    return candidatesToItems(imageData, refineCandidates(candidates, params), "opencv");
  } finally {
    for (const vector of vectors) vector.delete?.();
    for (const mat of mats) mat.delete?.();
  }
}

export function detectComicPanelsFallback(
  imageData: ImageData,
  params: ComicDetectionParams,
): SliceItem[] {
  const gutterItems = detectPanelsByBorderConnectedGutters(imageData, params);
  if (gutterItems.length > 0) return gutterItems;

  const candidates = detectPanelsByWhitespace(imageData, params);
  if (candidates.length > 0) {
    return candidatesToItems(imageData, candidates, "fallback");
  }

  const mask = createComicContentMask(imageData);
  const components = connectedComponents(
    imageData,
    mask,
    imageData.width,
    imageData.height,
    8,
    Math.max(20, Math.floor((imageData.width * imageData.height) / 1600)),
    "panel",
  );

  const pageArea = imageData.width * imageData.height;
  return components
    .filter((item) => isPanelBox(item.boundingBox, pageArea, params))
    .map((item) => ({
      box: item.boundingBox,
      confidence: 0.45,
    }))
    .slice(0, 80)
    .map((candidate, index) =>
      candidatesToItems(imageData, [{ ...candidate, confidence: candidate.confidence }], "fallback")
        .map((item) => ({ ...item, id: index + 1, order: index }))[0],
    );
}

export function candidatesToItems(
  imageData: ImageData,
  candidates: PanelCandidate[],
  source: "opencv" | "fallback",
): SliceItem[] {
  return sortReadingOrder(candidates)
    .map((candidate, index) => {
      const mask = new Uint8Array(candidate.box.width * candidate.box.height);
      let pixelCount = 0;
      const usePolygonMask = shouldUsePolygonMask(candidate);
      if (candidate.mask) {
        mask.set(candidate.mask);
        for (const value of mask) {
          if (value) pixelCount += 1;
        }
      } else if (!usePolygonMask) {
        mask.fill(1);
        pixelCount = candidate.box.width * candidate.box.height;
      } else {
        for (let y = 0; y < candidate.box.height; y += 1) {
          for (let x = 0; x < candidate.box.width; x += 1) {
            const imageX = candidate.box.x + x;
            const imageY = candidate.box.y + y;
            if (!pointInPolygon(imageX + 0.5, imageY + 0.5, candidate.polygon!)) continue;
            mask[y * candidate.box.width + x] = 1;
            pixelCount += 1;
          }
        }
      }
      return buildSliceItem(imageData, candidate.box, mask, pixelCount, {
        id: index + 1,
        order: index,
        type: "panel",
        polygon: candidate.polygon,
        confidence: candidate.confidence,
        source,
      });
    });
}

function detectPanelsByBorderConnectedGutters(
  imageData: ImageData,
  params: ComicDetectionParams,
): SliceItem[] {
  const width = imageData.width;
  const height = imageData.height;
  const pageArea = width * height;
  const whiteThreshold = 205 + params.gutterSensitivity * 0.45;
  const externalGutter = floodFillExternalGutters(imageData, whiteThreshold);
  const panelMask = new Uint8Array(pageArea);

  for (let i = 0; i < pageArea; i += 1) {
    panelMask[i] = externalGutter[i] ? 0 : 1;
  }

  const rawItems = connectedComponents(
    imageData,
    panelMask,
    width,
    height,
    8,
    Math.max(20, Math.floor(pageArea * params.minPanelAreaRatio)),
    "panel",
  );

  return rawItems
    .filter((item) => isPanelBox(item.boundingBox, pageArea, params))
    .filter((item) => estimateContentScore(imageData, item.boundingBox, whiteThreshold) >= 0.005)
    .slice(0, 80)
    .sort((a, b) => a.boundingBox.y - b.boundingBox.y || a.boundingBox.x - b.boundingBox.x)
    .map((item, index) => ({
      ...item,
      id: index + 1,
      order: index,
      source: "fallback" as const,
      confidence: irregularityScore(item) > 0.05 ? 0.72 : 0.62,
    }));
}

function floodFillExternalGutters(imageData: ImageData, whiteThreshold: number) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const enqueue = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * width + x;
    if (visited[idx] || !isGutterPixel(data, idx, whiteThreshold)) return;
    visited[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const x = idx % width;
    const y = Math.floor(idx / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  return visited;
}

function detectPanelsByWhitespace(
  imageData: ImageData,
  params: ComicDetectionParams,
): PanelCandidate[] {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const whiteThreshold = 205 + params.gutterSensitivity * 0.45;
  const rowWhitespace = new Float32Array(height);
  const colWhitespace = new Float32Array(width);

  for (let y = 0; y < height; y += 1) {
    let whiteCount = 0;
    for (let x = 0; x < width; x += 1) {
      if (isGutterPixel(data, y * width + x, whiteThreshold)) whiteCount += 1;
    }
    rowWhitespace[y] = whiteCount / width;
  }
  for (let x = 0; x < width; x += 1) {
    let whiteCount = 0;
    for (let y = 0; y < height; y += 1) {
      if (isGutterPixel(data, y * width + x, whiteThreshold)) whiteCount += 1;
    }
    colWhitespace[x] = whiteCount / height;
  }

  const minGap = Math.max(6, Math.round(Math.min(width, height) * 0.012));
  const rowCuts = rangesToCuts(findWhitespaceRuns(rowWhitespace, 0.965, minGap), height);
  const colCuts = rangesToCuts(findWhitespaceRuns(colWhitespace, 0.965, minGap), width);
  if (rowCuts.length < 2 || colCuts.length < 2) return [];

  const pageArea = width * height;
  const candidates: PanelCandidate[] = [];
  for (let yi = 0; yi < rowCuts.length - 1; yi += 1) {
    for (let xi = 0; xi < colCuts.length - 1; xi += 1) {
      const box = clampBox(
        {
          x: colCuts[xi],
          y: rowCuts[yi],
          width: colCuts[xi + 1] - colCuts[xi],
          height: rowCuts[yi + 1] - rowCuts[yi],
        },
        width,
        height,
      );
      if (!isPanelBox(box, pageArea, params)) continue;
      const contentScore = estimateContentScore(imageData, box, whiteThreshold);
      if (contentScore < 0.005) continue;
      candidates.push({
        box,
        confidence: clamp01(0.55 + contentScore * 0.8),
      });
    }
  }

  return refineCandidates(candidates, params);
}

function refineCandidates(candidates: PanelCandidate[], params: ComicDetectionParams) {
  const sorted = sortReadingOrder(candidates).filter((candidate, index, all) => {
    return !all.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.confidence >= candidate.confidence &&
        overlapRatio(candidate.box, other.box) > 0.82 &&
        area(other.box) >= area(candidate.box),
    );
  });

  if (!params.mergeNearbyPanels) return sorted;
  return sorted;
}

function sortReadingOrder<T extends { box: BoundingBox }>(items: T[]): T[] {
  const averageHeight =
    items.reduce((sum, item) => sum + item.box.height, 0) / Math.max(1, items.length);
  return [...items].sort((a, b) => {
    const rowA = Math.round(a.box.y / Math.max(1, averageHeight * 0.65));
    const rowB = Math.round(b.box.y / Math.max(1, averageHeight * 0.65));
    return rowA - rowB || a.box.x - b.box.x || a.box.y - b.box.y;
  });
}

function findWhitespaceRuns(values: Float32Array, threshold: number, minLength: number) {
  const runs: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] >= threshold) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= minLength) runs.push({ start, end: i });
      start = -1;
    }
  }
  if (start >= 0 && values.length - start >= minLength) {
    runs.push({ start, end: values.length });
  }
  return runs;
}

function rangesToCuts(runs: Array<{ start: number; end: number }>, limit: number) {
  const cuts = [0];
  for (const run of runs) cuts.push(Math.round((run.start + run.end) / 2));
  cuts.push(limit);
  return [...new Set(cuts)].sort((a, b) => a - b);
}

function isPanelBox(box: BoundingBox, pageArea: number, params: ComicDetectionParams) {
  const boxArea = area(box);
  if (box.width < 12 || box.height < 12) return false;
  if (boxArea < pageArea * params.minPanelAreaRatio) return false;
  if (boxArea > pageArea * params.maxPanelAreaRatio) return false;
  const aspect = box.width / Math.max(1, box.height);
  return aspect > 0.12 && aspect < 8;
}

function estimateContentScore(imageData: ImageData, box: BoundingBox, whiteThreshold: number) {
  const data = imageData.data;
  let content = 0;
  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      if (!isGutterPixel(data, y * imageData.width + x, whiteThreshold)) content += 1;
    }
  }
  return content / Math.max(1, area(box));
}

function isGutterPixel(data: Uint8ClampedArray, pixelIndex: number, threshold: number) {
  const idx = pixelIndex * 4;
  return data[idx] >= threshold && data[idx + 1] >= threshold && data[idx + 2] >= threshold;
}

function matToPolygon(mat: any): Array<{ x: number; y: number }> | undefined {
  if (!mat.data32S || mat.rows < 3) return undefined;
  const polygon: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < mat.data32S.length; i += 2) {
    polygon.push({ x: mat.data32S[i], y: mat.data32S[i + 1] });
  }
  return polygon.length >= 3 ? polygon : undefined;
}

function shouldUsePolygonMask(candidate: PanelCandidate) {
  if (!candidate.polygon || candidate.polygon.length < 3) return false;
  const polygonAreaValue = polygonArea(candidate.polygon);
  const boxArea = area(candidate.box);
  if (polygonAreaValue <= 0 || boxArea <= 0) return false;
  const coverage = polygonAreaValue / boxArea;
  if (coverage > 0.96) return false;
  return candidate.polygon.length !== 4 || coverage < 0.9;
}

function pointInPolygon(
  x: number,
  y: number,
  polygon: Array<{ x: number; y: number }>,
) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects =
      pi.y > y !== pj.y > y &&
      x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y + Number.EPSILON) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonArea(polygon: Array<{ x: number; y: number }>) {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    sum += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
  }
  return Math.abs(sum / 2);
}

function hasIrregularMasks(items: SliceItem[]) {
  return items.some((item) => irregularityScore(item) > 0.05);
}

function irregularityScore(item: Pick<SliceItem, "boundingBox" | "pixelCount">) {
  const boxArea = area(item.boundingBox);
  if (boxArea <= 0) return 0;
  return 1 - item.pixelCount / boxArea;
}

function overlapRatio(a: BoundingBox, b: BoundingBox) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return intersection / Math.max(1, Math.min(area(a), area(b)));
}

function clampBox(box: BoundingBox, width: number, height: number): BoundingBox {
  const x = Math.max(0, Math.min(width - 1, Math.floor(box.x)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(box.y)));
  const right = Math.max(x + 1, Math.min(width, Math.ceil(box.x + box.width)));
  const bottom = Math.max(y + 1, Math.min(height, Math.ceil(box.y + box.height)));
  return { x, y, width: right - x, height: bottom - y };
}

function makeOdd(value: number) {
  return value % 2 === 1 ? value : value + 1;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function area(box: BoundingBox) {
  return box.width * box.height;
}
