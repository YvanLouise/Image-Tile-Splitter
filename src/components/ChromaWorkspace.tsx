import {
  Download,
  Eye,
  Hand,
  ImageUp,
  Pipette,
  RefreshCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UIStrings } from "../i18n";
import {
  canvasToImagePoint,
  defaultChromaKeyParams,
  renderChromaKeyResult,
  sampleHexColor,
} from "../lib/chromaKey";
import type {
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

type CanvasTool = "eyedropper" | "pan";

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
  const uploadDragDepthRef = useRef(0);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const effectiveParams = params.livePreview ? params : appliedParams;

  useEffect(() => {
    if (!source) {
      setResult(null);
      return;
    }
    setProcessing(true);
    const timer = window.setTimeout(() => {
      setResult(renderChromaKeyResult(source.imageData, effectiveParams));
      setProcessing(false);
    }, params.livePreview ? 70 : 0);
    return () => window.clearTimeout(timer);
  }, [effectiveParams, params.livePreview, source]);

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

  function exportResult() {
    if (!source || !result) return;
    const base = source.fileName.replace(/\.[^.]+$/, "") || "image";
    downloadUrl(result.resultUrl, `${base}-transparent.png`);
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
            label={t.chroma.edgeContract}
            value={params.edgeContract}
            max={40}
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
        onPickColor={(color) => updateParam("keyColor", color)}
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
              <button className="primary wide chroma-download" onClick={exportResult}>
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
      <span className="numeric-value">{value}{suffix}</span>
    </div>
  );
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
  onPickColor,
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
  onPickColor: (color: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<null | {
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    moved: boolean;
  }>(null);
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
    if (!source || previewMode === "original") {
      previewImageRef.current = null;
      return;
    }
    const url = previewMode === "result" ? result?.resultUrl : result?.maskUrl;
    if (!url) return;
    const image = new Image();
    image.onload = () => {
      previewImageRef.current = image;
      draw();
    };
    image.src = url;
  }, [previewMode, result, source]);

  useEffect(draw, [canvasSize, pan, previewMode, result, source, zoom, t]);

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
    const checker = createCheckerPattern(ctx, 14);
    if (checker) {
      ctx.fillStyle = checker;
      ctx.fillRect(0, 0, source.width, source.height);
    }
    if (previewMode === "original") {
      ctx.drawImage(source.bitmap, 0, 0);
    } else if (previewImageRef.current) {
      ctx.drawImage(previewImageRef.current, 0, 0);
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
        </div>
      </div>
      <div ref={shellRef} className="canvas-shell">
        <canvas
          ref={canvasRef}
          className={tool === "eyedropper" ? "eyedropper-cursor" : "pan-cursor"}
          onWheel={(event) => {
            event.preventDefault();
            onZoomChange(Math.max(0.05, Math.min(4, zoom * (event.deltaY > 0 ? 0.9 : 1.1))));
          }}
          onPointerDown={(event) => {
            if (!source) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              panX: pan.x,
              panY: pan.y,
              moved: false,
            };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || tool !== "pan") return;
            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            drag.moved = drag.moved || Math.hypot(dx, dy) > 3;
            onPanChange({ x: drag.panX + dx, y: drag.panY + dy });
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;
            dragRef.current = null;
            if (!source || tool !== "eyedropper" || drag?.moved) return;
            const point = imagePoint(event);
            onPickColor(sampleHexColor(source.imageData, point.x, point.y));
          }}
        />
      </div>
      <div className="canvas-status">
        <span>{tool === "eyedropper" ? t.chroma.pickHint : t.chroma.panHint}</span>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
    </main>
  );
}
