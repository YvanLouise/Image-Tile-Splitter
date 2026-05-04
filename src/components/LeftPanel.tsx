import { ArrowDownAZ, Combine, Filter, ImageUp, ListChecks, RotateCcw, Scissors } from "lucide-react";
import type { AppMode, LoadedImage, SegmentParams, SliceItem } from "../types";
import { formatBytes } from "../utils/canvas";

interface LeftPanelProps {
  mode: AppMode;
  source: LoadedImage | null;
  params: SegmentParams;
  items: SliceItem[];
  selectedIds: number[];
  includeMetadata: boolean;
  onParamsChange: (params: SegmentParams) => void;
  onFileChange: (file: File) => void;
  onResegment: () => void;
  onSelect: (id: number, additive?: boolean) => void;
  onSelectAll: () => void;
  onMoveOrder: (id: number, direction: -1 | 1) => void;
  onMerge: () => void;
  onSplitSelected: () => void;
}

export function LeftPanel({
  mode,
  source,
  params,
  items,
  selectedIds,
  onParamsChange,
  onFileChange,
  onResegment,
  onSelect,
  onSelectAll,
  onMoveOrder,
  onMerge,
  onSplitSelected,
}: LeftPanelProps) {
  return (
    <aside className="side-panel left-panel">
      <section className="panel-section">
        <h2>1. 上传图片</h2>
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
          <strong>点击或拖拽图片到此处</strong>
          <span>支持 PNG / WebP / JPG</span>
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
        <h2>2. 分割设置</h2>
        <div className="control-row">
          <label>Alpha 阈值</label>
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
          <label>连通规则</label>
          <div className="segmented">
            <button
              className={params.neighborMode === 4 ? "active" : ""}
              onClick={() => onParamsChange({ ...params, neighborMode: 4 })}
            >
              4 邻域
            </button>
            <button
              className={params.neighborMode === 8 ? "active" : ""}
              onClick={() => onParamsChange({ ...params, neighborMode: 8 })}
            >
              8 邻域
            </button>
          </div>
        </div>
        <div className="control-row">
          <label>最小像素数</label>
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
            ? "透明模式按 alpha 通道分离，1px 粘连会保留为同一块。"
            : "漫画格模式使用基础灰度检测，建议配合矩形和多边形手动修正。"}
        </div>
        <button className="primary wide" onClick={onResegment} disabled={!source}>
          <RotateCcw size={16} />
          重新分割
        </button>
      </section>

      <section className="panel-section grow">
        <div className="section-title-row">
          <h2>3. {mode === "transparent" ? "图块列表" : "漫画格列表"}（共 {items.length} 个）</h2>
          <button className="icon-button" title="筛选">
            <Filter size={16} />
          </button>
        </div>
        <div className="list-actions">
          <button onClick={onSelectAll}>
            <ListChecks size={15} />
            全选
          </button>
          <button>
            <ArrowDownAZ size={15} />
            按面积
          </button>
          <button onClick={onMerge} disabled={selectedIds.length < 2}>
            <Combine size={15} />
            合并
          </button>
          <button onClick={onSplitSelected} disabled={selectedIds.length !== 1}>
            <Scissors size={15} />
            拆分
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
                <strong>#{item.order + 1}</strong>
                <span>
                  {item.boundingBox.width}×{item.boundingBox.height}
                </span>
                <small>{item.pixelCount.toLocaleString()} px</small>
                <div className="order-buttons">
                  <button
                    type="button"
                    title="前移"
                    onClick={(event) => {
                      event.stopPropagation();
                      onMoveOrder(item.id, -1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title="后移"
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
