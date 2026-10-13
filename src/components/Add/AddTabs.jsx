import React from "react";
import { Download, Upload, Youtube } from "lucide-react";

/** Sub-tabs inside the single Import section (not bottom-nav items). */
const TABS = [
  { id: "import", label: "Upload", detail: "Upload audio files from this device", icon: Upload, adminOnly: true },
  { id: "youtube", label: "YouTube", detail: "Search and convert to your library", icon: Youtube },
  { id: "offline", label: "Offline", detail: "Copies saved on this device", icon: Download },
];

export default function AddTabs({ view, onNavigate, isAdmin }) {
  return (
    <nav className="add-section-tabs" aria-label="Import music" data-import-tabs="true">
      <div className="add-section-tabs-heading">
        <span className="add-section-overline">IMPORT</span>
        <span className="add-section-hint">Upload, YouTube convert, or offline copies — one place.</span>
      </div>
      <div className="add-section-tab-list" role="tablist">
        {TABS.filter((tab) => !tab.adminOnly || isAdmin).map((tab) => {
          const Icon = tab.icon;
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              className={"add-section-tab" + (active ? " add-section-tab-active" : "")}
              onClick={() => onNavigate(tab.id)}
              title={tab.detail}
            >
              <Icon size={17} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
