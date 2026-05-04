import { useMemo, useRef, useState } from "react";
import { CanvasWorkspace } from "./components/CanvasWorkspace";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { Toolbar } from "./components/Toolbar";
import {
  createAlphaMask,
  createComicContentMask,
  detectComicPanels,
  makePolygonPanel,
  makeRectPanel,
  mergeItems,
  segmentMaskImage,
  segmentTransparentImage,
} from "./lib/imageSegmentation";
import { exportMetadata, exportSingle, exportZip } from "./lib/exportAssets";
import type { AppMode, HistoryState, LoadedImage, SegmentParams, SliceItem, ToolMode } from "./types";
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
  const [source, setSource] = useState<LoadedImage | null>(null);
  const [params, setParams] = useState<SegmentParams>(defaultParams);
  const [originalMask, setOriginalMask] = useState<Uint8Array | null>(null);
  const [edits, setEdits] = useState<Int8Array | null>(null);
  const [items, setItems] = useState<SliceItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 32, y: 32 });
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [exportScope, setExportScope] = useState<"selected" | "all">("selected");
  const [status, setStatus] = useState("等待上传图片");
  const [undoStack, setUndoStack] = useState<HistoryState[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryState[]>([]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds],
  );

  async function handleFile(file: File) {
    const loaded = await fileToLoadedImage(file);
    const mask =
      mode === "transparent"
        ? createAlphaMask(loaded.imageData, params.alphaThreshold)
        : createComicContentMask(loaded.imageData);
    const nextEdits = new Int8Array(loaded.width * loaded.height);
    const nextItems =
      mode === "transparent"
        ? segmentTransparentImage(loaded.imageData, mask, nextEdits, params)
        : detectComicPanels(loaded.imageData, params);
    setSource(loaded);
    setOriginalMask(mask);
    setEdits(nextEdits);
    setItems(nextItems);
    setSelectedIds(nextItems[0] ? [nextItems[0].id] : []);
    setUndoStack([]);
    setRedoStack([]);
    setStatus(`已识别 ${nextItems.length} 个${mode === "transparent" ? "图块" : "漫画格"}`);
    fitInitialView(loaded);
  }

  function fitInitialView(loaded: LoadedImage) {
    const scale = Math.min(1, 760 / loaded.width, 560 / loaded.height);
    setZoom(Math.max(0.08, scale));
    setPan({ x: 36, y: 36 });
  }

  function pushHistory() {
    if (!edits) return;
    setUndoStack((stack) => [
      ...stack,
      {
        edits: new Int8Array(edits),
        items,
        selectedIds,
      },
    ]);
    setRedoStack([]);
  }

  function restoreHistory(state: HistoryState) {
    setEdits(new Int8Array(state.edits));
    setItems(state.items);
    setSelectedIds(state.selectedIds);
  }

  function handleUndo() {
    const previous = undoStack.at(-1);
    if (!previous || !edits) return;
    setRedoStack((stack) => [...stack, { edits: new Int8Array(edits), items, selectedIds }]);
    setUndoStack((stack) => stack.slice(0, -1));
    restoreHistory(previous);
    setStatus("已撤销上一步操作");
  }

  function handleRedo() {
    const next = redoStack.at(-1);
    if (!next || !edits) return;
    setUndoStack((stack) => [...stack, { edits: new Int8Array(edits), items, selectedIds }]);
    setRedoStack((stack) => stack.slice(0, -1));
    restoreHistory(next);
    setStatus("已重做操作");
  }

  function resegment(nextEdits = edits, nextMode = mode, nextParams = params) {
    if (!source || !originalMask || !nextEdits) return;
    const nextItems =
      nextMode === "transparent"
        ? segmentTransparentImage(source.imageData, originalMask, nextEdits, nextParams)
        : segmentMaskImage(source.imageData, originalMask, nextEdits, nextParams, "panel");
    setItems(nextItems);
    setSelectedIds(nextItems[0] ? [nextItems[0].id] : []);
    setStatus(`已重新分割：${nextItems.length} 个${nextMode === "transparent" ? "图块" : "漫画格"}`);
  }

  function handleParamsChange(nextParams: SegmentParams) {
    setParams(nextParams);
  }

  function handleModeChange(nextMode: AppMode) {
    setMode(nextMode);
    if (!source) return;
    pushHistory();
    const mask =
      nextMode === "transparent"
        ? createAlphaMask(source.imageData, params.alphaThreshold)
        : createComicContentMask(source.imageData);
    const nextEdits = new Int8Array(source.width * source.height);
    const nextItems =
      nextMode === "transparent"
        ? segmentTransparentImage(source.imageData, mask, nextEdits, params)
        : detectComicPanels(source.imageData, params);
    setOriginalMask(mask);
    setEdits(nextEdits);
    setItems(nextItems);
    setSelectedIds(nextItems[0] ? [nextItems[0].id] : []);
    setStatus(`已切换到${nextMode === "transparent" ? "透明图块" : "漫画格"}模式`);
  }

  function handleSelect(id: number, additive = false) {
    setSelectedIds((current) => {
      if (!additive) return [id];
      return current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id];
    });
  }

  function handleSelectAll() {
    setSelectedIds(items.map((item) => item.id));
  }

  function handleMoveOrder(id: number, direction: -1 | 1) {
    const index = items.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    pushHistory();
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next.map((item, order) => ({ ...item, order })));
  }

  function handleMerge() {
    if (!source || selectedItems.length < 2) return;
    pushHistory();
    const merged = mergeItems(source.imageData, selectedItems, nextId(items), Math.min(...selectedItems.map((i) => i.order)));
    if (!merged) return;
    const selectedSet = new Set(selectedIds);
    const next = [...items.filter((item) => !selectedSet.has(item.id)), merged]
      .sort((a, b) => a.order - b.order)
      .map((item, order) => ({ ...item, order }));
    setItems(next);
    setSelectedIds([merged.id]);
    setStatus("已合并所选图块");
  }

  function handleSplitSelected() {
    pushHistory();
    resegment();
  }

  function handleMaskEditStart() {
    pushHistory();
  }

  function handleMaskDraft(nextEdits: Int8Array) {
    setEdits(nextEdits);
  }

  function handleMaskCommit(nextEdits: Int8Array) {
    setEdits(nextEdits);
    resegment(nextEdits);
  }

  function handleRectPanel(box: { x: number; y: number; width: number; height: number }) {
    if (!source) return;
    pushHistory();
    const panel = makeRectPanel(source.imageData, box, nextId(items), items.length);
    setItems((current) => [...current, panel].map((item, order) => ({ ...item, order })));
    setSelectedIds([panel.id]);
    setStatus("已添加手动画框漫画格");
  }

  function handlePolygonPanel(points: Array<{ x: number; y: number }>) {
    if (!source) return;
    pushHistory();
    const panel = makePolygonPanel(source.imageData, points, nextId(items), items.length);
    setItems((current) => [...current, panel].map((item, order) => ({ ...item, order })));
    setSelectedIds([panel.id]);
    setStatus("已添加多边形漫画格");
  }

  function handleExportCurrent() {
    const targets = exportScope === "all" ? items : selectedItems;
    if (targets.length === 1) exportSingle(targets[0]);
    else if (source && targets.length > 1) void exportZip(source, targets, includeMetadata);
  }

  function handleExportZip() {
    if (!source) return;
    const targets = exportScope === "all" ? items : selectedItems;
    void exportZip(source, targets, includeMetadata);
  }

  function handleExportMetadata() {
    if (!source) return;
    exportMetadata(source, items);
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
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onModeChange={handleModeChange}
        onToolChange={setTool}
        onUploadClick={() => fileInputRef.current?.click()}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />
      <div className="workspace">
        <LeftPanel
          mode={mode}
          source={source}
          params={params}
          items={items}
          selectedIds={selectedIds}
          includeMetadata={includeMetadata}
          onParamsChange={handleParamsChange}
          onFileChange={(file) => void handleFile(file)}
          onResegment={() => resegment()}
          onSelect={handleSelect}
          onSelectAll={handleSelectAll}
          onMoveOrder={handleMoveOrder}
          onMerge={handleMerge}
          onSplitSelected={handleSplitSelected}
        />
        <CanvasWorkspace
          source={source}
          items={items}
          selectedIds={selectedIds}
          edits={edits}
          tool={tool}
          zoom={zoom}
          pan={pan}
          onZoomChange={setZoom}
          onPanChange={setPan}
          onSelect={handleSelect}
          onMaskEditStart={handleMaskEditStart}
          onMaskDraft={handleMaskDraft}
          onMaskCommit={handleMaskCommit}
          onRectPanel={handleRectPanel}
          onPolygonPanel={handlePolygonPanel}
        />
        <RightPanel
          source={source}
          selectedItems={selectedItems}
          allItems={items}
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
        <span>{status}</span>
        <span>缩放比例：{Math.round(zoom * 100)}%</span>
        <span>已选中 {selectedIds.length} 个</span>
        <span>纯前端处理，所有操作在本地完成</span>
      </footer>
    </div>
  );
}

function nextId(items: SliceItem[]) {
  return Math.max(0, ...items.map((item) => item.id)) + 1;
}

export default App;
