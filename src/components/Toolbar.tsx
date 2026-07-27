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
  Pipette,
  ScissorsLineDashed,
  Sun,
  Undo2,
  Redo2,
  Settings2,
  PanelLeft,
  ScanSearch,
  Waypoints,
} from "lucide-react";
import { useState, type ComponentType } from "react";
import appIconUrl from "../../icon/YL图块分离工具icon.png";
import bilibiliIconUrl from "../../icon/作者B站icon.png";
import githubIconUrl from "../../icon/YLGitHubIco.png";
import type { Language, ThemeMode, UIStrings } from "../i18n";
import type { AppMode, ToolMode, WorkspaceLayout } from "../types";

interface ToolbarProps {
  mode: AppMode;
  tool: ToolMode;
  t: UIStrings;
  language: Language;
  theme: ThemeMode;
  layout: WorkspaceLayout;
  canUndo: boolean;
  canRedo: boolean;
  onModeChange: (mode: AppMode) => void;
  onToolChange: (tool: ToolMode) => void;
  onLanguageChange: (language: Language) => void;
  onThemeToggle: () => void;
  onLayoutChange: (layout: WorkspaceLayout) => void;
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
  { id: "rangeExtract", labelKey: "rangeExtract", icon: ScanSearch },
  { id: "rect", labelKey: "rect", icon: PenLine },
  { id: "polygon", labelKey: "polygon", icon: Waypoints },
];

export function Toolbar({
  mode,
  tool,
  t,
  language,
  theme,
  layout,
  canUndo,
  canRedo,
  onModeChange,
  onToolChange,
  onLanguageChange,
  onThemeToggle,
  onLayoutChange,
  onHelpClick,
  onUploadClick,
  onUndo,
  onRedo,
}: ToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="app-header">
      <div className="brand">
        <img className="brand-app-icon" src={appIconUrl} alt="" />
        <div className="brand-copy">
          <h1>{t.common.appName}</h1>
          <p>{t.common.appSubtitle}</p>
        </div>
        <nav className="author-links" aria-label="作者链接">
          <a
            className="author-link bilibili-link"
            href="https://space.bilibili.com/190749586"
            target="_blank"
            rel="noopener noreferrer"
            title="作者B站"
            aria-label="打开作者B站主页"
          >
            <img src={bilibiliIconUrl} alt="" />
            <span>作者B站</span>
          </a>
          <a
            className="author-link github-link"
            href="https://github.com/YvanLouise/Image-Tile-Splitter"
            target="_blank"
            rel="noopener noreferrer"
            title="GitHub"
            aria-label="打开 GitHub 项目主页"
          >
            <img src={githubIconUrl} alt="" />
            <span>GitHub</span>
          </a>
        </nav>
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
          <button
            className={mode === "chroma" ? "active" : ""}
            onClick={() => onModeChange("chroma")}
          >
            <Pipette size={14} />
            {t.toolbar.chromaMode}
          </button>
        </div>

        {mode !== "chroma" && (
          <div className="tool-strip" aria-label={t.toolbar.toolStrip}>
            {tools.filter((item) => mode === "transparent" || item.id !== "rangeExtract").map((item) => {
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
        )}
      </div>

      <div className="header-actions">
        <button className="icon-text" onClick={onUploadClick}>
          <ImageUp size={17} />
          {t.common.upload}
        </button>
        <button className="icon-button" title={t.toolbar.undo} disabled={mode === "chroma" || !canUndo} onClick={onUndo}>
          <Undo2 size={17} />
        </button>
        <button className="icon-button" title={t.toolbar.redo} disabled={mode === "chroma" || !canRedo} onClick={onRedo}>
          <Redo2 size={17} />
        </button>
        <button className="ghost-action" title={t.common.help} onClick={onHelpClick}>
          <HelpCircle size={17} />
          {t.common.help}
        </button>
        <div className="appearance-menu">
          <button
            className="ghost-action"
            title={t.toolbar.appearance}
            aria-expanded={settingsOpen}
            aria-controls="appearance-settings"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings2 size={17} />
            {t.toolbar.appearance}
          </button>
          {settingsOpen ? (
            <div id="appearance-settings" className="appearance-popover">
              <div className="appearance-group">
                <span>{t.toolbar.themeLabel}</span>
                <div className="segmented appearance-segmented">
                  <button
                    className={theme === "light" ? "active" : ""}
                    aria-pressed={theme === "light"}
                    onClick={() => theme === "dark" && onThemeToggle()}
                  >
                    <Sun size={14} />
                    {t.common.lightTheme}
                  </button>
                  <button
                    className={theme === "dark" ? "active" : ""}
                    aria-pressed={theme === "dark"}
                    onClick={() => theme === "light" && onThemeToggle()}
                  >
                    <Moon size={14} />
                    {t.common.darkTheme}
                  </button>
                </div>
              </div>
              <div className="appearance-group">
                <span>{t.toolbar.layoutLabel}</span>
                <div className="segmented appearance-segmented">
                  <button
                    className={layout === "classic" ? "active" : ""}
                    aria-pressed={layout === "classic"}
                    onClick={() => onLayoutChange("classic")}
                  >
                    <PanelLeft size={14} />
                    {t.toolbar.classicLayout}
                  </button>
                  <button
                    className={layout === "focus" ? "active" : ""}
                    aria-pressed={layout === "focus"}
                    onClick={() => onLayoutChange("focus")}
                  >
                    <BoxSelect size={14} />
                    {t.toolbar.focusLayout}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
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
