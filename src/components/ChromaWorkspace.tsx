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
import { createCheckerPattern, downloadUrl, formatBytes } from "../utils/canvas";
import { getAcceptedImageFile, hasAcceptedImageDrag } from "../utils/uploadDrop";

interface ChromaWorkspaceProps {
  t: UIStrings;
  source: LoadedImage | null;
  params: ChromaKeyParams;
  onParamsChange: (params: ChromaKeyParams) => void;
  onFileChange: (file: File) => void;
}

type CanvasTool = "eyedropper" | "exclude" | "pan";
type ResultBackground = "transparent" | string;
type LoadedPreviewImage = {
  url: string;
  image: HTMLImageElement;
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
}: ChromaWorkspaceProps) {
  const [result, setResult] = useState<ChromaKeyResult | null>(null);
  const [previewMode, setPreviewMode] = useState<ChromaPreviewMode>("result");
  const [tool, setTool] = useState<CanvasTool>("eyedropper");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 32, y: 32 });
  const [processing, setProcessing] = useState(false);
  const [appliedParams, setAppliedParams] = useState(params);
  const [colorDraft, setColorDraft] = useState(params.keyColor);
  const [previewInput, setPreviewInput] = useState<ChromaPreviewInput | null>(null);
  const [resultBackground, setResultBackground] =
    useState<ResultBackground>("transparent");
  const uploadDragDepthRef = useRef(0);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const effectiveParams = params.livePreview ? params : appliedParams;
  const excludedColors = params.excludedColors.filter(isExcludedColor);

  useEffect(() => {
    if (!source) {
      setResult(null);
      setPreviewInput(null);
      return;
    }
    setPreviewInput(createChromaKeyPreviewInput(source.imageData));
  }, [source]);

  useEffect(() => {
    if (!previewInput) {
      setResult(null);
      setProcessing(false);
      return;
    }
    setProcessing(true);
    let canceled = false;
    let task: ChromaWorkerTask | null = null;
    const timer = window.setTimeout(() => {
      task = startChromaKeyTask(
        previewInput.imageData,
        scaleChromaParamsForPreview(previewInput, effectiveParams),
      );
      task.promise
        .then((processed) => {
          if (!canceled) setResult(buildChromaKeyPreviewResult(previewInput, processed));
        })
        .finally(() => {
          if (!canceled) setProcessing(false);
        });
    }, params.livePreview ? 120 : 0);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
      task?.cancel();
    };
  }, [effectiveParams, params.livePreview, previewInput]);

  useEffect(() => {
    if (!source) return;
    const scale = Math.min(1, 760 / source.width, 560 / source.height);
    setZoom(Math.max(0.05, scale));
    setPan({ x: 36, y: 36 });
  }, [source]);

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
    setProcessing(true);
    try {
      await waitForNextPaint();
      const task = startChromaKeyTask(source.imageData, effectiveParams);
      const processed = await task.promise;
      const blob = await chromaPixelsToBlob(
        source.width,
        source.height,
        processed.resultData,
      );
      const url = URL.createObjectURL(blob);
      downloadUrl(url, `${base}-transparent.png`);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setProcessing(false);
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
  const promise = new Promise<ChromaPixelResult>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{
      id: number;
      resultData?: ArrayBuffer;
      maskData?: ArrayBuffer;
      foregroundPixels?: number;
      totalPixels?: number;
      error?: string;
    }>) => {
      worker.terminate();
      if (event.data.id !== id) return;
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
      worker.terminate();
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
    cancel: () => worker.terminate(),
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
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const previewImagesRef = useRef<Partial<Record<"result" | "mask", LoadedPreviewImage>>>({});
  const dragRef = useRef<null | {
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    moved: boolean;
    panning: boolean;
  }>(null);
  const [middlePanning, setMiddlePanning] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 620 });

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(([entry]) => {
      setCanvasSize({
        width: Math.max(360, Math.floor(entry.contentRect.width)),
        height: Math.max(320, Math.floor(entry.contentRect.height)),
      });
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    previewImagesRef.current = {};
  }, [source]);

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
    const ratio = window.devicePixelRatio;
    canvas.width = canvasSize.width * ratio;
    canvas.height = canvasSize.height * ratio;
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
      const previewImage = previewImagesRef.current[previewMode];
      if (previewImage) {
        ctx.drawImage(previewImage.image, 0, 0, source.width, source.height);
      }
    }
    ctx.restore();
  }

  function fitToView() {
    if (!source) return;
    const scale = Math.min(
      (canvasSize.width - 64) / source.width,
      (canvasSize.height - 64) / source.height,
      1,
    );
    onZoomChange(Math.max(0.05, scale));
    onPanChange({
      x: (canvasSize.width - source.width * scale) / 2,
      y: (canvasSize.height - source.height * scale) / 2,
    });
  }

  function imagePoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return canvasToImagePoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
      pan,
      zoom,
    );
  }

  return (
    <main className="canvas-panel chroma-canvas-panel">
      <div className="canvas-heading chroma-canvas-heading">
        <div>
          <h2>{t.chroma.canvasTitle}</h2>
          <span>{source ? `${source.width} x ${source.height}` : t.canvas.waiting}</span>
        </div>
        <div className="chroma-canvas-actions">
          <div className="segmented preview-switch">
            {(["original", "result", "mask"] as ChromaPreviewMode[]).map((mode) => (
              <button
                key={mode}
                className={previewMode === mode ? "active" : ""}
                onClick={() => onPreviewModeChange(mode)}
              >
                {t.chroma.previewModes[mode]}
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
          onPointerDown={(event) => {
            if (!source || (event.button !== 0 && event.button !== 1)) return;
            event.preventDefault();
            const panning = tool === "pan" || event.button === 1;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              panX: pan.x,
              panY: pan.y,
              moved: false,
              panning,
            };
            setMiddlePanning(event.button === 1);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) return;
            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            drag.moved = drag.moved || Math.hypot(dx, dy) > 3;
            if (!drag.panning) return;
            onPanChange({ x: drag.panX + dx, y: drag.panY + dy });
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;
            dragRef.current = null;
            setMiddlePanning(false);
            if (!source || !drag || drag.panning || drag.moved) return;
            const point = imagePoint(event);
            const color = sampleHexColor(source.imageData, point.x, point.y);
            if (tool === "exclude") {
              onPickExcludedColor(color, {
                x: Math.max(0, Math.min(source.width - 1, Math.floor(point.x))),
                y: Math.max(0, Math.min(source.height - 1, Math.floor(point.y))),
              });
              return;
            }
            if (tool !== "eyedropper") return;
            onPickColor(color, {
              x: Math.max(0, Math.min(source.width - 1, Math.floor(point.x))),
              y: Math.max(0, Math.min(source.height - 1, Math.floor(point.y))),
            });
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            setMiddlePanning(false);
          }}
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
        <span>{Math.round(zoom * 100)}%</span>
      </div>
    </main>
  );
}
