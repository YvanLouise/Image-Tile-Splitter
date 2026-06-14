import type { HistoryState, LoadedImage, SliceItem } from "../types";

export interface SegmentationState {
  source: LoadedImage | null;
  originalMask: Uint8Array | null;
  edits: Int8Array | null;
  items: SliceItem[];
  selectedIds: number[];
  status: string;
  undoStack: HistoryState[];
  redoStack: HistoryState[];
}

type CorePatch = Partial<
  Pick<SegmentationState, "originalMask" | "edits" | "items" | "selectedIds" | "status">
>;

export type SegmentationAction =
  | {
      type: "load";
      source: LoadedImage;
      originalMask: Uint8Array;
      edits: Int8Array;
      items: SliceItem[];
      selectedIds: number[];
      status: string;
    }
  | {
      type: "restore";
      state: Omit<SegmentationState, "undoStack" | "redoStack">;
    }
  | { type: "apply"; patch: CorePatch; history?: boolean }
  | { type: "draftEdits"; edits: Int8Array }
  | { type: "select"; id: number; additive?: boolean }
  | { type: "selectAll" }
  | { type: "undo" }
  | { type: "redo" };

export const initialSegmentationState: SegmentationState = {
  source: null,
  originalMask: null,
  edits: null,
  items: [],
  selectedIds: [],
  status: "等待上传图片",
  undoStack: [],
  redoStack: [],
};

export function segmentationReducer(
  state: SegmentationState,
  action: SegmentationAction,
): SegmentationState {
  switch (action.type) {
    case "load":
      return {
        source: action.source,
        originalMask: action.originalMask,
        edits: action.edits,
        items: action.items,
        selectedIds: action.selectedIds,
        status: action.status,
        undoStack: [],
        redoStack: [],
      };
    case "restore":
      return {
        ...action.state,
        undoStack: [],
        redoStack: [],
      };
    case "apply": {
      const undoStack =
        action.history && state.edits
          ? [
              ...state.undoStack,
              {
                edits: new Int8Array(state.edits),
                items: state.items,
                selectedIds: state.selectedIds,
              },
            ]
          : state.undoStack;
      return {
        ...state,
        ...action.patch,
        undoStack,
        redoStack: action.history ? [] : state.redoStack,
      };
    }
    case "draftEdits":
      return { ...state, edits: action.edits };
    case "select":
      return {
        ...state,
        selectedIds: action.additive
          ? state.selectedIds.includes(action.id)
            ? state.selectedIds.filter((id) => id !== action.id)
            : [...state.selectedIds, action.id]
          : [action.id],
      };
    case "selectAll":
      return { ...state, selectedIds: state.items.map((item) => item.id) };
    case "undo": {
      const previous = state.undoStack.at(-1);
      if (!previous || !state.edits) return state;
      return {
        ...state,
        edits: new Int8Array(previous.edits),
        items: previous.items,
        selectedIds: previous.selectedIds,
        status: "已撤销上一步操作",
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [
          ...state.redoStack,
          {
            edits: new Int8Array(state.edits),
            items: state.items,
            selectedIds: state.selectedIds,
          },
        ],
      };
    }
    case "redo": {
      const next = state.redoStack.at(-1);
      if (!next || !state.edits) return state;
      return {
        ...state,
        edits: new Int8Array(next.edits),
        items: next.items,
        selectedIds: next.selectedIds,
        status: "已重做操作",
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [
          ...state.undoStack,
          {
            edits: new Int8Array(state.edits),
            items: state.items,
            selectedIds: state.selectedIds,
          },
        ],
      };
    }
    default:
      return state;
  }
}
