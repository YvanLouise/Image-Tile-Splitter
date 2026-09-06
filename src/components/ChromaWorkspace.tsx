import {
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  Hand,
  ImageUp,
  Pipette,
  RefreshCcw,
  ShieldPlus,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UIStrings } from "../i18n";
import { sanitizePngFileName } from "../lib/exportAssets";
import {
  buildChromaKeyPreviewResult,
  canvasToImagePoint,
  chromaPixelsToBlob,
  type ChromaPixelResult,
  type ChromaPreviewInput,
  createChromaKeyPreviewInput,
  defaultChromaKeyParams,
  processChromaKey,
  sampleHexColor,
  scaleChromaParamsForPreview,
} from "../lib/chromaKey";
import type {
  ChromaExcludedColor,
  ChromaKeyParams,
  ChromaKeyResult,
  ChromaPreviewMode,
  LoadedImage,
} from "../types";
import {
  createCheckerPattern,
  downloadUrl,
  formatBytes,
  getPinchTransform,
  type CanvasPoint,
} from "../utils/canvas";
import { getAcceptedImageFile, hasAcceptedImageDrag } from "../utils/uploadDrop";

interface ChromaWorkspaceProps {
  t: UIStrings;
  source: LoadedImage | null;
  params: ChromaKeyParams;
  onParamsChange: (params: ChromaKeyParams) => void;
  onFileChange: (file: File) => void;
  isCanvasVisible: boolean;
}

type CanvasTool = "eyedropper" | "exclude" | "pan";
type ResultBackground = "transparent" | string;
type LoadedPreviewImage = {
  url: string;
  image: HTMLImageElement;
};
type PreviewRaster = {
  result: HTMLCanvasElement;
  mask: HTMLCanvasElement;
};
type ChromaPreviewRequest = {
  preview: ChromaPreviewInput;
  params: ChromaKeyParams;
};

const resultBackgroundSwatches = [
  "#ffffff",
  "#111827",
  "#f3f4f6",
  "#22c55e",
  "#3b82f6",
  "#ef4444",
];

function isExcludedColor(value: unknown): value is ChromaExcludedColor {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ChromaExcludedColor>;
  return typeof item.color === "string"
    && /^#[0-9a-f]{6}$/i.test(item.color)
    && Number.isFinite(item.point?.x)
    && Number.isFinite(item.point?.y);
}

export function ChromaWorkspace({
  t,
  source,
  params,
  onParamsChange,
  onFileChange,
  isCanvasVisible,
}: ChromaWorkspaceProps) {
  const [result, setResult] = useState<ChromaKeyResult | null>(null);
  const [previewMode, setPreviewMode] = useState<ChromaPreviewMode>("result");
  const [tool, setTool] = useState<CanvasTool>("eyedropper");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 32, y: 32 });
  const [previewProcessing, setPreviewProcessing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [appliedParams, setAppliedParams] = useState(params);
  const [colorDraft, setColorDraft] = useState(params.keyColor);
  const [previewInput, setPreviewInput] = useState<ChromaPreviewInput | null>(null);
  const [resultBackground, setResultBackground] =
    useState<ResultBackground>("transparent");
  const [exportFileName, setExportFileName] = useState("");
  const uploadDragDepthRef = useRef(0);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const previewInputRef = useRef(previewInput);
  const queuedPreviewRef = useRef<ChromaPreviewRequest | null>(null);
  const activePreviewTaskRef = useRef<ChromaWorkerTask | null>(null);
  const previewLoopRunningRef = useRef(false);
  const previewMountedRef = useRef(true);
  const effectiveParams = params.livePreview ? params : appliedParams;
  const excludedColors = params.excludedColors.filter(isExcludedColor);
  const processing = previewProcessing || exporting;

  previewInputRef.current = previewInput;
  useEffect(() => {
    if (!source) {
      setResult(null);
      setPreviewInput(null);
      setExportFileName("");
      return;
    }
    setPreviewInput(createChromaKeyPreviewInput(source.imageData));
    const base = source.fileName.replace(/\.[^.]+$/, "") || "image";
    setExportFileName(`${base}-transparent`);
  }, [source]);

  async function runPreviewQueue() {
    if (previewLoopRunningRef.current || !previewMountedRef.current) return;
    previewLoopRunningRef.current = true;

    try {
      while (previewMountedRef.current && queuedPreviewRef.current) {
        const request = queuedPreviewRef.current;
        queuedPreviewRef.current = null;
        const task = startChromaKeyTask(request.preview.imageData, request.params);
        activePreviewTaskRef.current = task;

        let processed: ChromaPixelResult;
        try {
          processed = await task.promise;
        } catch {
          if (
            !previewMountedRef.current
            || previewInputRef.current !== request.preview
          ) {
            continue;
          }
          processed = processChromaKey(request.preview.imageData, request.params);
        } finally {
          if (activePreviewTaskRef.current === task) activePreviewTaskRef.current = null;
        }

        if (
          previewMountedRef.current
          && previewInputRef.current === request.preview
        ) {
          setResult(buildChromaKeyPreviewResult(request.preview, processed));
        }
      }
    } finally {
      previewLoopRunningRef.current = false;
      if (previewMountedRef.current && queuedPreviewRef.current) {
        void runPreviewQueue();
      } else if (previewMountedRef.current) {
        setPreviewProcessing(false);
      }
    }
  }

  useEffect(() => {
    previewMountedRef.current = true;
    return () => {
      previewMountedRef.current = false;
      queuedPreviewRef.current = null;
      activePreviewTaskRef.current?.cancel();
    };
  }, []);

  useEffect(() => {
    if (!previewInput) {
      queuedPreviewRef.current = null;
      activePreviewTaskRef.current?.cancel();
      setResult(null);
      setPreviewProcessing(false);
      return;
    }

    queuedPreviewRef.current = {
      preview: previewInput,
      params: scaleChromaParamsForPreview(previewInput, effectiveParams),
    };
    setPreviewProcessing(true);
    void runPreviewQueue();
  }, [effectiveParams, previewInput]);

  useEffect(() => setColorDraft(params.keyColor), [params.keyColor]);

  function updateParam<K extends keyof ChromaKeyParams>(
    key: K,
    value: ChromaKeyParams[K],
  ) {
    onParamsChange({ ...params, [key]: value });
  }

  function addExcludedColor(color: string, point: { x: number; y: number }) {
    const normalized = color.toLowerCase();
    const hasSampleAtPoint = excludedColors.some(
      (excluded) => Math.hypot(excluded.point.x - point.x, excluded.point.y - point.y) < 2,
    );
    if (hasSampleAtPoint || excludedColors.length >= 8) return;
    updateParam("excludedColors", [...excludedColors, { color: normalized, point }]);
  }

  function removeExcludedColor(index: number) {
    updateParam(
      "excludedColors",
      excludedColors.filter((_, excludedIndex) => excludedIndex !== index),
    );
  }

  async function exportResult() {
    if (!source || !result) return;
    const base = source.fileName.replace(/\.[^.]+$/, "") || "image";
    setExporting(true);
    try {
      await waitForNextPaint();
      const task = startChromaKeyTask(source.imageData, effectiveParams);
      const processed = await task.promise.catch(() =>
        processChromaKey(source.imageData, effectiveParams),
      );
      const blob = await chromaPixelsToBlob(
        source.width,
        source.height,
        processed.resultData,
      );
      const url = URL.createObjectURL(blob);
      downloadUrl(url, sanitizePngFileName(exportFileName, `${base}-transparent.png`));
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setExporting(false);
    }
  }

  function resetUploadDragState() {
    uploadDragDepthRef.current = 0;
    setUploadDragActive(false);
  }

  function handleUploadDragEnter(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!hasAcceptedImageDrag(event.dataTransfer)) return;
    uploadDragDepthRef.current += 1;
    setUploadDragActive(true);
  }

  function handleUploadDragOver(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (hasAcceptedImageDrag(event.dataTransfer)) {
      event.dataTransfer.dropEffect = "copy";
      setUploadDragActive(true);
    } else {
      event.dataTransfer.dropEffect = "none";
    }
  }

  function handleUploadDragLeave(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    uploadDragDepthRef.current = Math.max(0, uploadDragDepthRef.current - 1);
    if (uploadDragDepthRef.current === 0) setUploadDragActive(false);
  }

  function handleUploadDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    resetUploadDragState();
    const file = getAcceptedImageFile(event.dataTransfer.files);
    if (file) onFileChange(file);
  }

  return (
    <div className="workspace chroma-workspace">
      <aside className="side-panel left-panel">
        <section className="panel-section">
          <h2>{t.chroma.uploadTitle}</h2>
          <label
            className={
              uploadDragActive
                ? "upload-box chroma-upload drag-active"
                : "upload-box chroma-upload"
            }
            onDragEnter={handleUploadDragEnter}
            onDragOver={handleUploadDragOver}
            onDragLeave={handleUploadDragLeave}
            onDrop={handleUploadDrop}
          >
            <input
              type="file"
              accept="image/png,image/webp,image/jpeg"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFileChange(file);
                event.currentTarget.value = "";
              }}
            />
            <ImageUp size={34} />
            <strong>{t.left.uploadStrong}</strong>
            <span>{t.left.uploadFormats}</span>
          </label>
          {source && (
            <div className="file-row">
              <img src={source.url} alt="" />
              <div>
                <strong>{source.fileName}</strong>
                <span>{source.width} x {source.height}</span>
              </div>
              <small>{formatBytes(source.size)}</small>
            </div>
          )}
        </section>

        <section className="panel-section chroma-settings">
          <div className="section-title-row">
            <h2>{t.chroma.settingsTitle}</h2>
            <button
              className="icon-button"
              title={t.chroma.reset}
              onClick={() => onParamsChange(defaultChromaKeyParams)}
            >
              <RefreshCcw size={16} />
            </button>
          </div>

          <div className="color-control">
            <label>{t.chroma.keyColor}</label>
            <input
              type="color"
              value={params.keyColor}
              onChange={(event) => updateParam("keyColor", event.target.value)}
            />
            <input
              className="color-value"
              value={colorDraft}
              maxLength={7}
              onChange={(event) => setColorDraft(event.target.value)}
              onBlur={() => {
                if (/^#[0-9a-f]{6}$/i.test(colorDraft)) {
                  updateParam("keyColor", colorDraft.toLowerCase());
                } else {
                  setColorDraft(params.keyColor);
                }
              }}
            />
          </div>

          <div className="excluded-colors-control">
            <div className="excluded-colors-heading">
              <label>{t.chroma.excludeColors}</label>
              <span>{excludedColors.length}/8</span>
            </div>
            {excludedColors.length ? (
              <div className="excluded-color-list">
                {excludedColors.map((excluded, index) => (
                  <button
                    key={`${excluded.color}-${excluded.point.x}-${excluded.point.y}`}
                    className="excluded-color-chip"
                    type="button"
                    title={`${t.chroma.removeExcludedColor}: ${excluded.color}`}
                    onClick={() => removeExcludedColor(index)}
                  >
                    <span style={{ backgroundColor: excluded.color }} />
                    {excluded.color}
                    <X size={13} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="mode-note">{t.chroma.excludeEmpty}</p>
            )}
          </div>
          <ChromaSlider
            label={t.chroma.excludeTolerance}
            value={params.excludeTolerance}
            max={50}
            onChange={(value) => updateParam("excludeTolerance", value)}
          />

          <ChromaSlider
            label={t.chroma.tolerance}
            value={params.tolerance}
            max={100}
            onChange={(value) => updateParam("tolerance", value)}
          />
          <ChromaSlider
            label={t.chroma.softness}
            value={params.softness}
            max={100}
            onChange={(value) => updateParam("softness", value)}
          />
          <ChromaSlider
            label={t.chroma.backgroundExpand}
            value={Math.max(0, Math.min(40, params.backgroundExpand))}
            max={40}
            onChange={(value) => updateParam("backgroundExpand", value)}
          />
          <p className="mode-note background-expand-hint">{t.chroma.backgroundExpandHint}</p>
          <ChromaSlider
            label={t.chroma.edgeContract}
            value={Math.max(0, Math.min(12, params.edgeContract))}
            max={12}
            suffix="px"
            onChange={(value) => updateParam("edgeContract", value)}
          />
          <ChromaSlider
            label={t.chroma.despill}
            value={params.despill}
            max={100}
            suffix="%"
            onChange={(value) => updateParam("despill", value)}
          />

          <label className="checkbox-line compact">
            <input
              type="checkbox"
              checked={params.invert}
              onChange={(event) => updateParam("invert", event.target.checked)}
            />
            {t.chroma.invert}
          </label>
          <label className="checkbox-line compact">
            <input
              type="checkbox"
              checked={params.outerOnly}
              onChange={(event) => updateParam("outerOnly", event.target.checked)}
            />
            {t.chroma.outerOnly}
          </label>
          {params.outerOnly ? (
            <div className="chroma-range-mode">
              <div className="segmented preview-switch">
                <button
                  className={params.outerMode === "canvasEdge" ? "active" : ""}
                  onClick={() => updateParam("outerMode", "canvasEdge")}
                >
                  {t.chroma.outerCanvasEdge}
                </button>
                <button
                  className={params.outerMode === "samplePoint" ? "active" : ""}
                  onClick={() => updateParam("outerMode", "samplePoint")}
                >
                  {t.chroma.outerSamplePoint}
                </button>
              </div>
              {params.outerMode === "samplePoint" && !params.samplePoint ? (
                <p className="mode-note">{t.chroma.outerSampleHint}</p>
              ) : null}
            </div>
          ) : null}
          <label className="checkbox-line compact">
            <input
              type="checkbox"
              checked={params.livePreview}
              onChange={(event) => {
                if (!event.target.checked) {
                  setAppliedParams({ ...params, livePreview: false });
                }
                updateParam("livePreview", event.target.checked);
              }}
            />
            {t.chroma.livePreview}
          </label>
          <div className="mode-note">{t.chroma.note}</div>
          <button
            className="primary wide"
            disabled={!source || processing}
            onClick={() => setAppliedParams(params)}
          >
            <SlidersHorizontal size={16} />
            {processing ? t.chroma.processing : t.chroma.apply}
          </button>
        </section>
      </aside>

      <ChromaCanvas
        t={t}
        source={source}
        result={result}
        previewMode={previewMode}
        tool={tool}
        zoom={zoom}
        pan={pan}
        onPreviewModeChange={setPreviewMode}
        onToolChange={setTool}
        onZoomChange={setZoom}
        onPanChange={setPan}
        resultBackground={resultBackground}
        onResultBackgroundChange={setResultBackground}
        onPickColor={(color, point) => onParamsChange({ ...params, keyColor: color, samplePoint: point })}
        onPickExcludedColor={addExcludedColor}
        isVisible={isCanvasVisible}
      />

      <aside className="side-panel right-panel chroma-right-panel">
        <section className="panel-section preview-section chroma-result-section">
          <h2>{t.chroma.resultTitle}</h2>
          {source && result ? (
            <>
              <div className="selected-summary">
                <strong>{t.chroma.outputReady}</strong>
                <span>{source.width} x {source.height} px</span>
                <span>
                  {t.chroma.foreground(
                    result.foregroundPixels.toLocaleString(),
                    Math.round(result.foregroundPixels / result.totalPixels * 100),
                  )}
                </span>
              </div>
              <div className="preview-frame chroma-preview-frame">
                <img src={result.resultUrl} alt={t.chroma.resultAlt} />
              </div>
              <button
                className="primary wide chroma-download"
                disabled={processing}
                onClick={() => void exportResult()}
              >
                <Download size={16} />
                {t.chroma.exportPng}
              </button>
              <label className="select-label chroma-export-name">
                {t.right.exportFileName}
                <input
                  className="file-name-input"
                  value={exportFileName}
                  placeholder={t.right.fileNamePlaceholder}
                  onChange={(event) => setExportFileName(event.target.value)}
                />
              </label>
            </>
          ) : (
            <div className="empty-state">{t.chroma.emptyResult}</div>
          )}
        </section>

        <section className="panel-section chroma-guide">
          <h2>{t.chroma.guideTitle}</h2>
          <ol>
            {t.chroma.guideSteps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </section>
      </aside>
    </div>
  );
}

function ChromaSlider({
  label,
  value,
  max,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const setValue = (nextValue: number) => onChange(Math.min(max, Math.max(0, nextValue)));

  return (
    <div className="control-row chroma-slider">
      <label>{label}</label>
      <input
        type="range"
        min="0"
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="chroma-number-control">
        <input
          className="numeric-value"
          type="number"
          min="0"
          max={max}
          step="1"
          value={value}
          aria-label={label}
          onChange={(event) => {
            const nextValue = event.currentTarget.valueAsNumber;
            if (Number.isFinite(nextValue)) setValue(nextValue);
          }}
        />
        <div className="chroma-stepper" aria-label={`${label}微调`}>
          <button
            className="chroma-stepper-button"
            type="button"
            title={`${label}增加`}
            aria-label={`${label}增加`}
            onClick={() => setValue(value + 1)}
          >
            <ChevronUp size={12} strokeWidth={2.5} />
          </button>
          <button
            className="chroma-stepper-button"
            type="button"
            title={`${label}减少`}
            aria-label={`${label}减少`}
            onClick={() => setValue(value - 1)}
          >
            <ChevronDown size={12} strokeWidth={2.5} />
          </button>
        </div>
        {suffix ? <span className="chroma-number-suffix">{suffix}</span> : null}
      </div>
    </div>
  );
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

interface ChromaWorkerTask {
  promise: Promise<ChromaPixelResult>;
  cancel: () => void;
}

let chromaWorkerRequestId = 0;

function startChromaKeyTask(
  imageData: ImageData,
  params: ChromaKeyParams,
): ChromaWorkerTask {
  if (!("Worker" in window)) {
    return {
      promise: Promise.resolve(processChromaKey(imageData, params)),
      cancel: () => undefined,
    };
  }

  const id = chromaWorkerRequestId + 1;
  chromaWorkerRequestId = id;
  const worker = new Worker(new URL("../lib/chromaKey.worker.ts", import.meta.url), {
    type: "module",
  });
  const payload = new Uint8ClampedArray(imageData.data);
  let settled = false;
  let rejectTask: (reason?: unknown) => void = () => undefined;
  const stopWorker = () => {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  };
  const promise = new Promise<ChromaPixelResult>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = (event: MessageEvent<{
      id: number;
      resultData?: ArrayBuffer;
      maskData?: ArrayBuffer;
      foregroundPixels?: number;
      totalPixels?: number;
      error?: string;
    }>) => {
      if (settled) return;
      settled = true;
      stopWorker();
      if (event.data.id !== id) {
        reject(new Error("Chroma worker returned a mismatched response."));
        return;
      }
      if (event.data.error || !event.data.resultData || !event.data.maskData) {
        reject(new Error(event.data.error ?? "Chroma worker returned no data."));
        return;
      }
      resolve({
        resultData: new Uint8ClampedArray(event.data.resultData),
        maskData: new Uint8ClampedArray(event.data.maskData),
        foregroundPixels: event.data.foregroundPixels ?? 0,
        totalPixels: event.data.totalPixels ?? imageData.width * imageData.height,
      });
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      stopWorker();
      reject(new Error(event.message));
    };
    worker.postMessage(
      {
        id,
        width: imageData.width,
        height: imageData.height,
        data: payload.buffer,
        params,
      },
      [payload.buffer],
    );
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      stopWorker();
      rejectTask(new Error("Chroma worker task canceled."));
    },
  };
}

function ChromaCanvas({
  t,
  source,
  result,
  previewMode,
  tool,
  zoom,
  pan,
  onPreviewModeChange,
  onToolChange,
  onZoomChange,
  onPanChange,
  resultBackground,
  onResultBackgroundChange,
  onPickColor,
  onPickExcludedColor,
  isVisible,
}: {
  t: UIStrings;
  source: LoadedImage | null;
  result: ChromaKeyResult | null;
  previewMode: ChromaPreviewMode;
  tool: CanvasTool;
  zoom: number;
  pan: { x: number; y: number };
  onPreviewModeChange: (mode: ChromaPreviewMode) => void;
  onToolChange: (tool: CanvasTool) => void;
  onZoomChange: (zoom: number) => void;
  onPanChange: (pan: { x: number; y: number }) => void;
  resultBackground: ResultBackground;
  onResultBackgroundChange: (background: ResultBackground) => void;
  onPickColor: (color: string, point: { x: number; y: number }) => void;
  onPickExcludedColor: (color: string, point: { x: number; y: number }) => void;
  isVisible: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const previewImagesRef = useRef<Partial<Record<"result" | "mask", LoadedPreviewImage>>>({});
  const previewRasterRef = useRef<PreviewRaster | null>(null);
  const dragRef = useRef<null | {
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    moved: boolean;
    panning: boolean;
  }>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const touchPointersRef = useRef(new Map<number, CanvasPoint>());
  const pendingTouchRef = useRef<null | {
    pointerId: number;
    clientX: number;
    clientY: number;
  }>(null);
  const pinchRef = useRef<null | {
    ids: [number, number];
    startPoints: [CanvasPoint, CanvasPoint];
    zoom: number;
    pan: CanvasPoint;
  }>(null);
  const [middlePanning, setMiddlePanning] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 620 });
  const hasMeasuredRef = useRef(false);
  const autoFitSourceRef = useRef<LoadedImage | null>(null);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const measure = () => {
      const rect = shell.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      hasMeasuredRef.current = true;
      setCanvasSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(240, Math.floor(rect.height)),
      });
    };
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
      hasMeasuredRef.current = true;
      setCanvasSize({
        width: Math.max(1, Math.floor(entry.contentRect.width)),
        height: Math.max(240, Math.floor(entry.contentRect.height)),
      });
    });
    observer.observe(shell);
    const frame = isVisible ? window.requestAnimationFrame(measure) : 0;
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [isVisible]);

  useEffect(() => {
    if (!source) {
      autoFitSourceRef.current = null;
      return;
    }
    if (
      !isVisible
      || !hasMeasuredRef.current
      || autoFitSourceRef.current === source
    ) {
      return;
    }

    const inset = window.matchMedia("(max-width: 900px)").matches ? 16 : 64;
    const scale = Math.max(
      0.05,
      Math.min(
        (canvasSize.width - inset * 2) / source.width,
        (canvasSize.height - inset * 2) / source.height,
        1,
      ),
    );
    autoFitSourceRef.current = source;
    onZoomChange(scale);
    onPanChange({
      x: (canvasSize.width - source.width * scale) / 2,
      y: (canvasSize.height - source.height * scale) / 2,
    });
  }, [
    canvasSize.height,
    canvasSize.width,
    isVisible,
    onPanChange,
    onZoomChange,
    source,
  ]);

  useEffect(() => {
    previewImagesRef.current = {};
    previewRasterRef.current = null;
  }, [source]);

  useEffect(() => {
    if (
      !result?.resultData
      || !result.maskData
      || !result.previewWidth
      || !result.previewHeight
    ) {
      previewRasterRef.current = null;
      return;
    }
    const createRaster = (data: Uint8ClampedArray) => {
      const raster = document.createElement("canvas");
      raster.width = result.previewWidth!;
      raster.height = result.previewHeight!;
      const context = raster.getContext("2d");
      if (!context) return null;
      const imageData = context.createImageData(raster.width, raster.height);
      imageData.data.set(data);
      context.putImageData(imageData, 0, 0);
      return raster;
    };
    const resultRaster = createRaster(result.resultData);
    const maskRaster = createRaster(result.maskData);
    previewRasterRef.current = resultRaster && maskRaster
      ? { result: resultRaster, mask: maskRaster }
      : null;
    draw();
  }, [result]);

  useEffect(() => {
    if (!source || !result) {
      return;
    }
    let canceled = false;
    const preload = (mode: "result" | "mask", url: string) => {
      if (previewImagesRef.current[mode]?.url === url) return;
      const image = new Image();
      image.onload = () => {
        if (canceled) return;
        previewImagesRef.current[mode] = { url, image };
        draw();
      };
      image.src = url;
    };
    preload("result", result.resultUrl);
    preload("mask", result.maskUrl);
    return () => {
      canceled = true;
    };
  }, [result, source]);

  useEffect(draw, [
    canvasSize,
    pan,
    previewMode,
    result,
    resultBackground,
    source,
    zoom,
    t,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!source) return;

      const rect = canvas.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const nextZoom = Math.max(
        0.05,
        Math.min(4, zoom * (event.deltaY > 0 ? 0.9 : 1.1)),
      );
      const imageX = (pointerX - pan.x) / zoom;
      const imageY = (pointerY - pan.y) / zoom;

      onZoomChange(nextZoom);
      onPanChange({
        x: pointerX - imageX * nextZoom,
        y: pointerY - imageY * nextZoom,
      });
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [onPanChange, onZoomChange, pan, source, zoom]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const backingWidth = Math.max(1, Math.round(canvasSize.width * ratio));
    const backingHeight = Math.max(1, Math.round(canvasSize.height * ratio));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);
    if (!source) {
      ctx.fillStyle = "#4b5f7a";
      ctx.font = "600 16px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(t.chroma.canvasEmpty, canvasSize.width / 2, canvasSize.height / 2);
      return;
    }
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    if (previewMode === "result" && resultBackground !== "transparent") {
      ctx.fillStyle = resultBackground;
      ctx.fillRect(0, 0, source.width, source.height);
    } else {
      const checker = createCheckerPattern(ctx, 14);
      if (checker) {
        ctx.fillStyle = checker;
        ctx.fillRect(0, 0, source.width, source.height);
      }
    }
    if (previewMode === "original") {
      ctx.drawImage(source.bitmap, 0, 0);
    } else {
      const previewRaster = previewRasterRef.current?.[previewMode];
      if (previewRaster) {
        ctx.drawImage(previewRaster, 0, 0, source.width, source.height);
      } else {
        const previewImage = previewImagesRef.current[previewMode];
        if (previewImage) {
          ctx.drawImage(previewImage.image, 0, 0, source.width, source.height);
        }
      }
    }
    ctx.restore();
  }

  function fitToView() {
    if (!source) return;
    const inset = window.matchMedia("(max-width: 900px)").matches ? 16 : 64;
    const scale = Math.min(
      (canvasSize.width - inset * 2) / source.width,
      (canvasSize.height - inset * 2) / source.height,
      1,
    );
    onZoomChange(Math.max(0.05, scale));
    onPanChange({
      x: (canvasSize.width - source.width * scale) / 2,
      y: (canvasSize.height - source.height * scale) / 2,
    });
  }

  function imagePointAt(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return canvasToImagePoint(
      clientX - rect.left,
      clientY - rect.top,
      pan,
      zoom,
    );
  }

  function localPointerPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startPointerInteraction(
    pointerId: number,
    clientX: number,
    clientY: number,
    button: number,
  ) {
    activePointerIdRef.current = pointerId;
    dragRef.current = {
      startX: clientX,
      startY: clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
      panning: tool === "pan" || button === 1,
    };
    setMiddlePanning(button === 1);
  }

  function pickColorAt(clientX: number, clientY: number) {
    if (!source) return;
    const point = imagePointAt(clientX, clientY);
    const color = sampleHexColor(source.imageData, point.x, point.y);
    const clampedPoint = {
      x: Math.max(0, Math.min(source.width - 1, Math.floor(point.x))),
      y: Math.max(0, Math.min(source.height - 1, Math.floor(point.y))),
    };
    if (tool === "exclude") {
      onPickExcludedColor(color, clampedPoint);
    } else if (tool === "eyedropper") {
      onPickColor(color, clampedPoint);
    }
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!source || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType !== "touch") {
      startPointerInteraction(event.pointerId, event.clientX, event.clientY, event.button);
      return;
    }

    touchPointersRef.current.set(event.pointerId, localPointerPoint(event));
    if (touchPointersRef.current.size === 1) {
      pendingTouchRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      return;
    }

    if (touchPointersRef.current.size === 2 && !dragRef.current) {
      const entries = [...touchPointersRef.current.entries()] as Array<[number, CanvasPoint]>;
      pinchRef.current = {
        ids: [entries[0][0], entries[1][0]],
        startPoints: [entries[0][1], entries[1][1]],
        zoom,
        pan,
      };
      pendingTouchRef.current = null;
      activePointerIdRef.current = null;
    }
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!source) return;
    if (event.pointerType === "touch") {
      touchPointersRef.current.set(event.pointerId, localPointerPoint(event));
      const pinch = pinchRef.current;
      if (pinch) {
        const first = touchPointersRef.current.get(pinch.ids[0]);
        const second = touchPointersRef.current.get(pinch.ids[1]);
        if (first && second) {
          const next = getPinchTransform(
            pinch.startPoints,
            [first, second],
            pinch.zoom,
            pinch.pan,
          );
          onZoomChange(next.zoom);
          onPanChange(next.pan);
        }
        return;
      }

      const pending = pendingTouchRef.current;
      if (pending?.pointerId === event.pointerId) {
        const moved = Math.hypot(
          event.clientX - pending.clientX,
          event.clientY - pending.clientY,
        );
        if (moved <= 4) return;
        pendingTouchRef.current = null;
        startPointerInteraction(
          event.pointerId,
          pending.clientX,
          pending.clientY,
          0,
        );
      }
    }

    if (activePointerIdRef.current !== event.pointerId) return;
    const activeDrag = dragRef.current;
    if (!activeDrag) return;
    const dx = event.clientX - activeDrag.startX;
    const dy = event.clientY - activeDrag.startY;
    activeDrag.moved = activeDrag.moved || Math.hypot(dx, dy) > 3;
    if (activeDrag.panning) {
      onPanChange({ x: activeDrag.panX + dx, y: activeDrag.panY + dy });
    }
  }

  function handleCanvasPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === "touch") {
      const pinch = pinchRef.current;
      touchPointersRef.current.delete(event.pointerId);
      if (pinch?.ids.includes(event.pointerId)) {
        pinchRef.current = null;
        pendingTouchRef.current = null;
        dragRef.current = null;
        activePointerIdRef.current = null;
        setMiddlePanning(false);
        return;
      }

      const pending = pendingTouchRef.current;
      if (pending?.pointerId === event.pointerId) {
        pendingTouchRef.current = null;
        pickColorAt(pending.clientX, pending.clientY);
        return;
      }
    }

    if (activePointerIdRef.current !== event.pointerId) return;
    const activeDrag = dragRef.current;
    dragRef.current = null;
    activePointerIdRef.current = null;
    setMiddlePanning(false);
    if (!activeDrag || activeDrag.panning || activeDrag.moved) return;
    pickColorAt(event.clientX, event.clientY);
  }

  function handleCanvasPointerCancel(event: React.PointerEvent<HTMLCanvasElement>) {
    touchPointersRef.current.delete(event.pointerId);
    if (pinchRef.current?.ids.includes(event.pointerId)) pinchRef.current = null;
    if (pendingTouchRef.current?.pointerId === event.pointerId) pendingTouchRef.current = null;
    if (activePointerIdRef.current === event.pointerId) {
      dragRef.current = null;
      activePointerIdRef.current = null;
      setMiddlePanning(false);
    }
  }

  return (
    <main className="canvas-panel chroma-canvas-panel">
      <div className="canvas-heading chroma-canvas-heading">
        <div className="chroma-canvas-title">
          <h2>{t.chroma.canvasTitle}</h2>
          <span>{source ? `${source.width} x ${source.height}` : t.canvas.waiting}</span>
        </div>
        <div className="chroma-canvas-actions">
          <div className="segmented preview-switch">
            {(["original", "result", "mask"] as ChromaPreviewMode[]).map((mode) => (
              <button
                key={mode}
                className={previewMode === mode ? "active" : ""}
                aria-label={t.chroma.previewModes[mode]}
                title={t.chroma.previewModes[mode]}
                onClick={() => onPreviewModeChange(mode)}
              >
                <span className="desktop-preview-label">
                  {t.chroma.previewModes[mode]}
                </span>
                <span className="mobile-preview-label" aria-hidden="true">
                  {mode === "result"
                    ? t.mobile.tabs.result
                    : t.chroma.previewModes[mode]}
                </span>
              </button>
            ))}
          </div>
          <div className="tool-strip">
            <button
              className={tool === "eyedropper" ? "icon-button active" : "icon-button"}
              title={t.chroma.eyedropper}
              onClick={() => onToolChange("eyedropper")}
            >
              <Pipette size={17} />
            </button>
            <button
              className={tool === "exclude" ? "icon-button active" : "icon-button"}
              title={t.chroma.excludePicker}
              onClick={() => onToolChange("exclude")}
            >
              <ShieldPlus size={17} />
            </button>
            <button
              className={tool === "pan" ? "icon-button active" : "icon-button"}
              title={t.toolbar.tools.pan}
              onClick={() => onToolChange("pan")}
            >
              <Hand size={17} />
            </button>
            <button className="icon-button" title={t.canvas.fitCanvas} onClick={fitToView}>
              <Eye size={17} />
            </button>
          </div>
          {previewMode === "result" ? (
            <div className="chroma-background-control chroma-canvas-background-control">
              <label>{t.chroma.resultBackground}</label>
              <div className="chroma-background-options">
                <button
                  className={
                    resultBackground === "transparent"
                      ? "background-option transparent active"
                      : "background-option transparent"
                  }
                  onClick={() => onResultBackgroundChange("transparent")}
                >
                  {t.chroma.transparentBackground}
                </button>
                {resultBackgroundSwatches.map((color) => (
                  <button
                    key={color}
                    className={
                      resultBackground === color
                        ? "background-swatch active"
                        : "background-swatch"
                    }
                    style={{ background: color }}
                    title={color}
                    onClick={() => onResultBackgroundChange(color)}
                  />
                ))}
                <label className="background-color-picker" title={t.chroma.customBackground}>
                  <input
                    type="color"
                    value={
                      resultBackground === "transparent"
                        ? "#ffffff"
                        : resultBackground
                    }
                    onChange={(event) => onResultBackgroundChange(event.target.value)}
                  />
                </label>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div ref={shellRef} className="canvas-shell">
        <canvas
          ref={canvasRef}
          className={
            (tool === "eyedropper" || tool === "exclude") && !middlePanning
              ? "eyedropper-cursor"
              : "pan-cursor"
          }
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handleCanvasPointerCancel}
        />
      </div>
      <div className="canvas-status">
        <span>
          {tool === "eyedropper"
            ? t.chroma.pickHint
            : tool === "exclude"
              ? t.chroma.excludeHint
              : t.chroma.panHint}
        </span>
        <span className="chroma-canvas-dimensions">
          {source ? `${source.width} × ${source.height}` : ""}
        </span>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
    </main>
  );
}
