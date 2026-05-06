import { Archive, Download, FileJson, Minus, Package, Plus, ScanSearch } from "lucide-react";
import type { UIStrings } from "../i18n";
import type { LoadedImage, SliceItem } from "../types";

interface RightPanelProps {
  t: UIStrings;
  source: LoadedImage | null;
  selectedItems: SliceItem[];
  allItems: SliceItem[];
  zoom: number;
  includeMetadata: boolean;
  exportScope: "selected" | "all";
  exportFileName: string;
  onZoomChange: (zoom: number) => void;
  onIncludeMetadataChange: (value: boolean) => void;
  onExportScopeChange: (scope: "selected" | "all") => void;
  onExportFileNameChange: (fileName: string) => void;
  onExportCurrent: () => void;
  onExportZip: () => void;
  onExportMetadata: () => void;
}

export function RightPanel({
  t,
  source,
  selectedItems,
  allItems,
  zoom,
  includeMetadata,
  exportScope,
  exportFileName,
  onZoomChange,
  onIncludeMetadataChange,
  onExportScopeChange,
  onExportFileNameChange,
  onExportCurrent,
  onExportZip,
  onExportMetadata,
}: RightPanelProps) {
  const selected = selectedItems[0] ?? null;
  const exportCount = exportScope === "all" ? allItems.length : selectedItems.length;
  const canRenameSingle = exportScope === "selected" && selectedItems.length === 1;

  return (
    <aside className="side-panel right-panel">
      <section className="panel-section preview-section">
        <h2>{t.right.previewTitle}</h2>
        {selected ? (
          <>
            <div className="selected-summary">
              <strong>{t.right.selected(selected.order + 1)}</strong>
              <span>{t.right.selectedSize(
                selected.boundingBox.width,
                selected.boundingBox.height,
                selected.pixelCount.toLocaleString(),
              )}</span>
              {selected.source && (
                <span>
                  {t.right.selectedSource(
                    selected.source,
                    selected.confidence == null ? undefined : Math.round(selected.confidence * 100),
                  )}
                </span>
              )}
            </div>
            <div className="preview-frame">
              <img src={selected.previewUrl} alt="" />
            </div>
            <div className="preview-tools">
              <button className="icon-button" onClick={() => onZoomChange(Math.max(0.1, zoom - 0.1))}>
                <Minus size={16} />
              </button>
              <strong>{Math.round(zoom * 100)}%</strong>
              <button className="icon-button" onClick={() => onZoomChange(Math.min(6, zoom + 0.1))}>
                <Plus size={16} />
              </button>
              <button className="icon-button" title={t.right.fit}>
                <ScanSearch size={16} />
              </button>
              <button className="icon-button accented" title={t.right.downloadCurrent} onClick={onExportCurrent}>
                <Download size={16} />
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">{t.right.empty}</div>
        )}
      </section>

      <section className="panel-section export-section">
        <h2>{t.right.exportTitle}</h2>
        <div className="export-options">
          <label>
            <input
              type="radio"
              checked={exportScope === "selected"}
              onChange={() => onExportScopeChange("selected")}
            />
            {t.right.exportSelected}
          </label>
          <label>
            <input
              type="radio"
              checked={exportScope === "all"}
              onChange={() => onExportScopeChange("all")}
            />
            {t.right.exportAll(allItems.length)}
          </label>
        </div>
        <label className="select-label">
          {t.right.fileFormat}
          <select value="png" disabled>
            <option>PNG (.png)</option>
          </select>
        </label>
        {canRenameSingle && (
          <label className="select-label">
            {t.right.exportFileName}
            <input
              className="file-name-input"
              value={exportFileName}
              placeholder={t.right.fileNamePlaceholder}
              onChange={(event) => onExportFileNameChange(event.target.value)}
            />
          </label>
        )}
        <button className="primary wide" disabled={!selected} onClick={onExportCurrent}>
          <Download size={16} />
          {t.right.exportPng}
        </button>
        <button className="secondary wide" disabled={!source || exportCount === 0} onClick={onExportZip}>
          <Package size={16} />
          {t.right.exportZip}
        </button>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={includeMetadata}
            onChange={(event) => onIncludeMetadataChange(event.target.checked)}
          />
          {t.right.includeMetadata}
        </label>
        <button className="text-command" disabled={!source || allItems.length === 0} onClick={onExportMetadata}>
          <FileJson size={16} />
          {t.right.exportMetadata}
        </button>
        <div className="export-footnote">
          <Archive size={15} />
          {t.right.exportFootnote}
        </div>
      </section>
    </aside>
  );
}
