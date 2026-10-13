import React from "react";
import { AudioLines, Download, FolderOpen, Palette, Plug, Shield, UserRound } from "lucide-react";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "player", label: "Player", icon: AudioLines },
  { id: "library", label: "Library", icon: FolderOpen },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "offline", label: "Offline", icon: Download },
  { id: "advanced", label: "Advanced", icon: Shield },
];

export default function SettingsTabs({ active, onChange }) {
  return (
    <nav className="settings-section-nav" aria-label="Settings sections">
      {SECTIONS.map((section) => {
        const Icon = section.icon;
        const selected = active === section.id;
        return (
          <button
            key={section.id}
            type="button"
            className={"settings-section-tab" + (selected ? " settings-section-tab-active" : "")}
            aria-current={selected ? "page" : undefined}
            onClick={() => onChange(section.id)}
          >
            <Icon size={15} />
            <span>{section.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
