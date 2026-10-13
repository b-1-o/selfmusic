import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const migrations = [
  {
    version: 1,
    name: "music_library",
    sql: `
      CREATE TABLE artists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE albums (
        id TEXT PRIMARY KEY,
        artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
        title TEXT NOT NULL COLLATE NOCASE,
        album_artist TEXT,
        year INTEGER,
        genre TEXT,
        artwork_path TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (artist_id, title)
      );
      CREATE TABLE tracks (
        id TEXT PRIMARY KEY,
        relative_path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        artist_id TEXT REFERENCES artists(id) ON DELETE SET NULL,
        album_id TEXT REFERENCES albums(id) ON DELETE SET NULL,
        artist TEXT NOT NULL DEFAULT 'Unknown artist',
        album TEXT NOT NULL DEFAULT 'Unknown album',
        album_artist TEXT,
        year INTEGER,
        genre TEXT,
        track_number INTEGER,
        disc_number INTEGER,
        duration REAL,
        bitrate INTEGER,
        sample_rate INTEGER,
        codec TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        mtime_ms INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT,
        cover_path TEXT,
        added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX tracks_title_idx ON tracks(title COLLATE NOCASE);
      CREATE INDEX tracks_artist_idx ON tracks(artist COLLATE NOCASE);
      CREATE INDEX tracks_album_idx ON tracks(album COLLATE NOCASE);
      CREATE INDEX tracks_year_idx ON tracks(year);
      CREATE INDEX tracks_genre_idx ON tracks(genre COLLATE NOCASE);
      CREATE INDEX tracks_sha256_idx ON tracks(sha256);
      CREATE INDEX albums_artist_idx ON albums(artist_id, title COLLATE NOCASE);
    `
  },
  {
    version: 2,
    name: "users_playlists_and_history",
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE playlists (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        smart_type TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX playlists_user_idx ON playlists(user_id, updated_at DESC);
      CREATE TABLE playlist_tracks (
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (playlist_id, track_id)
      );
      CREATE INDEX playlist_tracks_order_idx ON playlist_tracks(playlist_id, position);
      CREATE TABLE favorites (
        user_id TEXT NOT NULL,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, track_id)
      );
      CREATE TABLE play_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        played_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        position_seconds REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX play_history_user_idx ON play_history(user_id, played_at DESC);
      CREATE INDEX play_history_track_idx ON play_history(track_id, played_at DESC);
    `
  },
  {
    version: 3,
    name: "integrations_and_jobs",
    sql: `
      CREATE TABLE lastfm_accounts (
        user_id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL,
        username TEXT,
        connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE scrobble_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_error TEXT
      );
      CREATE INDEX scrobble_queue_ready_idx ON scrobble_queue(next_attempt_at, id);
      CREATE TABLE youtube_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        progress REAL NOT NULL DEFAULT 0,
        url TEXT NOT NULL,
        title TEXT,
        track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX youtube_jobs_user_idx ON youtube_jobs(user_id, created_at DESC);
      CREATE TABLE transcode_cache (
        cache_key TEXT PRIMARY KEY,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        format TEXT NOT NULL,
        bitrate TEXT NOT NULL,
        file_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (track_id, format, bitrate)
      );
    `
  },
  {
    version: 4,
    name: "encrypted_integration_credentials",
    sql: `
      ALTER TABLE users ADD COLUMN subsonic_secret TEXT;
    `
  },
  {
    version: 5,
    name: "lastfm_auth_state",
    sql: `
      CREATE TABLE lastfm_pending_auth (
        user_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX lastfm_pending_expiry_idx ON lastfm_pending_auth(expires_at);
    `
  },
  {
    version: 6,
    name: "durable_youtube_job_options",
    sql: `
      ALTER TABLE youtube_jobs ADD COLUMN bitrate TEXT NOT NULL DEFAULT '192k';
      ALTER TABLE youtube_jobs ADD COLUMN metadata_json TEXT;
      ALTER TABLE youtube_jobs ADD COLUMN result_json TEXT;
    `
  },
  {
    version: 7,
    name: "youtube_job_phases",
    sql: `
      ALTER TABLE youtube_jobs ADD COLUMN phase TEXT NOT NULL DEFAULT 'queued';
      UPDATE youtube_jobs SET phase = CASE
        WHEN status = 'completed' THEN 'completed'
        WHEN status = 'failed' THEN 'failed'
        WHEN status = 'cancelled' THEN 'cancelled'
        ELSE 'queued'
      END;
    `
  }
];

export function createDatabase(databasePath) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (databasePath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((row) => Number(row.version))
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations(version, name) VALUES (?, ?)").run(
        migration.version,
        migration.name
      );
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      db.close();
      throw error;
    }
  }

  return db;
}

export function latestMigrationVersion(db) {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get();
  return Number(row?.version || 0);
}

export function closeDatabase(db) {
  if (db && typeof db.close === "function") db.close();
}
