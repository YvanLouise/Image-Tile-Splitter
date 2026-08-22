import { Check, Maximize2, MousePointer2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UIStrings } from "../i18n";
import type { AppMode, BoundingBox, LoadedImage, SliceItem, ToolMode } from "../types";
import { applyBrushEdit, applyLineEdit } from "../lib/imageSegmentation";
import {
  createCheckerPattern,
  getPinchTransform,
  hitTestBox,
  type CanvasPoint,
} from "../utils/canvas";

interface CanvasWorkspaceProps {
  t: UIStrings;
  mode: AppMode;
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
  onRangeExtract: (box: BoundingBox) => void;
  isVisible: boolean;
}

type DragState =
  | null
  | { type: "pan"; start: { x: number; y: number }; pan: { x: number; y: number } }
  | { type: "brush"; edits: Int8Array; last: { x: number; y: number }; value: -1 | 0 | 1 }
  | { type: "line"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: "rect"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: "rangeExtract"; from: { x: number; y: number }; to: { x: number; y: number } };

export function CanvasWorkspace({
  t,
  mode,
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
  onRangeExtract,
  isVisible,
}: CanvasWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 620 });
  const [drag, setDrag] = useState<DragState>(null);
  const [polygon, setPolygon] = useState<Array<{ x: number; y: number }>>([]);
  const dragRef = useRef<DragState>(null);
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

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const editsOverlay = useMemo(
    () => createMaskEditsOverlay(edits, source?.width ?? 0, source?.height ?? 0),
    [edits, source?.height, source?.width],
  );

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const measure = () => {
      const rect = shell.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setCanvasSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(240, Math.floor(rect.height)),
      });
    };
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
      const rect = entry.contentRect;
      setCanvasSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(240, Math.floor(rect.height)),
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
    if (editsOverlay) ctx.drawImage(editsOverlay, 0, 0);
    drawBoxes(ctx, items, selectedSet);
    if (drag?.type === "line") drawLineGuide(ctx, drag.from, drag.to);
    if (drag?.type === "rect") drawRectGuide(ctx, drag.from, drag.to);
    if (drag?.type === "rangeExtract") drawRangeExtractGuide(ctx, drag.from, drag.to);
    if (polygon.length > 0) drawPolygonGuide(ctx, polygon);
    ctx.restore();
  }, [canvasSize, source, items, selectedSet, editsOverlay, drag, polygon, zoom, pan, t]);

  useEffect(() => {
    if (!source) return;
    const clampedPan = clampCanvasPan(pan, source, zoom, canvasSize);
    if (clampedPan.x !== pan.x || clampedPan.y !== pan.y) onPanChange(clampedPan);
  }, [canvasSize, onPanChange, pan, source, zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!source) return;

      const rect = canvas.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const nextZoom = Math.max(0.05, Math.min(4, zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
      const imageX = (pointerX - pan.x) / zoom;
      const imageY = (pointerY - pan.y) / zoom;

      onZoomChange(nextZoom);
      onPanChange(clampCanvasPan({
        x: pointerX - imageX * nextZoom,
        y: pointerY - imageY * nextZoom,
      }, source, nextZoom, canvasSize));
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [canvasSize, onPanChange, onZoomChange, pan, source, zoom]);

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

  function setZoomAndClamp(nextZoom: number) {
    const boundedZoom = Math.max(0.05, Math.min(4, nextZoom));
    onZoomChange(boundedZoom);
    if (source) onPanChange(clampCanvasPan(pan, source, boundedZoom, canvasSize));
  }

  function setActiveDrag(next: DragState) {
    dragRef.current = next;
    setDrag(next);
  }

  function startPointerInteraction(
    pointerId: number,
    clientX: number,
    clientY: number,
    additive = false,
  ) {
    if (!source) return;
    activePointerIdRef.current = pointerId;
    const imagePoint = screenToImage(clientX, clientY);
    const screenPoint = { x: clientX, y: clientY };

    if (tool === "pan") {
      setActiveDrag({ type: "pan", start: screenPoint, pan });
      return;
    }

    if (tool === "select") {
      const hit = [...items]
        .reverse()
        .find((item) => hitTestBox(item.boundingBox, imagePoint.x, imagePoint.y));
      if (hit) onSelect(hit.id, additive);
      activePointerIdRef.current = null;
      return;
    }

    if (tool === "eraser" || tool === "restore") {
      if (!edits) return;
      onMaskEditStart();
      const next = new Int8Array(edits);
      const value = tool === "eraser" ? -1 : 0;
      applyBrushEdit(next, source.width, source.height, imagePoint, tool === "eraser" ? 12 : 10, value);
      onMaskDraft(next);
      setActiveDrag({ type: "brush", edits: next, last: imagePoint, value });
      return;
    }

    if (tool === "splitLine") {
      setActiveDrag({ type: "line", from: imagePoint, to: imagePoint });
      return;
    }

    if (tool === "rect") {
      setActiveDrag({ type: "rect", from: imagePoint, to: imagePoint });
      return;
    }

    if (tool === "rangeExtract" && mode === "transparent") {
      setActiveDrag({ type: "rangeExtract", from: imagePoint, to: imagePoint });
      return;
    }

    if (tool === "polygon") {
      const next = [...polygon, clampPoint(imagePoint, source.width, source.height)];
      setPolygon(next);
      activePointerIdRef.current = null;
    }
  }

  function localPointerPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!source || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    if (event.pointerType !== "touch") {
      startPointerInteraction(
        event.pointerId,
        event.clientX,
        event.clientY,
        event.ctrlKey || event.metaKey,
      );
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

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
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
          onPanChange(clampCanvasPan(next.pan, source, next.zoom, canvasSize));
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
        );
      }
    }

    if (activePointerIdRef.current !== event.pointerId) return;
    const activeDrag = dragRef.current;
    if (!activeDrag) return;
    const imagePoint = screenToImage(event.clientX, event.clientY);
    if (activeDrag.type === "pan") {
      onPanChange(clampCanvasPan({
        x: activeDrag.pan.x + event.clientX - activeDrag.start.x,
        y: activeDrag.pan.y + event.clientY - activeDrag.start.y,
      }, source, zoom, canvasSize));
    } else if (activeDrag.type === "brush") {
      const radius = activeDrag.value === -1 ? 12 : 10;
      applyLineEdit(activeDrag.edits, source.width, source.height, activeDrag.last, imagePoint, radius, activeDrag.value);
      onMaskDraft(new Int8Array(activeDrag.edits));
      setActiveDrag({ ...activeDrag, last: imagePoint });
    } else if (activeDrag.type === "line") {
      setActiveDrag({ ...activeDrag, to: imagePoint });
    } else if (activeDrag.type === "rect" || activeDrag.type === "rangeExtract") {
      setActiveDrag({ ...activeDrag, to: imagePoint });
    }
  }

  function finishPointerInteraction() {
    const activeDrag = dragRef.current;
    activePointerIdRef.current = null;
    if (!source || !activeDrag) return;
    if (activeDrag.type === "brush") {
      onMaskCommit(new Int8Array(activeDrag.edits));
    } else if (activeDrag.type === "line" && edits) {
      onMaskEditStart();
      const next = new Int8Array(edits);
      applyLineEdit(next, source.width, source.height, activeDrag.from, activeDrag.to, 4, -1);
      onMaskCommit(next);
    } else if (activeDrag.type === "rect") {
      const x = Math.min(activeDrag.from.x, activeDrag.to.x);
      const y = Math.min(activeDrag.from.y, activeDrag.to.y);
      const width = Math.abs(activeDrag.to.x - activeDrag.from.x);
      const height = Math.abs(activeDrag.to.y - activeDrag.from.y);
      if (width > 4 && height > 4) onRectPanel({ x, y, width, height });
    } else if (activeDrag.type === "rangeExtract") {
      const x = Math.min(activeDrag.from.x, activeDrag.to.x);
      const y = Math.min(activeDrag.from.y, activeDrag.to.y);
      const width = Math.abs(activeDrag.to.x - activeDrag.from.x);
      const height = Math.abs(activeDrag.to.y - activeDrag.from.y);
      if (width > 4 && height > 4) onRangeExtract({ x, y, width, height });
    }
    setActiveDrag(null);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === "touch") {
      const pinch = pinchRef.current;
      touchPointersRef.current.delete(event.pointerId);
      if (pinch?.ids.includes(event.pointerId)) {
        pinchRef.current = null;
        pendingTouchRef.current = null;
        setActiveDrag(null);
        activePointerIdRef.current = null;
        return;
      }

      const pending = pendingTouchRef.current;
      if (pending?.pointerId === event.pointerId) {
        pendingTouchRef.current = null;
        startPointerInteraction(event.pointerId, pending.clientX, pending.clientY);
        finishPointerInteraction();
        return;
      }
    }

    if (activePointerIdRef.current === event.pointerId) finishPointerInteraction();
  }

  function handleDoubleClick() {
    if (tool === "polygon" && polygon.length >= 3) {
      onPolygonPanel(polygon);
      setPolygon([]);
    }
  }

  function cancelPointerInteraction(event: React.PointerEvent<HTMLCanvasElement>) {
    touchPointersRef.current.delete(event.pointerId);
    if (pinchRef.current?.ids.includes(event.pointerId)) pinchRef.current = null;
    if (pendingTouchRef.current?.pointerId === event.pointerId) pendingTouchRef.current = null;
    if (activePointerIdRef.current === event.pointerId) {
      activePointerIdRef.current = null;
      setActiveDrag(null);
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
    onPanChange(clampCanvasPan({
      x: (canvasSize.width - source.width * scale) / 2,
      y: (canvasSize.height - source.height * scale) / 2,
    }, source, scale, canvasSize));
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
          <button className="icon-button" title={t.canvas.zoomOut} onClick={() => setZoomAndClamp(zoom - 0.1)}>
            <ZoomOut size={16} />
          </button>
          <input
            type="range"
            min="0.05"
            max="4"
            step="0.05"
            value={zoom}
            onChange={(event) => setZoomAndClamp(Number(event.target.value))}
          />
          <strong>{Math.round(zoom * 100)}%</strong>
          <button className="icon-button" title={t.canvas.zoomIn} onClick={() => setZoomAndClamp(zoom + 0.1)}>
            <ZoomIn size={16} />
          </button>
          <button className="icon-button" title={t.canvas.fitCanvas} onClick={fitToView}>
            <Maximize2 size={16} />
          </button>
        </div>
        {tool === "polygon" && polygon.length > 0 ? (
          <div className="mobile-polygon-actions">
            <button className="secondary" type="button" onClick={() => setPolygon([])}>
              <X size={16} />
              {t.mobile.cancelPolygon}
            </button>
            <button
              className="primary"
              type="button"
              disabled={polygon.length < 3}
              onClick={handleDoubleClick}
            >
              <Check size={16} />
              {t.mobile.finishPolygon}
            </button>
          </div>
        ) : null}
      </div>
      <div ref={shellRef} className="canvas-shell">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancelPointerInteraction}
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

export function clampCanvasPan(
  pan: { x: number; y: number },
  source: Pick<LoadedImage, "width" | "height">,
  zoom: number,
  canvasSize: { width: number; height: number },
) {
  const imageWidth = source.width * zoom;
  const imageHeight = source.height * zoom;
  return {
    x: Math.max(-imageWidth / 2, Math.min(canvasSize.width - imageWidth / 2, pan.x)),
    y: Math.max(-imageHeight / 2, Math.min(canvasSize.height - imageHeight / 2, pan.y)),
  };
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

function createMaskEditsOverlay(
  edits: Int8Array | null,
  width: number,
  height: number,
) {
  if (!edits || width <= 0 || height <= 0) return null;
  let hasPixels = false;
  for (let index = 0; index < edits.length; index += 1) {
    if (edits[index] !== 0) {
      hasPixels = true;
      break;
    }
  }
  if (!hasPixels) return null;

  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.width = width;
  overlayCanvas.height = height;
  const context = overlayCanvas.getContext("2d");
  if (!context) return null;
  const overlay = context.createImageData(width, height);
  for (let index = 0; index < edits.length; index += 1) {
    if (edits[index] === 0) continue;
    const offset = index * 4;
    if (edits[index] === -1) {
      overlay.data[offset] = 239;
      overlay.data[offset + 1] = 68;
      overlay.data[offset + 2] = 68;
      overlay.data[offset + 3] = 120;
    } else {
      overlay.data[offset] = 34;
      overlay.data[offset + 1] = 197;
      overlay.data[offset + 2] = 94;
      overlay.data[offset + 3] = 95;
    }
  }
  context.putImageData(overlay, 0, 0);
  return overlayCanvas;
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

function drawRangeExtractGuide(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  ctx.save();
  ctx.strokeStyle = "#f97316";
  ctx.fillStyle = "rgba(249, 115, 22, 0.12)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
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
