import { Download, Image, SlidersHorizontal } from "lucide-react";
import type { UIStrings } from "../i18n";
import type { MobileWorkspaceTab } from "../types";

interface MobileWorkspaceNavProps {
  activeTab: MobileWorkspaceTab;
  t: UIStrings;
  onChange: (tab: MobileWorkspaceTab) => void;
}

const tabs = [
  { id: "settings", icon: SlidersHorizontal },
  { id: "canvas", icon: Image },
  { id: "result", icon: Download },
] as const;

export function MobileWorkspaceNav({
  activeTab,
  t,
  onChange,
}: MobileWorkspaceNavProps) {
  return (
    <nav className="mobile-workspace-nav" aria-label={t.mobile.workspaceNavigation}>
      {tabs.map(({ id, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={activeTab === id ? "active" : ""}
          aria-current={activeTab === id ? "page" : undefined}
          onClick={() => onChange(id)}
        >
          <Icon size={20} />
          <span>{t.mobile.tabs[id]}</span>
        </button>
      ))}
    </nav>
  );
}
