import React from "react";
import { BookOpen, Home, Palette, Plus, Server } from "lucide-react";

const LIBRARY_VIEWS = ["library", "favorites", "playlists"];
const IMPORT_VIEWS = ["import", "youtube", "offline"];

/**
 * Mobile bottom bar: exactly 5 items (Home, Library, Import, Server, Settings).
 * Desktop side nav: Home, Library, Import.
 */
export default function Navigation({
  variant = "desktop",
  view,
  onNavigate,
  role,
  offlineMode = false,
  trackCount = 0,
}) {
  const openImport = "import";
  const items =
    variant === "mobile"
      ? [
          { id: "home", label: "Home", icon: Home, active: view === "home" },
          { id: "library", label: "Library", icon: BookOpen, active: LIBRARY_VIEWS.includes(view) },
          { id: "add", label: "Import", icon: Plus, active: IMPORT_VIEWS.includes(view), target: openImport },
          { id: "server", label: "Server", icon: Server, active: view === "server" },
          { id: "settings", label: "Settings", icon: Palette, active: view === "settings" },
        ]
      : [
          { id: "home", label: "Home", icon: Home, active: view === "home" },
          { id: "library", label: "Library", icon: BookOpen, active: LIBRARY_VIEWS.includes(view), count: trackCount },
          { id: "import", label: "Import", icon: Plus, active: IMPORT_VIEWS.includes(view), target: openImport },
        ];

  return (
    <nav
      className={variant === "mobile" ? "mobile-bottom-nav" : "side-nav"}
      aria-label={variant === "mobile" ? "Mobile navigation" : "Main navigation"}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={(variant === "mobile" ? "mobile-nav-item" : "nav-item") + (item.active ? " nav-active" : "")}
            aria-current={item.active ? "page" : undefined}
            onClick={() => onNavigate(item.target || item.id)}
          >
            <Icon size={variant === "mobile" ? 20 : 19} />
            <span>{item.label}</span>
            {item.count !== undefined && variant !== "mobile" && <span className="nav-count">{item.count}</span>}
          </button>
        );
      })}
    </nav>
  );
}
