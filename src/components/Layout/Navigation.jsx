import React from "react";
import { BookOpen, Heart, Home, ListMusic, Palette, Plus, Server } from "lucide-react";

const LIBRARY_VIEWS = ["library", "favorites", "playlists"];
const ADD_VIEWS = ["import", "offline", "youtube"];

export default function Navigation({
  variant = "desktop",
  view,
  onNavigate,
  role,
  offlineMode = false,
  trackCount = 0,
}) {
  const openAdd = role === "admin" && !offlineMode ? "import" : "youtube";
  const items = variant === "mobile"
    ? [
        { id: "home", label: "Home", icon: Home, active: view === "home" },
        { id: "library", label: "Library", icon: BookOpen, active: LIBRARY_VIEWS.includes(view) },
        { id: "add", label: "Add", icon: Plus, active: ADD_VIEWS.includes(view), target: openAdd },
        { id: "server", label: "Server", icon: Server, active: view === "server" },
        { id: "settings", label: "Settings", icon: Palette, active: view === "settings" },
      ]
    : [
        { id: "home", label: "Home", icon: Home, active: view === "home" },
        { id: "library", label: "Library", icon: BookOpen, active: LIBRARY_VIEWS.includes(view), count: trackCount },
        { id: "add", label: "Add / Import", icon: Plus, active: ADD_VIEWS.includes(view), target: openAdd },
      ];

  return (
    <nav className={variant === "mobile" ? "mobile-bottom-nav" : "side-nav"} aria-label={variant === "mobile" ? "Mobile navigation" : "Main navigation"}>
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
