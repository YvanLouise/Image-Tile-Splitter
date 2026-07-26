import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CanvasWorkspace } from "./components/CanvasWorkspace";
import { ChromaWorkspace } from "./components/ChromaWorkspace";
import { HelpModal } from "./components/HelpModal";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { Toolbar } from "./components/Toolbar";
import { translations } from "./i18n";
import { defaultComicDetectionParams } from "./lib/comicDetection";
import { defaultChromaKeyParams } from "./lib/chromaKey";
import { exportMetadata, exportSingle, exportZip, itemFileName } from "./lib/exportAssets";
import {
  createComicContentMask,
  makePolygonPanel,
  makeRectPanel,
  mergeItems,
} from "./lib/imageSegmentation";
import { registerVisit, type VisitCounterState } from "./lib/visitCounter";
import {
  loadWorkspaceSnapshot,
  saveWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "./lib/workspacePersistence";
import {
  createInitialSegmentation,
  detectItems,
  resegmentEditedMask,
} from "./lib/segmentationPipeline";
import {
  initialSegmentationState,
  segmentationReducer,
} from "./state/segmentationReducer";
import type { Language, ThemeMode } from "./i18n";
import type {
  AppMode,
  ChromaKeyParams,
  ComicDetectionParams,
  LoadedImage,
  SegmentParams,
  SliceItem,
  ToolMode,
  WorkspaceLayout,
} from "./types";
import { fileToLoadedImage } from "./utils/canvas";
import "./styles.css";

const defaultParams: SegmentParams = {
  alphaThreshold: 8,
  neighborMode: 8,
  minPixels: 20,
};

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestSnapshotRef = useRef<WorkspaceSnapshot | null>(null);
  const [language, setLanguage] = useState<Language>(() =>
    readPreference("language", "zh", ["zh", "en"]),
  );
  const [theme, setTheme] = useState<ThemeMode>(() =>
    readPreference("theme", "light", ["light", "dark"]),
  );
  const [layout, setLayout] = useState<WorkspaceLayout>(() =>
    readPreference("layout", "classic", ["classic", "focus"]),
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [mode, setMode] = useState<AppMode>("transparent");
  const [tool, setTool] = useState<ToolMode>("select");
  const [params, setParams] = useState<SegmentParams>(defaultParams);
  const [comicParams, setComicParams] = useState<ComicDetectionParams>(
    defaultComicDetectionParams,
  );
  const [chromaParams, setChromaParams] = useState<ChromaKeyParams>(
    defaultChromaKeyParams,
  );
  const [chromaSource, setChromaSource] = useState<LoadedImage | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 32, y: 32 });
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [exportScope, setExportScope] = useState<"selected" | "all">("selected");
  const [exportFileName, setExportFileName] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [visitCounter, setVisitCounter] = useState<VisitCounterState>({ status: "loading" });
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [state, dispatch] = useReducer(segmentationReducer, initialSegmentationState);
  const t = translations[language];

  const selectedItems = useMemo(
    () => state.items.filter((item) => state.selectedIds.includes(item.id)),
    [state.items, state.selectedIds],
  );

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    localStorage.setItem("image-splitter-language", language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem("image-splitter-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("image-splitter-layout", layout);
  }, [layout]);

  useEffect(() => {
    let active = true;
    void loadWorkspaceSnapshot()
      .then((restored) => {
        if (!active || !restored) return;
        setMode(restored.mode);
        setTool(restored.tool);
        setParams(restored.params);
        setComicParams(restored.comicParams);
        setChromaParams(restored.chromaParams);
        setChromaSource(restored.chromaSource);
        setZoom(restored.zoom);
        setPan(restored.pan);
        setIncludeMetadata(restored.includeMetadata);
        setExportScope(restored.exportScope);
        dispatch({ type: "restore", state: restored.segmentationState });
      })
      .finally(() => {
        if (active) setWorkspaceReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!workspaceReady) return;
    const snapshot = {
      mode,
      tool,
      params,
      comicParams,
      chromaParams,
      zoom,
      pan,
      includeMetadata,
      exportScope,
      segmentationState: state,
      chromaSource,
    };
    latestSnapshotRef.current = snapshot;
    const timer = window.setTimeout(() => {
      enqueueWorkspaceSave(snapshot);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    chromaParams,
    chromaSource,
    comicParams,
    exportScope,
    includeMetadata,
    mode,
    pan,
    params,
    state,
    tool,
    workspaceReady,
    zoom,
  ]);

  useEffect(() => {
    function flushWorkspace() {
      if (latestSnapshotRef.current) {
        enqueueWorkspaceSave(latestSnapshotRef.current);
      }
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") flushWorkspace();
    }
    window.addEventListener("pagehide", flushWorkspace);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushWorkspace);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void registerVisit().then((result) => {
      if (active) setVisitCounter(result);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (exportScope !== "selected" || selectedItems.length !== 1) {
      setExportFileName("");
      return;
    }
    setExportFileName(itemFileName(selectedItems[0]));
  }, [exportScope, selectedItems]);

  async function handleFile(file: File) {
    const loaded = await fileToLoadedImage(file);
    if (mode === "chroma") {
      setChromaSource(loaded);
      return;
    }
    if (mode === "comic") {
      setDetecting(false);
      dispatch({
        type: "load",
        source: loaded,
        ...createComicReadyState(loaded, t.status.modeChanged(t.common.panel)),
      });
      fitInitialView(loaded.width, loaded.height);
      return;
    }
    setDetecting(false);
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
    if (nextMode === "chroma") return;
    if (!state.source) return;
    if (nextMode === "comic") {
      setDetecting(false);
      dispatch({
        type: "apply",
        history: false,
        patch: createComicReadyState(
          state.source,
          t.status.modeChanged(t.common.panel),
        ),
      });
      return;
    }
    setDetecting(false);
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
            ? `${t.status.modeChanged(nextMode === "transparent" ? t.common.tile : t.common.panel)}；${output.warning}`
            : t.status.modeChanged(nextMode === "transparent" ? t.common.tile : t.common.panel),
        },
      });
    } finally {
      setDetecting(false);
    }
  }

  function handleResegment() {
    if (mode === "chroma" || !state.source || !state.originalMask || !state.edits) return;
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
    if (detecting || !state.source || !state.originalMask || !state.edits) return;
    setDetecting(true);
    try {
      await waitForNextPaint();
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

  function handleRemoveItem(id: number) {
    if (!state.items.some((item) => item.id === id)) return;
    const items = state.items
      .filter((item) => item.id !== id)
      .map((item, order) => ({ ...item, order }));
    dispatch({
      type: "apply",
      history: true,
      patch: {
        items,
        selectedIds: state.selectedIds.filter((selectedId) => selectedId !== id),
        status: t.status.removed,
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
        status: t.status.merged,
      },
    });
  }

  function handleSplitSelected() {
    if (mode === "chroma" || !state.source || !state.originalMask || !state.edits) return;
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
    if (mode === "chroma" || !state.source || !state.originalMask) return;
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
        status: t.status.rectAdded,
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
        status: t.status.polygonAdded,
      },
    });
  }

  function handleExportCurrent() {
    const targets = exportScope === "all" ? state.items : selectedItems;
    if (state.source && targets.length === 1) {
      const customFileName =
        exportScope === "selected" && selectedItems.length === 1 ? exportFileName : undefined;
      exportSingle(state.source, targets[0], customFileName);
    }
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

  function displayStatus() {
    if (mode === "chroma") {
      return chromaSource
        ? t.chroma.statusLoaded(chromaSource.width, chromaSource.height)
        : t.chroma.statusReady;
    }
    if (detecting) return t.status.detecting;
    if (language === "zh") return state.status;
    if (!state.source) return t.status.ready;
    return t.status.loadedSummary(
      state.items.length,
      mode === "transparent" ? t.common.tile : t.common.panel,
    );
  }

  function enqueueWorkspaceSave(snapshot: WorkspaceSnapshot) {
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => saveWorkspaceSnapshot(snapshot))
      .catch(() => undefined);
  }

  return (
    <div className="app-shell" data-theme={theme} data-layout={layout}>
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
        t={t}
        language={language}
        theme={theme}
        layout={layout}
        canUndo={state.undoStack.length > 0}
        canRedo={state.redoStack.length > 0}
        onModeChange={(nextMode) => void handleModeChange(nextMode)}
        onToolChange={setTool}
        onLanguageChange={setLanguage}
        onThemeToggle={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
        onLayoutChange={setLayout}
        onHelpClick={() => setHelpOpen(true)}
        onUploadClick={() => fileInputRef.current?.click()}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
      />
      {mode === "chroma" ? (
        <ChromaWorkspace
          t={t}
          source={chromaSource}
          params={chromaParams}
          onParamsChange={setChromaParams}
          onFileChange={(file) => void handleFile(file)}
        />
      ) : (
        <div className="workspace">
          <LeftPanel
            mode={mode}
            t={t}
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
            onRemove={handleRemoveItem}
            onMerge={handleMerge}
            onSplitSelected={handleSplitSelected}
          />
          <CanvasWorkspace
            t={t}
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
            t={t}
            source={state.source}
            selectedItems={selectedItems}
            allItems={state.items}
            zoom={zoom}
            includeMetadata={includeMetadata}
            exportScope={exportScope}
            exportFileName={exportFileName}
            onZoomChange={setZoom}
            onIncludeMetadataChange={setIncludeMetadata}
            onExportScopeChange={setExportScope}
            onExportFileNameChange={setExportFileName}
            onExportCurrent={handleExportCurrent}
            onExportZip={handleExportZip}
            onExportMetadata={handleExportMetadata}
          />
        </div>
      )}
      <footer className="status-bar">
        <span>{displayStatus()}</span>
        <span>{mode === "chroma" ? t.chroma.localProcessing : t.status.zoom(Math.round(zoom * 100))}</span>
        <span>{mode === "chroma" ? t.chroma.transparentPng : t.status.selected(state.selectedIds.length)}</span>
        <span>{t.status.localOnly}</span>
      </footer>
      {helpOpen && (
        <HelpModal
          t={t}
          visitCounter={visitCounter}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </div>
  );
}

function nextId(items: SliceItem[]) {
  return Math.max(0, ...items.map((item) => item.id)) + 1;
}

function createComicReadyState(source: LoadedImage, status: string) {
  return {
    originalMask: createComicContentMask(source.imageData),
    edits: new Int8Array(source.width * source.height),
    items: [] as SliceItem[],
    selectedIds: [] as number[],
    status,
  };
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function readPreference<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const stored = localStorage.getItem(`image-splitter-${key}`) as T | null;
    return stored && allowed.includes(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export default App;
