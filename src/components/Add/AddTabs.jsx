import React from "react";
import { Download, Upload, Youtube } from "lucide-react";

const TABS = [
  { id: "import", label: "Import", detail: "Upload files and import audio URLs", icon: Upload, adminOnly: true },
  { id: "youtube", label: "Explore YouTube", detail: "Search and play videos", icon: Youtube },
  { id: "offline", label: "Offline", detail: "Audio saved on this device", icon: Download },
];

export default function AddTabs({ view, onNavigate, isAdmin }) {
  return (
    <nav className="add-section-tabs" aria-label="Add and manage music">
      <div className="add-section-tabs-heading">
        <span className="add-section-overline">YOUR MUSIC WORKFLOW</span>
        <span className="add-section-hint">Add, discover, and keep audio available offline.</span>
      </div>
      <div className="add-section-tab-list">
        {TABS.filter((tab) => !tab.adminOnly || isAdmin).map((tab) => {
          const Icon = tab.icon;
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
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
