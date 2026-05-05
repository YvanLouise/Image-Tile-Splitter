import {
  ArrowDownAZ,
  Combine,
  Filter,
  ImageUp,
  ListChecks,
  RotateCcw,
  Scissors,
  ScanSearch,
} from "lucide-react";
import type { UIStrings } from "../i18n";
import type {
  AppMode,
  ComicDetectionParams,
  LoadedImage,
  SegmentParams,
  SliceItem,
} from "../types";
import { formatBytes } from "../utils/canvas";

interface LeftPanelProps {
  mode: AppMode;
  t: UIStrings;
  source: LoadedImage | null;
  params: SegmentParams;
  comicParams: ComicDetectionParams;
  items: SliceItem[];
  selectedIds: number[];
  detecting: boolean;
  onParamsChange: (params: SegmentParams) => void;
  onComicParamsChange: (params: ComicDetectionParams) => void;
  onFileChange: (file: File) => void;
  onResegment: () => void;
  onAutoDetectComic: () => void;
  onSelect: (id: number, additive?: boolean) => void;
  onSelectAll: () => void;
  onMoveOrder: (id: number, direction: -1 | 1) => void;
  onMerge: () => void;
  onSplitSelected: () => void;
}

export function LeftPanel({
  mode,
  t,
  source,
  params,
  comicParams,
  items,
  selectedIds,
  detecting,
  onParamsChange,
  onComicParamsChange,
  onFileChange,
  onResegment,
  onAutoDetectComic,
  onSelect,
  onSelectAll,
  onMoveOrder,
  onMerge,
  onSplitSelected,
}: LeftPanelProps) {
  return (
    <aside className="side-panel left-panel">
      <section className="panel-section">
        <h2>{t.left.uploadTitle}</h2>
        <label className="upload-box">
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
              <span>
                {source.width} × {source.height}
              </span>
            </div>
            <small>{formatBytes(source.size)}</small>
          </div>
        )}
      </section>

      <section className="panel-section">
        <h2>{t.left.settingsTitle}</h2>
        {mode === "transparent" ? (
          <>
            <div className="control-row">
              <label>{t.left.alphaThreshold}</label>
              <input
                type="range"
                min="0"
                max="255"
                value={params.alphaThreshold}
                onChange={(e) =>
                  onParamsChange({ ...params, alphaThreshold: Number(e.target.value) })
                }
              />
              <input
                className="numeric"
                type="number"
                min="0"
                max="255"
                value={params.alphaThreshold}
                onChange={(e) =>
                  onParamsChange({ ...params, alphaThreshold: Number(e.target.value) })
                }
              />
            </div>
            <div className="control-row">
              <label>{t.left.neighborMode}</label>
              <div className="segmented">
                <button
                  className={params.neighborMode === 4 ? "active" : ""}
                  onClick={() => onParamsChange({ ...params, neighborMode: 4 })}
                >
                  {t.left.neighbor4}
                </button>
                <button
                  className={params.neighborMode === 8 ? "active" : ""}
                  onClick={() => onParamsChange({ ...params, neighborMode: 8 })}
                >
                  {t.left.neighbor8}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="control-row">
              <label>{t.left.gutterSensitivity}</label>
              <input
                type="range"
                min="0"
                max="100"
                value={comicParams.gutterSensitivity}
                onChange={(e) =>
                  onComicParamsChange({
                    ...comicParams,
                    gutterSensitivity: Number(e.target.value),
                  })
                }
              />
              <input
                className="numeric"
                type="number"
                min="0"
                max="100"
                value={comicParams.gutterSensitivity}
                onChange={(e) =>
                  onComicParamsChange({
                    ...comicParams,
                    gutterSensitivity: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="control-row">
              <label>{t.left.borderSensitivity}</label>
              <input
                type="range"
                min="0"
                max="100"
                value={comicParams.borderSensitivity}
                onChange={(e) =>
                  onComicParamsChange({
                    ...comicParams,
                    borderSensitivity: Number(e.target.value),
                  })
                }
              />
              <input
                className="numeric"
                type="number"
                min="0"
                max="100"
                value={comicParams.borderSensitivity}
                onChange={(e) =>
                  onComicParamsChange({
                    ...comicParams,
                    borderSensitivity: Number(e.target.value),
                  })
                }
              />
            </div>
            <label className="checkbox-line compact">
              <input
                type="checkbox"
                checked={comicParams.mergeNearbyPanels}
                onChange={(event) =>
                  onComicParamsChange({
                    ...comicParams,
                    mergeNearbyPanels: event.target.checked,
                  })
                }
              />
              {t.left.mergeNearbyPanels}
            </label>
            <label className="checkbox-line compact">
              <input
                type="checkbox"
                checked={comicParams.showConfidence}
                onChange={(event) =>
                  onComicParamsChange({
                    ...comicParams,
                    showConfidence: event.target.checked,
                  })
                }
              />
              {t.left.showConfidence}
            </label>
          </>
        )}
        <div className="control-row">
          <label>{t.left.minPixels}</label>
          <input
            type="range"
            min="1"
            max="5000"
            value={params.minPixels}
            onChange={(e) => onParamsChange({ ...params, minPixels: Number(e.target.value) })}
          />
          <input
            className="numeric"
            type="number"
            min="1"
            value={params.minPixels}
            onChange={(e) => onParamsChange({ ...params, minPixels: Number(e.target.value) })}
          />
        </div>
        <div className="mode-note">
          {mode === "transparent"
            ? t.left.transparentNote
            : t.left.comicNote}
        </div>
        {mode === "comic" ? (
          <button className="primary wide" onClick={onAutoDetectComic} disabled={!source || detecting}>
            <ScanSearch size={16} />
            {detecting ? t.left.detecting : t.left.autoDetect}
          </button>
        ) : (
          <button className="primary wide" onClick={onResegment} disabled={!source}>
            <RotateCcw size={16} />
            {t.left.resegment}
          </button>
        )}
      </section>

      <section className="panel-section grow">
        <div className="section-title-row">
          <h2>{t.left.listTitle(mode === "transparent" ? t.common.tiles : t.common.panels, items.length)}</h2>
          <button className="icon-button" title={t.left.filter}>
            <Filter size={16} />
          </button>
        </div>
        <div className="list-actions">
          <button onClick={onSelectAll}>
            <ListChecks size={15} />
            {t.left.selectAll}
          </button>
          <button>
            <ArrowDownAZ size={15} />
            {t.left.sortByArea}
          </button>
          <button onClick={onMerge} disabled={selectedIds.length < 2}>
            <Combine size={15} />
            {t.left.merge}
          </button>
          <button onClick={onSplitSelected} disabled={selectedIds.length !== 1}>
            <Scissors size={15} />
            {t.left.split}
          </button>
        </div>
        <div className="item-grid">
          {items.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <button
                key={item.id}
                className={selected ? "slice-card selected" : "slice-card"}
                onClick={(event) => onSelect(item.id, event.ctrlKey || event.metaKey)}
              >
                <img src={item.previewUrl} alt="" />
                <strong>
                  #{item.order + 1}
                  {mode === "comic" && comicParams.showConfidence && item.confidence != null
                    ? ` · ${Math.round(item.confidence * 100)}%`
                    : ""}
                </strong>
                <span>
                  {item.boundingBox.width}×{item.boundingBox.height}
                </span>
                <small>
                  {item.pixelCount.toLocaleString()} px
                  {item.source ? ` · ${item.source}` : ""}
                </small>
                <div className="order-buttons">
                  <button
                    type="button"
                    title={t.left.moveUp}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMoveOrder(item.id, -1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title={t.left.moveDown}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMoveOrder(item.id, 1);
                    }}
                  >
                    ↓
                  </button>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
