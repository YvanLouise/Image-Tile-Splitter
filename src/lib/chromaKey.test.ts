import { describe, expect, it } from "vitest";
import {
  canvasToImagePoint,
  defaultChromaKeyParams,
  getChromaPreviewDimensions,
  processChromaKey,
  sampleHexColor,
} from "./chromaKey";
import type { ChromaKeyParams } from "../types";

function image(pixels: number[][]) {
  return {
    width: pixels.length,
    height: 1,
    data: new Uint8ClampedArray(pixels.flat()),
  };
}

function imageGrid(rows: number[][][]) {
  return {
    width: rows[0]?.length ?? 0,
    height: rows.length,
    data: new Uint8ClampedArray(rows.flat(2)),
  };
}

describe("processChromaKey", () => {
  it("removes a green key while preserving a distant foreground color", () => {
    const result = processChromaKey(
      image([
        [0, 255, 0, 255],
        [220, 30, 30, 255],
      ]),
      { ...defaultChromaKeyParams, softness: 0, despill: 0 },
    );
    expect(result.resultData[3]).toBe(0);
    expect(result.resultData[7]).toBe(255);
    expect(result.foregroundPixels).toBe(1);
  });

  it("supports blue keys and partially transparent source pixels", () => {
    const result = processChromaKey(
      image([
        [0, 0, 255, 255],
        [255, 200, 0, 128],
      ]),
      {
        ...defaultChromaKeyParams,
        keyColor: "#0000ff",
        softness: 0,
        despill: 0,
      },
    );
    expect(result.resultData[3]).toBe(0);
    expect(result.resultData[7]).toBe(128);
  });

  it("keeps only the sampled excluded region opaque and skips despill", () => {
    const result = processChromaKey(
      image([
        [0, 255, 0, 255],
        [20, 220, 20, 255],
        [0, 255, 0, 255],
        [20, 220, 20, 255],
      ]),
      {
        ...defaultChromaKeyParams,
        tolerance: 30,
        softness: 0,
        edgeContract: 0,
        despill: 100,
        outerOnly: false,
        excludedColors: [{ color: "#14dc14", point: { x: 1, y: 0 } }],
        excludeTolerance: 0,
      },
    );
    expect(result.resultData[3]).toBe(0);
    expect(result.resultData[7]).toBe(255);
    expect([...result.resultData.slice(4, 7)]).toEqual([20, 220, 20]);
    expect(result.resultData[15]).toBe(0);
  });

  it("creates a soft alpha transition around the tolerance boundary", () => {
    const result = processChromaKey(
      image([[30, 220, 30, 255]]),
      {
        ...defaultChromaKeyParams,
        tolerance: 12,
        softness: 40,
        despill: 0,
        outerOnly: false,
      },
    );
    expect(result.resultData[3]).toBeGreaterThan(0);
    expect(result.resultData[3]).toBeLessThan(255);
  });

  it("contracts only the outer edge without widening the key color range", () => {
    const green = [0, 255, 0, 255];
    const red = [220, 30, 30, 255];
    const source = imageGrid([
      [green, green, green, green, green, green, green],
      [green, red, red, red, red, red, green],
      [green, red, red, red, red, red, green],
      [green, red, red, red, red, red, green],
      [green, red, red, red, red, red, green],
      [green, red, red, red, red, red, green],
      [green, green, green, green, green, green, green],
    ]);
    const base = processChromaKey(source, {
      ...defaultChromaKeyParams,
      tolerance: 0,
      softness: 0,
      edgeContract: 0,
      despill: 0,
      outerOnly: true,
    });
    const contracted = processChromaKey(source, {
      ...defaultChromaKeyParams,
      tolerance: 0,
      softness: 0,
      edgeContract: 2,
      despill: 0,
      outerOnly: true,
    });
    const edgeAlpha = (3 * source.width + 1) * 4 + 3;
    const centerAlpha = (3 * source.width + 3) * 4 + 3;
    expect(contracted.resultData[edgeAlpha]).toBeLessThan(base.resultData[edgeAlpha]);
    expect(contracted.resultData[centerAlpha]).toBe(255);
    const nearGray = processChromaKey(
      image([[200, 200, 200, 255]]),
      {
        ...defaultChromaKeyParams,
        keyColor: "#cacac8",
        tolerance: 0,
        edgeContract: 12,
        softness: 0,
        outerOnly: false,
        despill: 0,
      },
    );
    expect(nearGray.resultData[3]).toBe(255);
    const expandedBackground = processChromaKey(
      image([[200, 200, 200, 255]]),
      {
        ...defaultChromaKeyParams,
        keyColor: "#cacac8",
        tolerance: 0,
        backgroundExpand: 12,
        edgeContract: 0,
        softness: 0,
        outerOnly: false,
        despill: 0,
      },
    );
    expect(expandedBackground.resultData[3]).toBe(0);
  });

  it("removes near-white antialiasing when tolerance includes it", () => {
    const result = processChromaKey(
      image([[200, 200, 200, 255]]),
      {
        ...defaultChromaKeyParams,
        keyColor: "#ffffff",
        tolerance: 32,
        softness: 0,
        outerOnly: false,
        despill: 0,
      },
    );
    expect(result.resultData[3]).toBe(0);
  });

  it("inverts the generated mask", () => {
    const result = processChromaKey(
      image([
        [0, 255, 0, 255],
        [255, 0, 0, 255],
      ]),
      { ...defaultChromaKeyParams, softness: 0, invert: true, despill: 0 },
    );
    expect(result.resultData[3]).toBe(255);
    expect(result.resultData[7]).toBe(0);
  });

  it("reduces key-color spill on soft edge pixels", () => {
    const source = image([[20, 230, 20, 255]]);
    const plain = processChromaKey(source, {
      ...defaultChromaKeyParams,
      tolerance: 20,
      softness: 70,
      despill: 0,
      outerOnly: false,
    });
    const despilled = processChromaKey(source, {
      ...defaultChromaKeyParams,
      tolerance: 20,
      softness: 70,
      despill: 100,
      outerOnly: false,
    });
    expect(despilled.resultData[1]).toBeLessThan(plain.resultData[1]);
  });

  it("limits removal to key pixels connected to the canvas edge", () => {
    const green = [0, 255, 0, 255];
    const red = [220, 30, 30, 255];
    const source = imageGrid([
      [green, green, green, green, green],
      [green, red, red, red, green],
      [green, red, green, red, green],
      [green, red, red, red, green],
      [green, green, green, green, green],
    ]);
    const result = processChromaKey(source, {
      ...defaultChromaKeyParams,
      softness: 0,
      despill: 0,
      outerOnly: true,
      outerMode: "canvasEdge",
    });
    const centerAlpha = result.resultData[(2 * source.width + 2) * 4 + 3];
    const edgeAlpha = result.resultData[3];
    expect(edgeAlpha).toBe(0);
    expect(centerAlpha).toBe(255);
  });

  it("treats diagonally connected outer background as removable", () => {
    const green = [0, 255, 0, 255];
    const red = [220, 30, 30, 255];
    const source = imageGrid([
      [green, red, red],
      [red, green, red],
      [red, red, red],
    ]);
    const result = processChromaKey(source, {
      ...defaultChromaKeyParams,
      softness: 0,
      edgeContract: 0,
      despill: 0,
      outerOnly: true,
      outerMode: "canvasEdge",
    });
    const diagonalAlpha = result.resultData[(source.width + 1) * 4 + 3];
    expect(diagonalAlpha).toBe(0);
  });

  it("does not let a broad soft edge connect into the subject interior", () => {
    const green = [0, 255, 0, 255];
    const softGreen = [20, 230, 20, 255];
    const red = [220, 30, 30, 255];
    const source = imageGrid([
      [red, red, red, red, red],
      [green, softGreen, softGreen, softGreen, red],
      [red, red, red, red, red],
    ]);
    const result = processChromaKey(source, {
      ...defaultChromaKeyParams,
      tolerance: 20,
      softness: 70,
      edgeContract: 0,
      despill: 0,
      outerOnly: true,
      outerMode: "canvasEdge",
    });
    const firstSoftEdgeAlpha = result.resultData[(source.width + 1) * 4 + 3];
    const innerSoftAlpha = result.resultData[(source.width + 2) * 4 + 3];
    expect(firstSoftEdgeAlpha).toBeLessThan(255);
    expect(innerSoftAlpha).toBe(255);
  });

  it("limits removal to key pixels connected to the sampled point", () => {
    const result = processChromaKey(
      image([
        [0, 255, 0, 255],
        [0, 255, 0, 255],
        [220, 30, 30, 255],
        [0, 255, 0, 255],
        [0, 255, 0, 255],
      ]),
      {
        ...defaultChromaKeyParams,
        softness: 0,
        despill: 0,
        outerOnly: true,
        outerMode: "samplePoint",
        samplePoint: { x: 0, y: 0 },
      },
    );
    expect(result.resultData[3]).toBe(0);
    expect(result.resultData[7]).toBe(0);
    expect(result.resultData[15]).toBe(255);
    expect(result.resultData[19]).toBe(255);
  });

  it("does not despill isolated matching colors outside the outer region", () => {
    const source = imageGrid([
      [[220, 30, 30, 255], [220, 30, 30, 255], [220, 30, 30, 255]],
      [[220, 30, 30, 255], [20, 230, 20, 255], [220, 30, 30, 255]],
      [[220, 30, 30, 255], [220, 30, 30, 255], [220, 30, 30, 255]],
    ]);
    const result = processChromaKey(source, {
      ...defaultChromaKeyParams,
      tolerance: 20,
      softness: 70,
      despill: 100,
      outerOnly: true,
      outerMode: "canvasEdge",
    });
    const center = (1 * source.width + 1) * 4;
    expect(result.resultData[center + 1]).toBe(230);
    expect(result.resultData[center + 3]).toBe(255);
  });

  it("uses default outer-region params for legacy persisted settings", () => {
    const legacyParams = {
      keyColor: "#00ff00",
      tolerance: 26,
      softness: 0,
      edgeContract: 0,
      despill: 0,
      invert: false,
      livePreview: true,
    } as ChromaKeyParams;
    const result = processChromaKey(image([[0, 255, 0, 255]]), legacyParams);
    expect(result.resultData[3]).toBe(0);
  });
});

describe("sampleHexColor", () => {
  it("samples a clamped image coordinate", () => {
    expect(sampleHexColor(image([[12, 34, 56, 255]]), 8, 0)).toBe("#0c2238");
  });
});

describe("getChromaPreviewDimensions", () => {
  it("keeps typical workspace images at their original resolution", () => {
    expect(getChromaPreviewDimensions(1536, 1024)).toEqual({
      width: 1536,
      height: 1024,
    });
  });

  it("caps very large previews by both edge length and pixel count", () => {
    const preview = getChromaPreviewDimensions(3840, 2160);
    expect(Math.max(preview.width, preview.height)).toBeLessThanOrEqual(2048);
    expect(preview.width * preview.height).toBeLessThanOrEqual(2_010_000);
  });
});

describe("canvasToImagePoint", () => {
  it("accounts for canvas pan and zoom when using the eyedropper", () => {
    expect(canvasToImagePoint(170, 120, { x: 20, y: 40 }, 2)).toEqual({
      x: 75,
      y: 40,
    });
  });
});
