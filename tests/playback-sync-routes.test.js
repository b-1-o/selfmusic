import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { closeDatabase, createDatabase } from "../server/database.js";
import { mountPlaybackSyncRoutes } from "../server/playback-sync.js";

test("playback state HTTP API authenticates per user and enforces optimistic concurrency", async () => {
  const db = createDatabase(":memory:");
  db.prepare("INSERT INTO tracks(id, relative_path, title) VALUES (?, ?, ?)").run("track-a", "a.mp3", "Track A");
  const app = express();
  app.use(express.json());
  const requireAuth = (req, _res, next) => {
    req.authUser = { id: req.get("x-test-user") || "user-a", username: "tester", role: "user" };
    next();
  };
  mountPlaybackSyncRoutes(app, { db, requireAuth });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const initialResponse = await fetch(base + "/api/playback/state");
    assert.equal(initialResponse.status, 200);
    assert.equal((await initialResponse.json()).state.revision, 0);

    const payload = {
      expectedRevision: 0,
      queue: ["track-a"],
      currentTrackId: "track-a",
      positionSeconds: 31,
      isPlaying: true,
      repeatMode: "off",
      shuffle: false,
      sourceDeviceId: "test-device"
    };
    const writeResponse = await fetch(base + "/api/playback/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(writeResponse.status, 200);
    assert.equal((await writeResponse.json()).state.revision, 1);

    const staleResponse = await fetch(base + "/api/playback/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(staleResponse.status, 409);
    const stale = await staleResponse.json();
    assert.equal(stale.error, "revision_conflict");
    assert.equal(stale.state.positionSeconds, 31);

    const anotherUserResponse = await fetch(base + "/api/playback/state", {
      headers: { "x-test-user": "user-b" }
    });
    assert.equal((await anotherUserResponse.json()).state.revision, 0);

    const eventsResponse = await fetch(base + "/api/playback/events", { headers: { "x-test-user": "user-b" } });
    assert.equal(eventsResponse.status, 200);
    assert.match(eventsResponse.headers.get("content-type"), /text\/event-stream/);
    const reader = eventsResponse.body.getReader();
    let initialText = "";
    for (let attempt = 0; attempt < 5 && !initialText.includes("event: playback-state"); attempt += 1) {
      const chunk = await reader.read();
      if (chunk.done) break;
      initialText += new TextDecoder().decode(chunk.value);
    }
    assert.match(initialText, /event: playback-state/);
    await reader.cancel();
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
    closeDatabase(db);
  }
});
