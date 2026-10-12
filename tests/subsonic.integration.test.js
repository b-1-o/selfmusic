import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { closeDatabase, createDatabase } from "../server/database.js";
import { mountSubsonicRoutes } from "../server/subsonic.js";

async function listen(app) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function seed(db) {
  db.prepare("INSERT INTO artists(id, name) VALUES (?, ?)").run("artist_123", "Example Artist");
  db.prepare("INSERT INTO albums(id, artist_id, title) VALUES (?, ?, ?)").run("album_123", "artist_123", "Example Album");
  db.prepare("INSERT INTO tracks(id, relative_path, title, artist_id, album_id, artist, album, duration, bitrate, size_bytes, codec) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "track_123", "Example Artist/Example Album/Song.mp3", "Example Song", "artist_123", "album_123", "Example Artist", "Example Album", 121.5, 192000, 123456, "mp3"
  );
}

test("Subsonic token/salt authentication supports ping and song lookup", async () => {
  const oldPassword = process.env.SELF_MUSIC_PASSWORD;
  process.env.SELF_MUSIC_PASSWORD = "subsonic-test-password";
  const db = createDatabase(":memory:");
  seed(db);
  const app = express();
  mountSubsonicRoutes(app, {
    db,
    musicRoot: "/tmp/selfmusic-test-music",
    requireFindTracks: async () => [],
    resolveTrackFile: async () => null
  });
  const server = await listen(app);
  try {
    const salt = "test-salt-123";
    const token = (await import("node:crypto")).default.createHash("md5").update(process.env.SELF_MUSIC_PASSWORD + salt).digest("hex");
    const query = new URLSearchParams({ u: "owner", t: token, s: salt, v: "1.16.1", c: "test", f: "json" });
    const pingResponse = await fetch(server.baseUrl + "/rest/ping.view?" + query.toString());
    assert.equal(pingResponse.status, 200);
    assert.equal((await pingResponse.json())["subsonic-response"].status, "ok");

    const songQuery = new URLSearchParams({ u: "owner", t: token, s: salt, id: "track_123", f: "json" });
    const songResponse = await fetch(server.baseUrl + "/rest/getSong.view?" + songQuery.toString());
    const payload = (await songResponse.json())["subsonic-response"];
    assert.equal(payload.status, "ok");
    assert.equal(payload.song.title, "Example Song");
    assert.equal(payload.song.artist, "Example Artist");
    assert.equal(payload.song.duration, 122);
  } finally {
    await server.close();
    closeDatabase(db);
    if (oldPassword === undefined) delete process.env.SELF_MUSIC_PASSWORD;
    else process.env.SELF_MUSIC_PASSWORD = oldPassword;
  }
});

test("Subsonic rejects invalid credentials with protocol error response", async () => {
  const db = createDatabase(":memory:");
  const app = express();
  mountSubsonicRoutes(app, { db, musicRoot: "/tmp/music", requireFindTracks: async () => [], resolveTrackFile: async () => null });
  const server = await listen(app);
  try {
    const response = await fetch(server.baseUrl + "/rest/ping.view?u=owner&t=deadbeef&s=salt&f=json");
    const payload = await response.json();
    assert.equal(payload["subsonic-response"].status, "failed");
    assert.equal(payload["subsonic-response"].error.code, 40);
  } finally {
    await server.close();
    closeDatabase(db);
  }
});
