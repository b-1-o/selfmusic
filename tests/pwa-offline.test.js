import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFile(path.join(root, relative), "utf8");

test("PWA manifest, shell registration, and install assets are present", async () => {
  const [html, entry, manifest, sw] = await Promise.all([
    read("index.html"),
    read("src/main.jsx"),
    read("public/manifest.webmanifest"),
    read("public/sw.js")
  ]);
  const parsed = JSON.parse(manifest);
  assert.match(html, /rel=["']manifest["'][^>]*manifest\.webmanifest|rel=["']manifest["'][^>]*manifest\.webmanifest/i);
  assert.match(entry, /serviceWorker\.register\(["']\/sw\.js["']\)/);
  assert.equal(parsed.display, "standalone");
  assert.ok(parsed.icons.some((icon) => icon.src === "/icon-192.png" && icon.sizes === "192x192"));
  assert.ok(parsed.icons.some((icon) => icon.src === "/icon-512.png" && icon.sizes === "512x512"));
  assert.match(sw, /cache\.addAll\(\["\/",\s*"\/icon\.svg",\s*"\/manifest\.webmanifest"\]\)/);
});

test("offline audio uses an explicit cache route and does not cache private API GETs", async () => {
  const sw = await read("public/sw.js");
  assert.match(sw, /const OFFLINE_AUDIO_CACHE = ["']selfmusic-offline-audio-v1["']/);
  assert.match(sw, /url\.pathname\.startsWith\(["']\/__selfmusic_offline\/["']\)/);
  assert.match(sw, /cache\.match\(request/);
  assert.match(sw, /fetch\(new Request\(["']\/api\/stream\//);
  assert.match(sw, /if \(url\.pathname\.startsWith\(["']\/api\/["']\)\) return/);
  assert.match(sw, /new Response\(["']This track is not saved on this device/);
});

test("web player provides Media Session controls and explicit offline save/removal", async () => {
  const [app, trackList] = await Promise.all([
    read("src/App.jsx"),
    read("src/components/Library/TrackList.jsx")
  ]);
  for (const action of ["play", "pause", "previoustrack", "nexttrack", "seekto"]) {
    assert.ok(app.includes('setActionHandler("' + action + '"'), "expected Media Session handler: " + action);
  }
  assert.match(app, /setPositionState/);
  assert.match(app, /cache\.put\(request, response\)/);
  assert.match(app, /await cache\.delete\(request\)/);
  assert.match(app, /view === "offline"/);
  assert.match(trackList, /"Save " \+ track\.title \+ " for offline playback"/);
  assert.match(app, /await window\.caches\.delete\(OFFLINE_AUDIO_CACHE\)/);
  assert.match(app, /localStorage\.removeItem\(OFFLINE_TRACKS_KEY\)/);
  assert.match(app, /setActionHandler\("seekforward"/);

});

test("offline cache recovery keeps cached IDs visible if local metadata is missing", async () => {
  const app = await read("src/App.jsx");
  assert.match(app, /const cachedIds = new Set\(\)/);
  assert.match(app, /byId\.get\(id\) \|\| \(\{/);
  assert.match(app, /title: "Saved track " \+ id\.slice\(0, 8\)/);
  assert.match(app, /metadataFallback: true/);
});

test("Offline downloads refresh from CacheStorage and missing metadata remains playable", async () => {
  const app = await read("src/App.jsx");
  assert.match(app, /const refreshOfflineLibrary = useCallback\(async \(\) =>/);
  assert.match(app, /readOfflineLibraryFromCache\(\)/);
  assert.match(app, /byId\.get\(id\) \|\| \(\{/);
  assert.match(app, /metadataFallback: true/);
});
