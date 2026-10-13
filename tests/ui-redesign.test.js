import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const readSource = (relativePath) => fs.readFile(new URL("../" + relativePath, import.meta.url), "utf8");

test("mobile navigation exposes exactly five main destinations", async () => {
  const source = await readSource("src/components/Layout/Navigation.jsx");
  const mobile = source.match(/variant === "mobile"\s*\?\s*\[([\s\S]*?)\]\s*:\s*\[/);
  assert.ok(mobile, "mobile navigation configuration should be present");
  const ids = [...mobile[1].matchAll(/\{ id: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["home", "library", "add", "server", "settings"]);
});

test("library filters are collapsed by default and expose removable active chips", async () => {
  const [app, panel, css] = await Promise.all([
    readSource("src/App.jsx"),
    readSource("src/components/Library/FilterPanel.jsx"),
    readSource("src/styles.css"),
  ]);
  assert.ok(app.includes('selfmusic:library-filters:v1'), "library filters should persist between visits");
  assert.ok(app.includes("<FilterPanel"), "the library should use the extracted filter panel");
  assert.ok(panel.includes('aria-expanded={open}'));
  assert.ok(panel.includes('aria-label="Active filters"'));
  assert.ok(panel.includes('offlineOnly'));
  assert.ok(css.includes(".library-filter-drawer:not(.library-filter-drawer-open) { display: none; }"));
  assert.ok(css.includes("grid-template-columns: repeat(5,minmax(0,1fr))"), "mobile bottom navigation should reserve five equal columns");
});

test("settings UI includes appearance, integration, offline and about sections", async () => {
  const [settings, app, css] = await Promise.all([
    readSource("src/components/Settings/SettingsTabs.jsx"),
    readSource("src/App.jsx"),
    readSource("src/styles.css"),
  ]);
  const sectionIds = [...settings.matchAll(/id: "([^"]+)", label:/g)].map((match) => match[1]);
  assert.equal(new Set(sectionIds).size, sectionIds.length, "Settings tab IDs must be unique to avoid duplicate React keys");
  for (const section of ["profile", "appearance", "player", "library", "integrations", "offline", "advanced", "about"]) {
    assert.ok(sectionIds.includes(section), "missing Settings section: " + section);
    assert.ok(css.includes('data-settings-section="' + section + '"'), "missing Settings panel selector: " + section);
  }
  assert.ok(app.includes("selfmusic-theme"));
  assert.ok(app.includes("backgroundPreset"));
  assert.ok(app.includes("navPosition"));
  assert.ok(app.includes("--user-glass-opacity"));
  assert.ok(css.includes("prefers-reduced-motion: reduce"));
});

test("server page is separated from personal settings panels", async () => {
  const css = await readSource("src/styles.css");
  assert.ok(css.includes('.app-shell[data-view="settings"] .settings-status-card'));
  assert.ok(css.includes('.app-shell[data-view="server"] .settings-grid { display: none !important; }'));
});

test("appearance and playback dismissals sync through per-account preferences", async () => {
  const [app, css, routes] = await Promise.all([
    readSource("src/App.jsx"),
    readSource("src/styles.css"),
    readSource("server/preferences.js"),
  ]);
  assert.ok(app.includes('fetch("/api/preferences/appearance"'));
  assert.ok(app.includes('fetch("/api/preferences/dismissed-playback"'));
  assert.ok(app.includes("dismissedPlaybackKeysRef.current.has(dismissalKey) ? null : state"));
  assert.ok(app.includes("const dismissalKey = remotePlaybackDismissalKey(remotePlaybackState)"));
  assert.ok(routes.includes('new Set(["appearance", "dismissed-playback"])'));
  assert.ok(routes.includes("MAX_WALLPAPER_DATA_URL_LENGTH"));
  assert.ok(app.includes('"--user-background-direct": appearance.wallpaperBlur === 0 ? backgroundImage : "none"'));
  assert.ok(css.includes("background-image: var(--user-background-direct, none) !important;"));
  assert.ok(css.includes("opacity: var(--user-wallpaper-backdrop-opacity, 1)"));
});

test("offline view refresh reads the device cache and does not offer server setup when empty", async () => {
  const [app, trackList] = await Promise.all([
    readSource("src/App.jsx"),
    readSource("src/components/Library/TrackList.jsx"),
  ]);
  assert.ok(app.includes("const refreshOfflineLibrary = useCallback(async () =>"));
  assert.ok(app.includes("onClick={view === \"offline\" ? refreshOfflineLibrary : loadTracks}"));
  assert.ok(app.includes('view === "offline" ? "No offline tracks yet"'));
  assert.ok(app.includes('onServerSetup={view === "offline" ? undefined : () => setView("server")}'));
  assert.ok(trackList.includes("{onServerSetup && <button className=\"ghost-button\""));
});

test("collection card opens playlists without duplicating the collection title", async () => {
  const app = await readSource("src/App.jsx");
  assert.ok(app.includes('<div className="library-heading"><span>Your collection</span>'));
  assert.ok(app.includes('<span><strong>Playlists</strong><small>{playlists.length}'));
  assert.ok(app.includes('setView("playlists"); setMobileMenuOpen(false);'));
});

test("dismissal keys merged from other devices are synchronized back to the account", async () => {
  const app = await readSource("src/App.jsx");
  assert.ok(app.includes("keys.some((key) => !remoteKeys.includes(key))"));
  assert.ok(app.includes('fetch("/api/preferences/dismissed-playback", {'));
});
