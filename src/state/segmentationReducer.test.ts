import { describe, expect, it } from "vitest";
import {
  initialSegmentationState,
  SEGMENTATION_HISTORY_LIMIT,
  segmentationReducer,
} from "./segmentationReducer";

describe("segmentationReducer history", () => {
  it("reuses immutable edit buffers instead of copying them", () => {
    const edits = new Int8Array([0, 1, -1]);
    const state = { ...initialSegmentationState, edits };

    const next = segmentationReducer(state, {
      type: "apply",
      history: true,
      patch: { status: "changed" },
    });

    expect(next.undoStack[0].edits).toBe(edits);
  });

  it("caps large undo histories", () => {
    let state = { ...initialSegmentationState, edits: new Int8Array(1) };
    for (let index = 0; index < SEGMENTATION_HISTORY_LIMIT + 10; index += 1) {
      state = segmentationReducer(state, {
        type: "apply",
        history: true,
        patch: { status: String(index) },
      });
    }

    expect(state.undoStack).toHaveLength(SEGMENTATION_HISTORY_LIMIT);
    expect(state.undoStack[0].edits).toBe(state.edits);
  });
});
