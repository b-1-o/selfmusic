import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, createDatabase, latestMigrationVersion } from "../server/database.js";

test("creates all versioned schema migrations and is safe to initialize twice", () => {
  const db = createDatabase(":memory:");
  try {
    assert.equal(latestMigrationVersion(db), 8);
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    for (const table of ["artists", "albums", "tracks", "users", "playlists", "playlist_tracks", "favorites", "play_history", "lastfm_accounts", "scrobble_queue", "youtube_jobs", "transcode_cache", "lastfm_pending_auth", "playback_states"]) {
      assert.ok(tables.has(table), "expected schema table " + table);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 8);
    assert.ok(db.prepare("PRAGMA table_info(users)").all().some((row) => row.name === "subsonic_secret"));
    assert.ok(db.prepare("PRAGMA table_info(youtube_jobs)").all().some((row) => row.name === "metadata_json"));
    assert.ok(db.prepare("PRAGMA table_info(youtube_jobs)").all().some((row) => row.name === "phase"));
  } finally {
    closeDatabase(db);
  }
});

test("rejects invalid role values using the database constraint", () => {
  const db = createDatabase(":memory:");
  try {
    assert.throws(() => db.prepare("INSERT INTO users(id, username, password_hash, role) VALUES (?, ?, ?, ?)").run("u1", "badrole", "hash", "owner"));
  } finally {
    closeDatabase(db);
  }
});

test("reopening a persisted database does not reapply migrations or lose existing data", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "selfmusic-migrations-"));
  const databasePath = path.join(directory, "selfmusic.sqlite");
  let db;
  try {
    db = createDatabase(databasePath);
    db.prepare("INSERT INTO users(id, username, password_hash, role) VALUES (?, ?, ?, ?)").run("persisted-user", "persisted", "hash", "user");
    db.prepare("INSERT INTO tracks(id, relative_path, title) VALUES (?, ?, ?)").run("persisted-track", "persisted.mp3", "Persisted Track");
    db.prepare("INSERT INTO playback_states(user_id, revision, queue_json, current_track_id, position_seconds, is_playing, repeat_mode, shuffle, source_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "persisted-user", 3, JSON.stringify(["persisted-track"]), "persisted-track", 73.25, 0, "off", 0, "test-device"
    );
    closeDatabase(db);
    db = createDatabase(databasePath);

    assert.equal(latestMigrationVersion(db), 8);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 8);
    assert.equal(db.prepare("SELECT username FROM users WHERE id = ?").get("persisted-user").username, "persisted");
    assert.equal(db.prepare("SELECT title FROM tracks WHERE id = ?").get("persisted-track").title, "Persisted Track");
    const state = db.prepare("SELECT revision, position_seconds AS positionSeconds FROM playback_states WHERE user_id = ?").get("persisted-user");
    assert.equal(state.revision, 3);
    assert.equal(state.positionSeconds, 73.25);
  } finally {
    closeDatabase(db);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
