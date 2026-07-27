import type {
  BoundingBox,
  NeighborMode,
  PanelDetectionSource,
  SegmentParams,
  SliceItem,
} from "../types";

export function createAlphaMask(
  imageData: ImageData,
  alphaThreshold: number,
): Uint8Array {
  const mask = new Uint8Array(imageData.width * imageData.height);
  const data = imageData.data;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    mask[p] = data[i + 3] > alphaThreshold ? 1 : 0;
  }
  return mask;
}

export function combineMasks(
  originalMask: Uint8Array,
  edits: Int8Array,
): Uint8Array {
  const finalMask = new Uint8Array(originalMask.length);
  for (let i = 0; i < originalMask.length; i += 1) {
    if (edits[i] === -1) finalMask[i] = 0;
    else if (edits[i] === 1) finalMask[i] = 1;
    else finalMask[i] = originalMask[i];
  }
  return finalMask;
}

export function segmentTransparentImage(
  imageData: ImageData,
  originalMask: Uint8Array,
  edits: Int8Array,
  params: SegmentParams,
): SliceItem[] {
  const finalMask = combineMasks(originalMask, edits);
  return connectedComponents(
    imageData,
    finalMask,
    imageData.width,
    imageData.height,
    params.neighborMode,
    params.minPixels,
    "slice",
  );
}

export function createComicContentMask(imageData: ImageData): Uint8Array {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const contentMask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      const colorSpread = Math.max(r, g, b) - Math.min(r, g, b);
      contentMask[y * width + x] = gray < 242 || colorSpread > 28 ? 1 : 0;
    }
  }

  return contentMask;
}

export function segmentMaskImage(
  imageData: ImageData,
  originalMask: Uint8Array,
  edits: Int8Array,
  params: SegmentParams,
  type: "slice" | "panel",
): SliceItem[] {
  const finalMask = combineMasks(originalMask, edits);
  return connectedComponents(
    imageData,
    finalMask,
    imageData.width,
    imageData.height,
    params.neighborMode,
    params.minPixels,
    type,
  );
}

export function detectComicPanels(
  imageData: ImageData,
  params: Pick<SegmentParams, "minPixels" | "neighborMode">,
): SliceItem[] {
  const width = imageData.width;
  const height = imageData.height;
  const contentMask = createComicContentMask(imageData);

  const components = connectedComponents(
    imageData,
    contentMask,
    width,
    height,
    params.neighborMode,
    Math.max(params.minPixels, Math.floor((width * height) / 1800)),
    "panel",
  );

  return mergeCloseComicBoxes(components, imageData);
}

export function makeRectPanel(
  imageData: ImageData,
  box: BoundingBox,
  id: number,
  order: number,
): SliceItem {
  const normalized = normalizeBox(box, imageData.width, imageData.height);
  const mask = new Uint8Array(normalized.width * normalized.height);
  mask.fill(1);
  return buildSliceItem(imageData, normalized, mask, normalized.width * normalized.height, {
    id,
    order,
    type: "panel",
    source: "manual",
    confidence: 1,
  });
}

export function makePolygonPanel(
  imageData: ImageData,
  points: Array<{ x: number; y: number }>,
  id: number,
  order: number,
): SliceItem {
  const minX = Math.floor(Math.min(...points.map((p) => p.x)));
  const maxX = Math.ceil(Math.max(...points.map((p) => p.x)));
  const minY = Math.floor(Math.min(...points.map((p) => p.y)));
  const maxY = Math.ceil(Math.max(...points.map((p) => p.y)));
  const box = normalizeBox(
    { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    imageData.width,
    imageData.height,
  );
  const mask = new Uint8Array(box.width * box.height);
  let pixelCount = 0;
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      if (pointInPolygon(box.x + x + 0.5, box.y + y + 0.5, points)) {
        mask[y * box.width + x] = 1;
        pixelCount += 1;
      }
    }
  }
  return buildSliceItem(imageData, box, mask, pixelCount, {
    id,
    order,
    type: "panel",
    polygon: points,
    source: "manual",
    confidence: 1,
  });
}

export function mergeItems(
  imageData: ImageData,
  items: SliceItem[],
  id: number,
  order: number,
): SliceItem | null {
  if (items.length === 0) return null;
  const minX = Math.min(...items.map((item) => item.boundingBox.x));
  const minY = Math.min(...items.map((item) => item.boundingBox.y));
  const maxX = Math.max(
    ...items.map((item) => item.boundingBox.x + item.boundingBox.width),
  );
  const maxY = Math.max(
    ...items.map((item) => item.boundingBox.y + item.boundingBox.height),
  );
  const box = normalizeBox(
    { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    imageData.width,
    imageData.height,
  );
  const mask = new Uint8Array(box.width * box.height);
  let pixelCount = 0;

  for (const item of items) {
    const itemBox = item.boundingBox;
    for (let y = 0; y < itemBox.height; y += 1) {
      for (let x = 0; x < itemBox.width; x += 1) {
        if (item.mask[y * itemBox.width + x] === 0) continue;
        const tx = itemBox.x + x - box.x;
        const ty = itemBox.y + y - box.y;
        const target = ty * box.width + tx;
        if (mask[target] === 0) {
          mask[target] = 1;
          pixelCount += 1;
        }
      }
    }
  }

  return buildSliceItem(imageData, box, mask, pixelCount, {
    id,
    order,
    type: items.some((item) => item.type === "panel") ? "panel" : "slice",
    source: items.some((item) => item.type === "panel") ? "manual" : undefined,
    confidence: items.some((item) => item.type === "panel") ? 1 : undefined,
  });
}

export function findItemsIntersectingBox(items: SliceItem[], selection: BoundingBox) {
  const selectionRight = selection.x + selection.width;
  const selectionBottom = selection.y + selection.height;
  return items.filter((item) => {
    const box = item.boundingBox;
    return (
      box.x < selectionRight &&
      box.x + box.width > selection.x &&
      box.y < selectionBottom &&
      box.y + box.height > selection.y
    );
  });
}

export function replaceItemsWithMerge(
  items: SliceItem[],
  mergedItems: SliceItem[],
  merged: SliceItem,
) {
  const mergedIds = new Set(mergedItems.map((item) => item.id));
  return [...items.filter((item) => !mergedIds.has(item.id)), merged]
    .sort((a, b) => a.order - b.order)
    .map((item, order) => ({ ...item, order }));
}

export function applyBrushEdit(
  edits: Int8Array,
  width: number,
  height: number,
  point: { x: number; y: number },
  radius: number,
  value: -1 | 0 | 1,
) {
  const minX = Math.max(0, Math.floor(point.x - radius));
  const maxX = Math.min(width - 1, Math.ceil(point.x + radius));
  const minY = Math.max(0, Math.floor(point.y - radius));
  const maxY = Math.min(height - 1, Math.ceil(point.y + radius));
  const r2 = radius * radius;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - point.x;
      const dy = y - point.y;
      if (dx * dx + dy * dy <= r2) edits[y * width + x] = value;
    }
  }
}

export function applyLineEdit(
  edits: Int8Array,
  width: number,
  height: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius: number,
  value: -1 | 0 | 1,
) {
  const steps = Math.max(1, Math.ceil(distance(from, to)));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    applyBrushEdit(
      edits,
      width,
      height,
      { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
      radius,
      value,
    );
  }
}

export function buildSliceItem(
  imageData: ImageData,
  box: BoundingBox,
  mask: Uint8Array,
  pixelCount: number,
  meta: {
    id: number;
    order: number;
    type: "slice" | "panel";
    polygon?: Array<{ x: number; y: number }>;
    confidence?: number;
    source?: PanelDetectionSource;
  },
): SliceItem {
  const previewUrl = renderItemUrl(imageData, box, mask, 160);
  return {
    id: meta.id,
    type: meta.type,
    boundingBox: box,
    pixelCount,
    mask,
    previewUrl,
    exportUrl: "",
    order: meta.order,
    polygon: meta.polygon,
    confidence: meta.confidence,
    source: meta.source,
  };
}

export function renderSliceItemUrl(imageData: ImageData, item: Pick<SliceItem, "boundingBox" | "mask">) {
  return renderItemUrl(imageData, item.boundingBox, item.mask);
}

export function connectedComponents(
  imageData: ImageData,
  mask: Uint8Array,
  width: number,
  height: number,
  neighborMode: NeighborMode,
  minPixels: number,
  type: "slice" | "panel",
): SliceItem[] {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const items: SliceItem[] = [];
  const neighbors =
    neighborMode === 8
      ? [
          [-1, -1],
          [0, -1],
          [1, -1],
          [-1, 0],
          [1, 0],
          [-1, 1],
          [0, 1],
          [1, 1],
        ]
      : [
          [0, -1],
          [-1, 0],
          [1, 0],
          [0, 1],
        ];

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let pixelCount = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    queue[tail] = start;
    tail += 1;
    visited[start] = 1;

    while (head < tail) {
      const idx = queue[head];
      head += 1;
      pixelCount += 1;
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (visited[next] || mask[next] === 0) continue;
        visited[next] = 1;
        queue[tail] = next;
        tail += 1;
      }
    }

    if (pixelCount < minPixels) continue;
    const box = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
    const localMask = new Uint8Array(box.width * box.height);
    for (let i = 0; i < tail; i += 1) {
      const source = queue[i];
      const x = source % width;
      const y = Math.floor(source / width);
      localMask[(y - box.y) * box.width + (x - box.x)] = 1;
    }
    items.push(
      buildSliceItem(imageData, box, localMask, pixelCount, {
        id: items.length + 1,
        order: items.length,
        type,
      }),
    );
  }

  return items.sort((a, b) => a.boundingBox.y - b.boundingBox.y || a.boundingBox.x - b.boundingBox.x)
    .map((item, index) => ({ ...item, id: index + 1, order: index }));
}

function renderItemUrl(
  imageData: ImageData,
  box: BoundingBox,
  mask: Uint8Array,
  maxPreviewEdge = Number.POSITIVE_INFINITY,
) {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, maxPreviewEdge / Math.max(box.width, box.height));
  canvas.width = Math.max(1, Math.round(box.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const out = ctx.createImageData(canvas.width, canvas.height);
  const src = imageData.data;
  const dst = out.data;
  const sourceWidth = imageData.width;

  for (let y = 0; y < canvas.height; y += 1) {
    const sourceY = Math.min(box.height - 1, Math.floor(y / scale));
    for (let x = 0; x < canvas.width; x += 1) {
      const sourceX = Math.min(box.width - 1, Math.floor(x / scale));
      const local = sourceY * box.width + sourceX;
      if (mask[local] === 0) continue;
      const srcIdx = ((box.y + sourceY) * sourceWidth + (box.x + sourceX)) * 4;
      const dstIdx = (y * canvas.width + x) * 4;
      dst[dstIdx] = src[srcIdx];
      dst[dstIdx + 1] = src[srcIdx + 1];
      dst[dstIdx + 2] = src[srcIdx + 2];
      dst[dstIdx + 3] = src[srcIdx + 3];
    }
  }

  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL("image/png");
}

function mergeCloseComicBoxes(items: SliceItem[], imageData: ImageData): SliceItem[] {
  const pageArea = imageData.width * imageData.height;
  return items
    .filter((item) => {
      const box = item.boundingBox;
      const area = box.width * box.height;
      return area < pageArea * 0.92 && box.width > 8 && box.height > 8;
    })
    .slice(0, 80)
    .sort((a, b) => a.boundingBox.y - b.boundingBox.y || a.boundingBox.x - b.boundingBox.x)
    .map((item, index) => ({ ...item, id: index + 1, order: index }));
}

function normalizeBox(box: BoundingBox, width: number, height: number): BoundingBox {
  const x = Math.max(0, Math.min(width - 1, Math.floor(Math.min(box.x, box.x + box.width))));
  const y = Math.max(0, Math.min(height - 1, Math.floor(Math.min(box.y, box.y + box.height))));
  const right = Math.max(0, Math.min(width, Math.ceil(Math.max(box.x, box.x + box.width))));
  const bottom = Math.max(0, Math.min(height, Math.ceil(Math.max(box.y, box.y + box.height))));
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
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

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
