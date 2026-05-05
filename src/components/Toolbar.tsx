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
  Sun,
  Undo2,
  Redo2,
  Waypoints,
} from "lucide-react";
import type { ComponentType } from "react";
import type { Language, ThemeMode, UIStrings } from "../i18n";
import type { AppMode, ToolMode } from "../types";

interface ToolbarProps {
  mode: AppMode;
  tool: ToolMode;
  t: UIStrings;
  language: Language;
  theme: ThemeMode;
  canUndo: boolean;
  canRedo: boolean;
  onModeChange: (mode: AppMode) => void;
  onToolChange: (tool: ToolMode) => void;
  onLanguageChange: (language: Language) => void;
  onThemeToggle: () => void;
  onHelpClick: () => void;
  onUploadClick: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const tools: Array<{ id: ToolMode; labelKey: keyof UIStrings["toolbar"]["tools"]; icon: ComponentType<{ size?: number }> }> = [
  { id: "pan", labelKey: "pan", icon: Hand },
  { id: "select", labelKey: "select", icon: BoxSelect },
  { id: "splitLine", labelKey: "splitLine", icon: ScissorsLineDashed },
  { id: "eraser", labelKey: "eraser", icon: Eraser },
  { id: "restore", labelKey: "restore", icon: Paintbrush },
  { id: "rect", labelKey: "rect", icon: PenLine },
  { id: "polygon", labelKey: "polygon", icon: Waypoints },
];

export function Toolbar({
  mode,
  tool,
  t,
  language,
  theme,
  canUndo,
  canRedo,
  onModeChange,
  onToolChange,
  onLanguageChange,
  onThemeToggle,
  onHelpClick,
  onUploadClick,
  onUndo,
  onRedo,
}: ToolbarProps) {
  const ThemeIcon = theme === "dark" ? Sun : Moon;

  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark">
          <span />
          <span />
        </div>
        <div>
          <h1>{t.common.appName}</h1>
          <p>{t.common.appSubtitle}</p>
        </div>
      </div>

      <div className="header-center">
        <div className="segmented mode-switch" aria-label={t.toolbar.modeSwitch}>
          <button
            className={mode === "transparent" ? "active" : ""}
            onClick={() => onModeChange("transparent")}
          >
            {t.toolbar.transparentMode}
          </button>
          <button
            className={mode === "comic" ? "active" : ""}
            onClick={() => onModeChange("comic")}
          >
            {t.toolbar.comicMode}
          </button>
        </div>

        <div className="tool-strip" aria-label={t.toolbar.toolStrip}>
          {tools.map((item) => {
            const Icon = item.icon;
            const label = t.toolbar.tools[item.labelKey];
            return (
              <button
                key={item.id}
                className={tool === item.id ? "icon-button active" : "icon-button"}
                title={label}
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
          {t.common.upload}
        </button>
        <button className="icon-button" title={t.toolbar.undo} disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={17} />
        </button>
        <button className="icon-button" title={t.toolbar.redo} disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={17} />
        </button>
        <button className="ghost-action" title={t.common.help} onClick={onHelpClick}>
          <HelpCircle size={17} />
          {t.common.help}
        </button>
        <button className="ghost-action" title={t.toolbar.appearance} onClick={onThemeToggle}>
          <ThemeIcon size={17} />
          {theme === "dark" ? t.common.lightTheme : t.common.darkTheme}
        </button>
        <label className="language-control" title={t.common.language}>
          <Languages size={17} />
          <select
            aria-label={t.common.language}
            value={language}
            onChange={(event) => onLanguageChange(event.target.value as Language)}
          >
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <button className="icon-button" title={t.toolbar.export}>
          <Download size={17} />
        </button>
      </div>
    </header>
  );
}
