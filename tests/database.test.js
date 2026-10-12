import test from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, createDatabase, latestMigrationVersion } from "../server/database.js";

test("creates all versioned schema migrations and is safe to initialize twice", () => {
  const db = createDatabase(":memory:");
  try {
    assert.equal(latestMigrationVersion(db), 5);
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    for (const table of ["artists", "albums", "tracks", "users", "playlists", "playlist_tracks", "favorites", "play_history", "lastfm_accounts", "scrobble_queue", "youtube_jobs", "transcode_cache", "lastfm_pending_auth"]) {
      assert.ok(tables.has(table), "expected schema table " + table);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 5);
    assert.ok(db.prepare("PRAGMA table_info(users)").all().some((row) => row.name === "subsonic_secret"));
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
