import { describe, expect, it } from "vitest";
import {
  findItemsIntersectingBox,
  replaceItemsWithMerge,
} from "./imageSegmentation";
import type { SliceItem } from "../types";

function item(id: number, x: number, y: number, width = 10, height = 10): SliceItem {
  return {
    id,
    type: "slice",
    boundingBox: { x, y, width, height },
    pixelCount: width * height,
    mask: new Uint8Array(width * height).fill(1),
    previewUrl: "",
    exportUrl: "",
    order: id - 1,
  };
}

describe("range extraction", () => {
  const items = [item(1, 10, 10), item(2, 25, 10), item(3, 50, 10)];

  it("includes items fully inside the range", () => {
    expect(findItemsIntersectingBox(items, { x: 5, y: 5, width: 35, height: 20 }).map((value) => value.id))
      .toEqual([1, 2]);
  });

  it("includes items that cross the range boundary", () => {
    expect(findItemsIntersectingBox(items, { x: 30, y: 5, width: 25, height: 20 }).map((value) => value.id))
      .toEqual([2, 3]);
  });

  it("returns no items when the range does not overlap", () => {
    expect(findItemsIntersectingBox(items, { x: 80, y: 80, width: 10, height: 10 })).toEqual([]);
  });

  it("replaces matched items with the merged item and keeps list order stable", () => {
    const merged = { ...item(4, 10, 10, 25, 10), order: 0 };
    const next = replaceItemsWithMerge(items, items.slice(0, 2), merged);

    expect(next.map((value) => value.id)).toEqual([4, 3]);
    expect(next.map((value) => value.order)).toEqual([0, 1]);
  });
});
