import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { closeDatabase, createDatabase } from "../server/database.js";
import { mountUserPreferenceRoutes } from "../server/preferences.js";

test("account preferences persist per user and synchronize an appearance and dismissed playback list", async () => {
  const db = createDatabase(":memory:");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const requireAuth = (req, _res, next) => {
    req.authUser = { id: req.get("x-test-user") || "user-a", username: "tester", role: "user" };
    next();
  };
  mountUserPreferenceRoutes(app, { db, requireAuth });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const appearance = {
      theme: "light",
      accent: "rose",
      accentColor: "#f1a0ba",
      wallpaperDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      wallpaperBlur: 0,
      animations: true,
    };
    const saveAppearance = await fetch(base + "/api/preferences/appearance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: appearance }),
    });
    assert.equal(saveAppearance.status, 200);
    assert.equal((await saveAppearance.json()).value.wallpaperDataUrl, appearance.wallpaperDataUrl);

    const saveDismissals = await fetch(base + "/api/preferences/dismissed-playback", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: { keys: ['["device-a","track-a"]'] } }),
    });
    assert.equal(saveDismissals.status, 200);
    const readBack = await fetch(base + "/api/preferences");
    const prefBody = await readBack.json();
    assert.equal(prefBody.preferences.appearance.theme, "light");
    assert.deepEqual(prefBody.preferences["dismissed-playback"].keys, ['["device-a","track-a"]']);

    const otherUser = await fetch(base + "/api/preferences", { headers: { "x-test-user": "user-b" } });
    assert.deepEqual((await otherUser.json()).preferences, {});

    const badWallpaper = await fetch(base + "/api/preferences/appearance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: { wallpaperDataUrl: "data:image/svg+xml,<svg/>" } }),
    });
    assert.equal(badWallpaper.status, 400);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
    closeDatabase(db);
  }
});
