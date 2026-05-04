import { Archive, Download, FileJson, Minus, Package, Plus, ScanSearch } from "lucide-react";
import type { LoadedImage, SliceItem } from "../types";

interface RightPanelProps {
  source: LoadedImage | null;
  selectedItems: SliceItem[];
  allItems: SliceItem[];
  zoom: number;
  includeMetadata: boolean;
  exportScope: "selected" | "all";
  onZoomChange: (zoom: number) => void;
  onIncludeMetadataChange: (value: boolean) => void;
  onExportScopeChange: (scope: "selected" | "all") => void;
  onExportCurrent: () => void;
  onExportZip: () => void;
  onExportMetadata: () => void;
}

export function RightPanel({
  source,
  selectedItems,
  allItems,
  zoom,
  includeMetadata,
  exportScope,
  onZoomChange,
  onIncludeMetadataChange,
  onExportScopeChange,
  onExportCurrent,
  onExportZip,
  onExportMetadata,
}: RightPanelProps) {
  const selected = selectedItems[0] ?? null;
  const exportCount = exportScope === "all" ? allItems.length : selectedItems.length;

  return (
    <aside className="side-panel right-panel">
      <section className="panel-section preview-section">
        <h2>5. 图块预览</h2>
        {selected ? (
          <>
            <div className="selected-summary">
              <strong>当前选中：#{selected.order + 1}</strong>
              <span>
                {selected.boundingBox.width} × {selected.boundingBox.height} px，
                {selected.pixelCount.toLocaleString()} 像素
              </span>
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
              <button className="icon-button" title="适配">
                <ScanSearch size={16} />
              </button>
              <button className="icon-button accented" title="下载当前" onClick={onExportCurrent}>
                <Download size={16} />
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">上传图片并选择一个图块后显示预览</div>
        )}
      </section>

      <section className="panel-section export-section">
        <h2>6. 导出</h2>
        <div className="export-options">
          <label>
            <input
              type="radio"
              checked={exportScope === "selected"}
              onChange={() => onExportScopeChange("selected")}
            />
            导出当前选中图块
          </label>
          <label>
            <input
              type="radio"
              checked={exportScope === "all"}
              onChange={() => onExportScopeChange("all")}
            />
            导出所有图块（{allItems.length} 个）
          </label>
        </div>
        <label className="select-label">
          文件格式
          <select value="png" disabled>
            <option>PNG (.png)</option>
          </select>
        </label>
        <button className="primary wide" disabled={!selected} onClick={onExportCurrent}>
          <Download size={16} />
          导出 PNG
        </button>
        <button className="secondary wide" disabled={!source || exportCount === 0} onClick={onExportZip}>
          <Package size={16} />
          批量导出（ZIP）
        </button>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={includeMetadata}
            onChange={(event) => onIncludeMetadataChange(event.target.checked)}
          />
          同时导出 metadata.json
        </label>
        <button className="text-command" disabled={!source || allItems.length === 0} onClick={onExportMetadata}>
          <FileJson size={16} />
          单独导出 metadata.json
        </button>
        <div className="export-footnote">
          <Archive size={15} />
          导出会按当前列表顺序命名。
        </div>
      </section>
    </aside>
  );
}
