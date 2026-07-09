import { describe, expect, it } from "vitest";
import { shouldDrawDetailedMaskBoundary } from "./CanvasWorkspace";

describe("shouldDrawDetailedMaskBoundary", () => {
  it("uses lightweight outlines when many irregular items are visible", () => {
    expect(
      shouldDrawDetailedMaskBoundary(
        {
          boundingBox: { x: 0, y: 0, width: 180, height: 160 },
          pixelCount: 18_000,
        },
        false,
        70,
      ),
    ).toBe(false);
  });

  it("keeps detailed outlines for selected small irregular items", () => {
    expect(
      shouldDrawDetailedMaskBoundary(
        {
          boundingBox: { x: 0, y: 0, width: 180, height: 160 },
          pixelCount: 18_000,
        },
        true,
        70,
      ),
    ).toBe(true);
  });
});
