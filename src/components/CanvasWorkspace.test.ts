import { describe, expect, it } from "vitest";
import { clampCanvasPan } from "./CanvasWorkspace";

describe("clampCanvasPan", () => {
  const source = { width: 400, height: 200 };
  const canvasSize = { width: 600, height: 400 };

  it("keeps at least half of the image within the viewport", () => {
    expect(clampCanvasPan({ x: -500, y: -500 }, source, 1, canvasSize)).toEqual({
      x: -200,
      y: -100,
    });
    expect(clampCanvasPan({ x: 900, y: 900 }, source, 1, canvasSize)).toEqual({
      x: 400,
      y: 300,
    });
  });

  it("uses scaled image dimensions for the bounds", () => {
    expect(clampCanvasPan({ x: -500, y: 900 }, source, 2, canvasSize)).toEqual({
      x: -400,
      y: 200,
    });
  });
});
