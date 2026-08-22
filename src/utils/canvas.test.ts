import { describe, expect, it } from "vitest";
import { getPinchTransform } from "./canvas";

describe("getPinchTransform", () => {
  it("keeps the image point under the gesture midpoint", () => {
    const result = getPinchTransform(
      [{ x: 100, y: 100 }, { x: 200, y: 100 }],
      [{ x: 100, y: 150 }, { x: 300, y: 150 }],
      1,
      { x: 50, y: 25 },
    );

    expect(result.zoom).toBe(2);
    expect(result.pan).toEqual({ x: 0, y: 0 });
  });

  it("clamps zoom while retaining midpoint translation", () => {
    const result = getPinchTransform(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      [{ x: 40, y: 50 }, { x: 1040, y: 50 }],
      1,
      { x: 0, y: 0 },
    );

    expect(result.zoom).toBe(4);
    expect(result.pan).toEqual({ x: 340, y: 50 });
  });
});
