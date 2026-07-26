import { Maximize2, MousePointer2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UIStrings } from "../i18n";
import type { LoadedImage, SliceItem, ToolMode } from "../types";
import { applyBrushEdit, applyLineEdit } from "../lib/imageSegmentation";
import { createCheckerPattern, hitTestBox } from "../utils/canvas";

interface CanvasWorkspaceProps {
  t: UIStrings;
  source: LoadedImage | null;
  items: SliceItem[];
  selectedIds: number[];
  edits: Int8Array | null;
  tool: ToolMode;
  zoom: number;
  pan: { x: number; y: number };
  onZoomChange: (zoom: number) => void;
  onPanChange: (pan: { x: number; y: number }) => void;
  onSelect: (id: number, additive?: boolean) => void;
  onMaskEditStart: () => void;
  onMaskDraft: (edits: Int8Array) => void;
  onMaskCommit: (edits: Int8Array) => void;
  onRectPanel: (box: { x: number; y: number; width: number; height: number }) => void;
  onPolygonPanel: (points: Array<{ x: number; y: number }>) => void;
}

type DragState =
  | null
  | { type: "pan"; start: { x: number; y: number }; pan: { x: number; y: number } }
  | { type: "brush"; edits: Int8Array; last: { x: number; y: number }; value: -1 | 0 | 1 }
  | { type: "line"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: "rect"; from: { x: number; y: number }; to: { x: number; y: number } };

export function CanvasWorkspace({
  t,
  source,
  items,
  selectedIds,
  edits,
  tool,
  zoom,
  pan,
  onZoomChange,
  onPanChange,
  onSelect,
  onMaskEditStart,
  onMaskDraft,
  onMaskCommit,
  onRectPanel,
  onPolygonPanel,
}: CanvasWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 620 });
  const [drag, setDrag] = useState<DragState>(null);
  const [polygon, setPolygon] = useState<Array<{ x: number; y: number }>>([]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setCanvasSize({
        width: Math.max(360, Math.floor(rect.width)),
        height: Math.max(320, Math.floor(rect.height)),
      });
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasSize.width * window.devicePixelRatio;
    canvas.height = canvasSize.height * window.devicePixelRatio;
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    if (!source) {
      drawEmpty(ctx, canvasSize.width, canvasSize.height, t.canvas.empty);
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
    ctx.drawImage(source.bitmap, 0, 0);
    drawMaskEdits(ctx, edits, source.width, source.height);
    drawBoxes(ctx, items, selectedSet);
    if (drag?.type === "line") drawLineGuide(ctx, drag.from, drag.to);
    if (drag?.type === "rect") drawRectGuide(ctx, drag.from, drag.to);
    if (polygon.length > 0) drawPolygonGuide(ctx, polygon);
    ctx.restore();
  }, [canvasSize, source, items, selectedSet, edits, drag, polygon, zoom, pan, t]);

  useEffect(() => {
    if (tool !== "polygon") setPolygon([]);
  }, [tool]);

  function screenToImage(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  }

  function handleWheel(event: {
    preventDefault: () => void;
    currentTarget: HTMLCanvasElement;
    clientX: number;
    clientY: number;
    deltaY: number;
  }) {
    event.preventDefault();
    if (!source) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const nextZoom = Math.max(0.05, Math.min(4, zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
    const imageX = (pointerX - pan.x) / zoom;
    const imageY = (pointerY - pan.y) / zoom;

    onZoomChange(nextZoom);
    onPanChange({
      x: pointerX - imageX * nextZoom,
      y: pointerY - imageY * nextZoom,
    });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!source) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const imagePoint = screenToImage(event.clientX, event.clientY);
    const screenPoint = { x: event.clientX, y: event.clientY };

    if (tool === "pan") {
      setDrag({ type: "pan", start: screenPoint, pan });
      return;
    }

    if (tool === "select") {
      const hit = [...items]
        .reverse()
        .find((item) => hitTestBox(item.boundingBox, imagePoint.x, imagePoint.y));
      if (hit) onSelect(hit.id, event.ctrlKey || event.metaKey);
      return;
    }

    if (tool === "eraser" || tool === "restore") {
      if (!edits) return;
      onMaskEditStart();
      const next = new Int8Array(edits);
      const value = tool === "eraser" ? -1 : 0;
      applyBrushEdit(next, source.width, source.height, imagePoint, tool === "eraser" ? 12 : 10, value);
      onMaskDraft(next);
      setDrag({ type: "brush", edits: next, last: imagePoint, value });
      return;
    }

    if (tool === "splitLine") {
      setDrag({ type: "line", from: imagePoint, to: imagePoint });
      return;
    }

    if (tool === "rect") {
      setDrag({ type: "rect", from: imagePoint, to: imagePoint });
      return;
    }

    if (tool === "polygon") {
      const next = [...polygon, clampPoint(imagePoint, source.width, source.height)];
      setPolygon(next);
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!source || !drag) return;
    const imagePoint = screenToImage(event.clientX, event.clientY);
    if (drag.type === "pan") {
      onPanChange({
        x: drag.pan.x + event.clientX - drag.start.x,
        y: drag.pan.y + event.clientY - drag.start.y,
      });
    } else if (drag.type === "brush") {
      const radius = drag.value === -1 ? 12 : 10;
      applyLineEdit(drag.edits, source.width, source.height, drag.last, imagePoint, radius, drag.value);
      onMaskDraft(new Int8Array(drag.edits));
      setDrag({ ...drag, last: imagePoint });
    } else if (drag.type === "line") {
      setDrag({ ...drag, to: imagePoint });
    } else if (drag.type === "rect") {
      setDrag({ ...drag, to: imagePoint });
    }
  }

  function handlePointerUp() {
    if (!source || !drag) return;
    if (drag.type === "brush") {
      onMaskCommit(new Int8Array(drag.edits));
    } else if (drag.type === "line" && edits) {
      onMaskEditStart();
      const next = new Int8Array(edits);
      applyLineEdit(next, source.width, source.height, drag.from, drag.to, 4, -1);
      onMaskCommit(next);
    } else if (drag.type === "rect") {
      const x = Math.min(drag.from.x, drag.to.x);
      const y = Math.min(drag.from.y, drag.to.y);
      const width = Math.abs(drag.to.x - drag.from.x);
      const height = Math.abs(drag.to.y - drag.from.y);
      if (width > 4 && height > 4) onRectPanel({ x, y, width, height });
    }
    setDrag(null);
  }

  function handleDoubleClick() {
    if (tool === "polygon" && polygon.length >= 3) {
      onPolygonPanel(polygon);
      setPolygon([]);
    }
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

  return (
    <main className="canvas-panel">
      <div className="canvas-heading">
        <div>
          <h2>{t.canvas.title}</h2>
          <span>{source ? `${source.width} × ${source.height}` : t.canvas.waiting}</span>
        </div>
        <div className="canvas-controls">
          <button className="icon-button active" title={t.canvas.currentTool}>
            <MousePointer2 size={16} />
          </button>
          <button className="icon-button" title={t.canvas.zoomOut} onClick={() => onZoomChange(Math.max(0.05, zoom - 0.1))}>
            <ZoomOut size={16} />
          </button>
          <input
            type="range"
            min="0.05"
            max="4"
            step="0.05"
            value={zoom}
            onChange={(event) => onZoomChange(Number(event.target.value))}
          />
          <strong>{Math.round(zoom * 100)}%</strong>
          <button className="icon-button" title={t.canvas.zoomIn} onClick={() => onZoomChange(Math.min(4, zoom + 0.1))}>
            <ZoomIn size={16} />
          </button>
          <button className="icon-button" title={t.canvas.fitCanvas} onClick={fitToView}>
            <Maximize2 size={16} />
          </button>
        </div>
      </div>
      <div ref={shellRef} className="canvas-shell">
        <canvas
          ref={canvasRef}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => setDrag(null)}
          onDoubleClick={handleDoubleClick}
        />
      </div>
      <div className="canvas-status">
        <span>{t.canvas.hint}</span>
        <span>{t.canvas.total(items.length)}</span>
      </div>
    </main>
  );
}

function drawEmpty(ctx: CanvasRenderingContext2D, width: number, height: number, message: string) {
  ctx.strokeStyle = "#c7d7f7";
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 1.4;
  ctx.strokeRect(24, 24, width - 48, height - 48);
  ctx.setLineDash([]);
  ctx.fillStyle = "#4b5f7a";
  ctx.font = "600 16px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
}

function drawBoxes(
  ctx: CanvasRenderingContext2D,
  items: SliceItem[],
  selectedSet: Set<number>,
) {
  ctx.lineWidth = 1.5;
  ctx.font = "700 13px Inter, system-ui, sans-serif";
  for (const item of items) {
    const box = item.boundingBox;
    const selected = selectedSet.has(item.id);
    ctx.strokeStyle = selected ? "#2563eb" : "#22c55e";
    ctx.fillStyle = selected ? "#2563eb" : "#22c55e";
    ctx.setLineDash(selected ? [] : [6, 5]);
    if (item.polygon && item.polygon.length >= 3) {
      ctx.beginPath();
      item.polygon.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
      ctx.stroke();
    } else if (shouldDrawDetailedMaskBoundary(item, selected, items.length)) {
      drawMaskBoundary(ctx, item);
    } else {
      ctx.strokeRect(box.x - 2, box.y - 2, box.width + 4, box.height + 4);
    }
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(box.x - 6, box.y - 18, 20, 20, 5);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(item.order + 1), box.x + 4, box.y - 8);
  }
}

export function shouldDrawDetailedMaskBoundary(
  item: Pick<SliceItem, "boundingBox" | "pixelCount">,
  selected: boolean,
  itemCount: number,
) {
  if (!isIrregularMask(item)) return false;
  const maskArea = item.boundingBox.width * item.boundingBox.height;
  if (selected) return maskArea <= 180_000;
  return itemCount <= 32 && maskArea <= 70_000;
}

function isIrregularMask(item: Pick<SliceItem, "boundingBox" | "pixelCount">) {
  const boxArea = item.boundingBox.width * item.boundingBox.height;
  if (boxArea <= 0) return false;
  return 1 - item.pixelCount / boxArea > 0.03;
}

function drawMaskBoundary(ctx: CanvasRenderingContext2D, item: SliceItem) {
  const box = item.boundingBox;
  ctx.beginPath();
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const idx = y * box.width + x;
      if (!item.mask[idx]) continue;
      const touchesOutside =
        x === 0 ||
        y === 0 ||
        x === box.width - 1 ||
        y === box.height - 1 ||
        !item.mask[idx - 1] ||
        !item.mask[idx + 1] ||
        !item.mask[idx - box.width] ||
        !item.mask[idx + box.width];
      if (touchesOutside) ctx.rect(box.x + x, box.y + y, 1, 1);
    }
  }
  ctx.stroke();
}

function drawMaskEdits(
  ctx: CanvasRenderingContext2D,
  edits: Int8Array | null,
  width: number,
  height: number,
) {
  if (!edits) return;
  const overlay = ctx.createImageData(width, height);
  let hasPixels = false;
  for (let i = 0; i < edits.length; i += 1) {
    if (edits[i] === 0) continue;
    hasPixels = true;
    const idx = i * 4;
    if (edits[i] === -1) {
      overlay.data[idx] = 239;
      overlay.data[idx + 1] = 68;
      overlay.data[idx + 2] = 68;
      overlay.data[idx + 3] = 120;
    } else {
      overlay.data[idx] = 34;
      overlay.data[idx + 1] = 197;
      overlay.data[idx + 2] = 94;
      overlay.data[idx + 3] = 95;
    }
  }
  if (!hasPixels) return;
  const temp = document.createElement("canvas");
  temp.width = width;
  temp.height = height;
  const tctx = temp.getContext("2d");
  if (!tctx) return;
  tctx.putImageData(overlay, 0, 0);
  ctx.drawImage(temp, 0, 0);
}

function drawLineGuide(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function drawRectGuide(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  ctx.strokeStyle = "#2563eb";
  ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
  ctx.lineWidth = 2;
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
}

function drawPolygonGuide(ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) {
  ctx.strokeStyle = "#7c3aed";
  ctx.fillStyle = "rgba(124, 58, 237, 0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  if (points.length > 2) {
    ctx.closePath();
    ctx.fill();
  }
  ctx.stroke();
  for (const point of points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#7c3aed";
    ctx.fill();
  }
}

function clampPoint(point: { x: number; y: number }, width: number, height: number) {
  return {
    x: Math.max(0, Math.min(width - 1, point.x)),
    y: Math.max(0, Math.min(height - 1, point.y)),
  };
}
