import { describe, expect, it } from "vitest";
import { buildMetadata } from "./exportAssets";
import {
  candidatesToItems,
  defaultComicDetectionParams,
  detectComicPanelsAdvanced,
  detectComicPanelsFallback,
} from "./comicDetection";
import { makeRectPanel } from "./imageSegmentation";
import type { LoadedImage } from "../types";

describe("comic panel detection", () => {
  it("detects a 2x2 page separated by white gutters", () => {
    const imageData = createImageDataLike(240, 180, [255, 255, 255, 255]);
    fillRect(imageData, 12, 12, 92, 66, [215, 215, 215, 255]);
    fillRect(imageData, 136, 12, 92, 66, [215, 215, 215, 255]);
    fillRect(imageData, 12, 102, 92, 66, [215, 215, 215, 255]);
    fillRect(imageData, 136, 102, 92, 66, [215, 215, 215, 255]);

    const panels = detectComicPanelsFallback(imageData, defaultComicDetectionParams);

    expect(panels).toHaveLength(4);
    expect(panels.map((panel) => panel.order)).toEqual([0, 1, 2, 3]);
    expect(panels.every((panel) => panel.source === "fallback")).toBe(true);
  });

  it("detects a black bordered page panel as one candidate", () => {
    const imageData = createImageDataLike(220, 160, [255, 255, 255, 255]);
    strokeRect(imageData, 18, 16, 184, 120, [0, 0, 0, 255], 4);
    fillRect(imageData, 34, 34, 42, 28, [120, 120, 120, 255]);

    const panels = detectComicPanelsFallback(imageData, {
      ...defaultComicDetectionParams,
      maxPanelAreaRatio: 0.9,
    });

    expect(panels.length).toBeGreaterThanOrEqual(1);
    expect(panels[0].boundingBox.x).toBeLessThanOrEqual(22);
    expect(panels[0].boundingBox.y).toBeLessThanOrEqual(20);
  });

  it("filters small noise", () => {
    const imageData = createImageDataLike(200, 140, [255, 255, 255, 255]);
    fillRect(imageData, 40, 30, 3, 3, [0, 0, 0, 255]);

    const panels = detectComicPanelsFallback(imageData, defaultComicDetectionParams);

    expect(panels).toHaveLength(0);
  });

  it("uses polygon masks for irregular candidates", () => {
    const imageData = createImageDataLike(120, 90, [180, 180, 180, 255]);
    const [panel] = candidatesToItems(
      imageData,
      [
        {
          box: { x: 10, y: 10, width: 80, height: 60 },
          polygon: [
            { x: 20, y: 10 },
            { x: 90, y: 20 },
            { x: 80, y: 70 },
            { x: 10, y: 60 },
          ],
          confidence: 0.8,
        },
      ],
      "fallback",
    );

    expect(panel.polygon).toHaveLength(4);
    expect(panel.pixelCount).toBeGreaterThan(0);
    expect(panel.pixelCount).toBeLessThan(80 * 60);
    expect(panel.mask.some((value) => value === 0)).toBe(true);
  });

  it("keeps rectangular polygon candidates as full panels", () => {
    const imageData = createImageDataLike(120, 90, [180, 180, 180, 255]);
    const [panel] = candidatesToItems(
      imageData,
      [
        {
          box: { x: 10, y: 10, width: 80, height: 60 },
          polygon: [
            { x: 10, y: 10 },
            { x: 90, y: 10 },
            { x: 90, y: 70 },
            { x: 10, y: 70 },
          ],
          confidence: 0.8,
        },
      ],
      "opencv",
    );

    expect(panel.pixelCount).toBe(80 * 60);
    expect(panel.mask.every((value) => value === 1)).toBe(true);
  });

  it("preserves white speech bubbles inside detected panels", () => {
    const imageData = createImageDataLike(180, 120, [255, 255, 255, 255]);
    fillRect(imageData, 12, 12, 156, 88, [230, 230, 230, 255]);
    fillRect(imageData, 54, 28, 62, 28, [255, 255, 255, 255]);
    strokeRect(imageData, 54, 28, 62, 28, [0, 0, 0, 255], 2);

    const panels = detectComicPanelsFallback(imageData, {
      ...defaultComicDetectionParams,
      maxPanelAreaRatio: 0.9,
    });
    const panel = panels[0];
    const bubbleX = 60 - panel.boundingBox.x;
    const bubbleY = 34 - panel.boundingBox.y;

    expect(panel.mask[bubbleY * panel.boundingBox.width + bubbleX]).toBe(1);
  });

  it("falls back when OpenCV cannot load", async () => {
    const imageData = createImageDataLike(160, 120, [255, 255, 255, 255]);
    fillRect(imageData, 14, 12, 132, 90, [190, 190, 190, 255]);

    const result = await detectComicPanelsAdvanced(imageData, defaultComicDetectionParams);

    expect(result.engine).toBe("fallback");
    expect(result.warning).toContain("OpenCV");
  });
});

describe("metadata export ordering", () => {
  it("exports metadata in current order", () => {
    const imageData = createImageDataLike(100, 80, [255, 255, 255, 255]);
    const source: LoadedImage = {
      fileName: "test.png",
      width: 100,
      height: 80,
      size: 10,
      url: "",
      bitmap: {} as ImageBitmap,
      imageData,
    };
    const second = makeRectPanel(imageData, { x: 50, y: 10, width: 20, height: 20 }, 2, 0);
    const first = makeRectPanel(imageData, { x: 10, y: 10, width: 20, height: 20 }, 1, 1);

    const metadata = buildMetadata(source, [first, second]);

    expect(metadata.items.map((item) => item.id)).toEqual([2, 1]);
  });
});

function createImageDataLike(
  width: number,
  height: number,
  color: [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = color[3];
  }
  return { width, height, data } as ImageData;
}

function fillRect(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number, number],
) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      setPixel(imageData, px, py, color);
    }
  }
}

function strokeRect(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number, number],
  thickness: number,
) {
  fillRect(imageData, x, y, width, thickness, color);
  fillRect(imageData, x, y + height - thickness, width, thickness, color);
  fillRect(imageData, x, y, thickness, height, color);
  fillRect(imageData, x + width - thickness, y, thickness, height, color);
}

function setPixel(
  imageData: ImageData,
  x: number,
  y: number,
  color: [number, number, number, number],
) {
  const idx = (y * imageData.width + x) * 4;
  imageData.data[idx] = color[0];
  imageData.data[idx + 1] = color[1];
  imageData.data[idx + 2] = color[2];
  imageData.data[idx + 3] = color[3];
}
