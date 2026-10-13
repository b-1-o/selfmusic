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
  for (const section of ["profile", "appearance", "player", "library", "integrations", "offline", "advanced", "about"]) {
    assert.ok(settings.includes('id: "' + section + '"'), "missing Settings section: " + section);
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
