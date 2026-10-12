import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { closeDatabase, createDatabase } from "../server/database.js";
import { mountCollectionRoutes } from "../server/collections.js";

async function startServer(db) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    req.authUser = { id: "test-user", username: "tester", role: "user" };
    next();
  });
  mountCollectionRoutes(app, { db, requireAuth: (_req, _res, next) => next(), findTracks: async () => [] });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function seedTrack(db) {
  db.prepare("INSERT INTO artists(id, name) VALUES (?, ?)").run("artist-1", "Example Artist");
  db.prepare("INSERT INTO albums(id, artist_id, title) VALUES (?, ?, ?)").run("album-1", "artist-1", "Example Album");
  db.prepare("INSERT INTO tracks(id, relative_path, title, artist_id, album_id, artist, album, duration, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "track_1", "Example Artist/Example Album/song.mp3", "Song", "artist-1", "album-1", "Example Artist", "Example Album", 123, "a".repeat(64)
  );
}

test("playlist CRUD, favorite persistence, history and M3U export/import are integrated", async () => {
  const db = createDatabase(":memory:");
  seedTrack(db);
  const server = await startServer(db);
  try {
    const createResponse = await fetch(server.baseUrl + "/api/playlists", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Road Trip", description: "Test playlist" })
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    const playlistId = created.playlist.id;

    const addResponse = await fetch(server.baseUrl + "/api/playlists/" + playlistId + "/tracks", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trackId: "track_1" })
    });
    assert.equal(addResponse.status, 201);
    assert.equal((await addResponse.json()).added, 1);

    const playlistResponse = await fetch(server.baseUrl + "/api/playlists/" + playlistId);
    assert.equal((await playlistResponse.json()).playlist.tracks[0].title, "Song");

    const favoriteResponse = await fetch(server.baseUrl + "/api/favorites/track_1", { method: "POST" });
    assert.equal(favoriteResponse.status, 201);
    const favoritesResponse = await fetch(server.baseUrl + "/api/favorites");
    assert.equal((await favoritesResponse.json()).tracks[0].id, "track_1");

    const historyResponse = await fetch(server.baseUrl + "/api/history", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId: "track_1", positionSeconds: 63 })
    });
    assert.equal(historyResponse.status, 201);
    assert.equal((await (await fetch(server.baseUrl + "/api/history")).json()).history[0].trackId, "track_1");

    const exportResponse = await fetch(server.baseUrl + "/api/playlists/" + playlistId + "/export.m3u");
    assert.equal(exportResponse.status, 200);
    const content = await exportResponse.text();
    assert.ok(content.includes("Example Artist/Example Album/song.mp3"));
    assert.match(content, /Example Artist\\/Example Album\\/song\\.mp3/);

    const importResponse = await fetch(server.baseUrl + "/api/playlists/import.m3u", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Imported", content })
    });
    assert.equal(importResponse.status, 201);
    assert.equal((await importResponse.json()).importedTracks, 1);
  } finally {
    await server.close();
    closeDatabase(db);
  }
});
