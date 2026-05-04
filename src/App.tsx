import { useMemo, useReducer, useRef, useState } from "react";
import { CanvasWorkspace } from "./components/CanvasWorkspace";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { Toolbar } from "./components/Toolbar";
import { defaultComicDetectionParams } from "./lib/comicDetection";
import { exportMetadata, exportSingle, exportZip } from "./lib/exportAssets";
import { makePolygonPanel, makeRectPanel, mergeItems } from "./lib/imageSegmentation";
import {
  createInitialSegmentation,
  detectItems,
  resegmentEditedMask,
} from "./lib/segmentationPipeline";
import {
  initialSegmentationState,
  segmentationReducer,
} from "./state/segmentationReducer";
import type { AppMode, ComicDetectionParams, SegmentParams, SliceItem, ToolMode } from "./types";
import { fileToLoadedImage } from "./utils/canvas";
import "./styles.css";

const defaultParams: SegmentParams = {
  alphaThreshold: 8,
  neighborMode: 8,
  minPixels: 20,
};

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<AppMode>("transparent");
  const [tool, setTool] = useState<ToolMode>("select");
  const [params, setParams] = useState<SegmentParams>(defaultParams);
  const [comicParams, setComicParams] = useState<ComicDetectionParams>(
    defaultComicDetectionParams,
  );
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 32, y: 32 });
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [exportScope, setExportScope] = useState<"selected" | "all">("selected");
  const [detecting, setDetecting] = useState(false);
  const [state, dispatch] = useReducer(segmentationReducer, initialSegmentationState);

  const selectedItems = useMemo(
    () => state.items.filter((item) => state.selectedIds.includes(item.id)),
    [state.items, state.selectedIds],
  );

  async function handleFile(file: File) {
    const loaded = await fileToLoadedImage(file);
    setDetecting(mode === "comic");
    try {
      const output = await createInitialSegmentation(loaded, mode, params, comicParams);
      dispatch({
        type: "load",
        source: loaded,
        originalMask: output.originalMask,
        edits: output.edits,
        items: output.items,
        selectedIds: output.selectedIds,
        status: output.warning ? `${output.status}；${output.warning}` : output.status,
      });
      fitInitialView(loaded.width, loaded.height);
    } finally {
      setDetecting(false);
    }
  }

  function fitInitialView(width: number, height: number) {
    const scale = Math.min(1, 760 / width, 560 / height);
    setZoom(Math.max(0.08, scale));
    setPan({ x: 36, y: 36 });
  }

  async function handleModeChange(nextMode: AppMode) {
    setMode(nextMode);
    if (!state.source) return;
    setDetecting(nextMode === "comic");
    try {
      const output = await createInitialSegmentation(state.source, nextMode, params, comicParams);
      dispatch({
        type: "apply",
        history: true,
        patch: {
          originalMask: output.originalMask,
          edits: output.edits,
          items: output.items,
          selectedIds: output.selectedIds,
          status: output.warning
            ? `已切换到${nextMode === "transparent" ? "透明图块" : "漫画格"}模式；${output.warning}`
            : `已切换到${nextMode === "transparent" ? "透明图块" : "漫画格"}模式`,
        },
      });
    } finally {
      setDetecting(false);
    }
  }

  function handleResegment() {
    if (!state.source || !state.originalMask || !state.edits) return;
    const result = resegmentEditedMask(
      state.source,
      mode,
      state.originalMask,
      state.edits,
      params,
    );
    dispatch({
      type: "apply",
      patch: {
        items: result.items,
        selectedIds: result.selectedIds,
        status: result.status,
      },
    });
  }

  async function handleAutoDetectComic() {
    if (!state.source || !state.originalMask || !state.edits) return;
    setDetecting(true);
    try {
      const result = await detectItems(
        state.source,
        "comic",
        state.originalMask,
        state.edits,
        params,
        comicParams,
      );
      dispatch({
        type: "apply",
        history: true,
        patch: {
          items: result.items,
          selectedIds: result.items[0] ? [result.items[0].id] : [],
          status: result.warning ? `${result.status}；${result.warning}` : result.status,
        },
      });
    } finally {
      setDetecting(false);
    }
  }

  function handleMoveOrder(id: number, direction: -1 | 1) {
    const index = state.items.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= state.items.length) return;
    const next = [...state.items];
    [next[index], next[target]] = [next[target], next[index]];
    dispatch({
      type: "apply",
      history: true,
      patch: {
        items: next.map((item, order) => ({ ...item, order })),
      },
    });
  }

  function handleMerge() {
    if (!state.source || selectedItems.length < 2) return;
    const merged = mergeItems(
      state.source.imageData,
      selectedItems,
      nextId(state.items),
      Math.min(...selectedItems.map((item) => item.order)),
    );
    if (!merged) return;
    const selectedSet = new Set(state.selectedIds);
    const next = [...state.items.filter((item) => !selectedSet.has(item.id)), merged]
      .sort((a, b) => a.order - b.order)
      .map((item, order) => ({ ...item, order }));
    dispatch({
      type: "apply",
      history: true,
      patch: {
        items: next,
        selectedIds: [merged.id],
        status: "已合并所选图块",
      },
    });
  }

  function handleSplitSelected() {
    if (!state.source || !state.originalMask || !state.edits) return;
    const result = resegmentEditedMask(
      state.source,
      mode,
      state.originalMask,
      state.edits,
      params,
    );
    dispatch({
      type: "apply",
      history: true,
      patch: {
        items: result.items,
        selectedIds: result.selectedIds,
        status: result.status,
      },
    });
  }

  function handleMaskEditStart() {
    dispatch({ type: "apply", history: true, patch: {} });
  }

  function handleMaskDraft(nextEdits: Int8Array) {
    dispatch({ type: "draftEdits", edits: nextEdits });
  }

  function handleMaskCommit(nextEdits: Int8Array) {
    if (!state.source || !state.originalMask) return;
    const result = resegmentEditedMask(state.source, mode, state.originalMask, nextEdits, params);
    dispatch({
      type: "apply",
      patch: {
        edits: nextEdits,
        items: result.items,
        selectedIds: result.selectedIds,
        status: result.status,
      },
    });
  }

  function handleRectPanel(box: { x: number; y: number; width: number; height: number }) {
    if (!state.source) return;
    const panel = makeRectPanel(state.source.imageData, box, nextId(state.items), state.items.length);
    dispatch({
      type: "apply",
      history: true,
      patch: {
        items: [...state.items, panel].map((item, order) => ({ ...item, order })),
        selectedIds: [panel.id],
        status: "已添加手动画框漫画格",
      },
    });
  }

  function handlePolygonPanel(points: Array<{ x: number; y: number }>) {
    if (!state.source) return;
    const panel = makePolygonPanel(
      state.source.imageData,
      points,
      nextId(state.items),
      state.items.length,
    );
    dispatch({
      type: "apply",
      history: true,
      patch: {
        items: [...state.items, panel].map((item, order) => ({ ...item, order })),
        selectedIds: [panel.id],
        status: "已添加多边形漫画格",
      },
    });
  }

  function handleExportCurrent() {
    const targets = exportScope === "all" ? state.items : selectedItems;
    if (targets.length === 1) exportSingle(targets[0]);
    else if (state.source && targets.length > 1) void exportZip(state.source, targets, includeMetadata);
  }

  function handleExportZip() {
    if (!state.source) return;
    const targets = exportScope === "all" ? state.items : selectedItems;
    void exportZip(state.source, targets, includeMetadata);
  }

  function handleExportMetadata() {
    if (!state.source) return;
    exportMetadata(state.source, state.items);
  }

  return (
    <div className="app-shell">
      <input
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        accept="image/png,image/webp,image/jpeg"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.currentTarget.value = "";
        }}
      />
      <Toolbar
        mode={mode}
        tool={tool}
        canUndo={state.undoStack.length > 0}
        canRedo={state.redoStack.length > 0}
        onModeChange={(nextMode) => void handleModeChange(nextMode)}
        onToolChange={setTool}
        onUploadClick={() => fileInputRef.current?.click()}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
      />
      <div className="workspace">
        <LeftPanel
          mode={mode}
          source={state.source}
          params={params}
          comicParams={comicParams}
          items={state.items}
          selectedIds={state.selectedIds}
          detecting={detecting}
          onParamsChange={setParams}
          onComicParamsChange={setComicParams}
          onFileChange={(file) => void handleFile(file)}
          onResegment={handleResegment}
          onAutoDetectComic={() => void handleAutoDetectComic()}
          onSelect={(id, additive) => dispatch({ type: "select", id, additive })}
          onSelectAll={() => dispatch({ type: "selectAll" })}
          onMoveOrder={handleMoveOrder}
          onMerge={handleMerge}
          onSplitSelected={handleSplitSelected}
        />
        <CanvasWorkspace
          source={state.source}
          items={state.items}
          selectedIds={state.selectedIds}
          edits={state.edits}
          tool={tool}
          zoom={zoom}
          pan={pan}
          onZoomChange={setZoom}
          onPanChange={setPan}
          onSelect={(id, additive) => dispatch({ type: "select", id, additive })}
          onMaskEditStart={handleMaskEditStart}
          onMaskDraft={handleMaskDraft}
          onMaskCommit={handleMaskCommit}
          onRectPanel={handleRectPanel}
          onPolygonPanel={handlePolygonPanel}
        />
        <RightPanel
          source={state.source}
          selectedItems={selectedItems}
          allItems={state.items}
          zoom={zoom}
          includeMetadata={includeMetadata}
          exportScope={exportScope}
          onZoomChange={setZoom}
          onIncludeMetadataChange={setIncludeMetadata}
          onExportScopeChange={setExportScope}
          onExportCurrent={handleExportCurrent}
          onExportZip={handleExportZip}
          onExportMetadata={handleExportMetadata}
        />
      </div>
      <footer className="status-bar">
        <span>{detecting ? "正在加载 OpenCV 并检测漫画格..." : state.status}</span>
        <span>缩放比例：{Math.round(zoom * 100)}%</span>
        <span>已选中 {state.selectedIds.length} 个</span>
        <span>纯前端处理，所有操作在本地完成</span>
      </footer>
    </div>
  );
}

function nextId(items: SliceItem[]) {
  return Math.max(0, ...items.map((item) => item.id)) + 1;
}

export default App;
