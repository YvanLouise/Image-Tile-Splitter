import {
  BoxSelect,
  Download,
  Eraser,
  Hand,
  HelpCircle,
  ImageUp,
  Languages,
  Moon,
  Paintbrush,
  PenLine,
  ScissorsLineDashed,
  Undo2,
  Redo2,
  Waypoints,
} from "lucide-react";
import type { ComponentType } from "react";
import type { AppMode, ToolMode } from "../types";

interface ToolbarProps {
  mode: AppMode;
  tool: ToolMode;
  canUndo: boolean;
  canRedo: boolean;
  onModeChange: (mode: AppMode) => void;
  onToolChange: (tool: ToolMode) => void;
  onUploadClick: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const tools: Array<{ id: ToolMode; label: string; icon: ComponentType<{ size?: number }> }> = [
  { id: "pan", label: "拖拽", icon: Hand },
  { id: "select", label: "选择", icon: BoxSelect },
  { id: "splitLine", label: "分割线", icon: ScissorsLineDashed },
  { id: "eraser", label: "橡皮擦", icon: Eraser },
  { id: "restore", label: "恢复", icon: Paintbrush },
  { id: "rect", label: "矩形框", icon: PenLine },
  { id: "polygon", label: "多边形", icon: Waypoints },
];

export function Toolbar({
  mode,
  tool,
  canUndo,
  canRedo,
  onModeChange,
  onToolChange,
  onUploadClick,
  onUndo,
  onRedo,
}: ToolbarProps) {
  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark">
          <span />
          <span />
        </div>
        <div>
          <h1>图块分离工具</h1>
          <p>分离透明背景中的不相连图块</p>
        </div>
      </div>

      <div className="header-center">
        <div className="segmented mode-switch" aria-label="模式切换">
          <button
            className={mode === "transparent" ? "active" : ""}
            onClick={() => onModeChange("transparent")}
          >
            图块
          </button>
          <button
            className={mode === "comic" ? "active" : ""}
            onClick={() => onModeChange("comic")}
          >
            漫画格
          </button>
        </div>

        <div className="tool-strip" aria-label="编辑工具">
          {tools.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={tool === item.id ? "icon-button active" : "icon-button"}
                title={item.label}
                onClick={() => onToolChange(item.id)}
              >
                <Icon size={17} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="header-actions">
        <button className="icon-text" onClick={onUploadClick}>
          <ImageUp size={17} />
          上传
        </button>
        <button className="icon-button" title="撤销" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={17} />
        </button>
        <button className="icon-button" title="重做" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={17} />
        </button>
        <button className="ghost-action" title="使用帮助">
          <HelpCircle size={17} />
          使用帮助
        </button>
        <button className="icon-button" title="外观">
          <Moon size={17} />
        </button>
        <button className="ghost-action" title="语言">
          <Languages size={17} />
          简体中文
        </button>
        <button className="icon-button" title="导出">
          <Download size={17} />
        </button>
      </div>
    </header>
  );
}
