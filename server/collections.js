import crypto from "node:crypto";
import path from "node:path";
import { getTracks, getTrackRow } from "./library.js";

const LEGACY_USER_ID = "legacy";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function currentUserId(req) {
  return String(req.authUser?.id || LEGACY_USER_ID);
}

function playlistSummary(db, userId) {
  return db.prepare("SELECT p.id, p.name, p.description, p.smart_type AS smartType, p.created_at AS createdAt, p.updated_at AS updatedAt, COUNT(pt.track_id) AS trackCount FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id WHERE p.user_id = ? GROUP BY p.id ORDER BY p.updated_at DESC, p.name COLLATE NOCASE").all(userId);
}

function playlistRow(db, userId, id) {
  return db.prepare("SELECT id, user_id AS userId, name, description, smart_type AS smartType, created_at AS createdAt, updated_at AS updatedAt FROM playlists WHERE id = ? AND user_id = ?").get(id, userId) || null;
}

function playlistTracks(db, playlistId) {
  return db.prepare("SELECT t.id, t.title, t.artist, t.album, t.album_artist AS albumArtist, t.year, t.genre, t.track_number AS trackNumber, t.disc_number AS discNumber, t.duration, t.bitrate, t.sample_rate AS sampleRate, t.codec, t.size_bytes AS bytes, t.sha256, t.added_at AS addedAt FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ? ORDER BY pt.position").all(playlistId).map((track) => ({
    ...track,
    streamUrl: "/api/stream/" + track.id,
    artworkUrl: "/api/artwork/" + track.id
  }));
}

function renumberPlaylist(db, playlistId) {
  const ids = db.prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position").all(playlistId);
  const update = db.prepare("UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?");
  ids.forEach((row, index) => update.run(index, playlistId, row.track_id));
}

function escapeM3uText(value) {
  return String(value || "").replace(/[\r\n]/g, " ").slice(0, 500);
}

function smartPlaylist(db, userId, kind) {
  let name;
  let rows;
  if (kind === "recently-added") {
    name = "Recently added";
    rows = db.prepare("SELECT * FROM tracks ORDER BY added_at DESC, title COLLATE NOCASE LIMIT 100").all();
  } else if (kind === "frequently-played") {
    name = "Frequently played";
    rows = db.prepare("SELECT t.* FROM tracks t JOIN (SELECT track_id, COUNT(*) AS plays FROM play_history WHERE user_id = ? GROUP BY track_id ORDER BY plays DESC, MAX(played_at) DESC LIMIT 100) h ON h.track_id = t.id ORDER BY h.plays DESC").all(userId);
  } else if (kind === "recently-played") {
    name = "Recently played";
    rows = db.prepare("SELECT t.* FROM tracks t JOIN (SELECT track_id, MAX(played_at) AS last_played FROM play_history WHERE user_id = ? GROUP BY track_id ORDER BY last_played DESC LIMIT 100) h ON h.track_id = t.id ORDER BY h.last_played DESC").all(userId);
  } else {
    return null;
  }
  return {
    id: "smart:" + kind,
    name,
    smartType: kind,
    tracks: rows.map((row) => ({
      id: row.id, title: row.title, artist: row.artist, album: row.album,
      albumArtist: row.album_artist, year: row.year, genre: row.genre,
      trackNumber: row.track_number, discNumber: row.disc_number,
      duration: row.duration, bitrate: row.bitrate, sampleRate: row.sample_rate,
      codec: row.codec, bytes: row.size_bytes, sha256: row.sha256,
      streamUrl: "/api/stream/" + row.id, artworkUrl: "/api/artwork/" + row.id,
      addedAt: row.added_at
    }))
  };
}

export function mountCollectionRoutes(app, { db, requireAuth, findTracks }) {
  app.get("/api/playlists/smart/:kind", requireAuth, async (req, res, next) => {
    try {
      await findTracks();
      const result = smartPlaylist(db, currentUserId(req), String(req.params.kind || ""));
      if (!result) return res.status(404).json({ error: "smart_playlist_not_found", message: "Supported smart playlists: recently-added, frequently-played, recently-played." });
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (error) { next(error); }
  });

  app.get("/api/playlists", requireAuth, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ playlists: playlistSummary(db, currentUserId(_req)) });
  });

  app.post("/api/playlists", requireAuth, (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    if (name.length < 1 || name.length > 100) return res.status(400).json({ error: "invalid_playlist_name", message: "Playlist name must contain 1–100 characters." });
    if (description.length > 500) return res.status(400).json({ error: "invalid_playlist_description" });
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO playlists(id, user_id, name, description) VALUES (?, ?, ?, ?)").run(id, currentUserId(req), name, description);
    console.info("[SelfMusic] playlist created", JSON.stringify({ id, userId: currentUserId(req) }));
    res.status(201).json({ playlist: { id, name, description, trackCount: 0 } });
  });

  app.get("/api/playlists/:id/export.m3u", requireAuth, (req, res) => {
    const userId = currentUserId(req);
    const playlist = playlistRow(db, userId, req.params.id);
    if (!playlist) return res.status(404).json({ error: "playlist_not_found" });
    const rows = db.prepare("SELECT t.relative_path, t.duration, t.artist, t.title FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ? ORDER BY pt.position").all(playlist.id);
    const lines = ["#EXTM3U"];
    for (const track of rows) {
      const duration = Number.isFinite(Number(track.duration)) ? Math.max(0, Math.floor(Number(track.duration))) : -1;
      lines.push("#EXTINF:" + duration + "," + escapeM3uText(track.artist) + " - " + escapeM3uText(track.title));
      lines.push(String(track.relative_path).split(path.sep).join("/"));
    }
    const safeName = playlist.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "playlist";
    res.setHeader("Content-Type", "audio/x-mpegurl; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="' + safeName + '.m3u"');
    res.setHeader("Cache-Control", "no-store");
    res.send(lines.join("\n") + "\n");
  });

  app.get("/api/playlists/:id", requireAuth, (req, res) => {
    const playlist = playlistRow(db, currentUserId(req), req.params.id);
    if (!playlist) return res.status(404).json({ error: "playlist_not_found" });
    res.setHeader("Cache-Control", "no-store");
    res.json({ playlist: { ...playlist, tracks: playlistTracks(db, playlist.id) } });
  });

  app.patch("/api/playlists/:id", requireAuth, (req, res) => {
    const userId = currentUserId(req);
    const playlist = playlistRow(db, userId, req.params.id);
    if (!playlist) return res.status(404).json({ error: "playlist_not_found" });
    const name = req.body?.name === undefined ? playlist.name : String(req.body.name).trim();
    const description = req.body?.description === undefined ? playlist.description : String(req.body.description).trim();
    if (name.length < 1 || name.length > 100 || description.length > 500) return res.status(400).json({ error: "invalid_playlist" });
    db.prepare("UPDATE playlists SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").run(name, description, playlist.id, userId);
    res.json({ playlist: { ...playlist, name, description } });
  });

  app.delete("/api/playlists/:id", requireAuth, (req, res) => {
    const result = db.prepare("DELETE FROM playlists WHERE id = ? AND user_id = ?").run(req.params.id, currentUserId(req));
    if (!result.changes) return res.status(404).json({ error: "playlist_not_found" });
    res.status(204).end();
  });

  app.post("/api/playlists/:id/tracks", requireAuth, async (req, res, next) => {
    try {
      const userId = currentUserId(req);
      const playlist = playlistRow(db, userId, req.params.id);
      if (!playlist) return res.status(404).json({ error: "playlist_not_found" });
      const ids = Array.isArray(req.body?.trackIds) ? req.body.trackIds : [req.body?.trackId];
      if (!ids.length || ids.length > 500 || ids.some((id) => typeof id !== "string" || !ID_PATTERN.test(id))) {
        return res.status(400).json({ error: "invalid_track_ids", message: "Provide 1–500 valid track IDs." });
      }
      await findTracks();
      const getPosition = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM playlist_tracks WHERE playlist_id = ?");
      const insert = db.prepare("INSERT OR IGNORE INTO playlist_tracks(playlist_id, track_id, position) VALUES (?, ?, ?)");
      let position = Number(getPosition.get(playlist.id).position);
      let added = 0;
      for (const id of ids) {
        if (!getTrackRow(db, id)) continue;
        const result = insert.run(playlist.id, id, position);
        if (result.changes) { position += 1; added += 1; }
      }
      db.prepare("UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(playlist.id);
      res.status(201).json({ added, playlist: { ...playlist, tracks: playlistTracks(db, playlist.id) } });
    } catch (error) { next(error); }
  });

  app.delete("/api/playlists/:id/tracks/:trackId", requireAuth, (req, res) => {
    const playlist = playlistRow(db, currentUserId(req), req.params.id);
    if (!playlist) return res.status(404).json({ error: "playlist_not_found" });
    const result = db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?").run(playlist.id, req.params.trackId);
    if (!result.changes) return res.status(404).json({ error: "playlist_track_not_found" });
    renumberPlaylist(db, playlist.id);
    db.prepare("UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(playlist.id);
    res.json({ removed: true });
  });

  app.patch("/api/playlists/:id/tracks/order", requireAuth, (req, res) => {
    const playlist = playlistRow(db, currentUserId(req), req.params.id);
    if (!playlist) return res.status(404).json({ error: "playlist_not_found" });
    const ids = req.body?.trackIds;
    if (!Array.isArray(ids) || ids.length > 500 || ids.some((id) => typeof id !== "string" || !ID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: "invalid_track_order" });
    }
    const currentIds = db.prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?").all(playlist.id).map((row) => row.track_id);
    if (ids.length !== currentIds.length || ids.some((id) => !currentIds.includes(id))) {
      return res.status(400).json({ error: "track_order_mismatch", message: "The order must include every playlist track exactly once." });
    }
    const update = db.prepare("UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?");
    db.exec("BEGIN IMMEDIATE;");
    try {
      ids.forEach((id, position) => update.run(position, playlist.id, id));
      db.prepare("UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(playlist.id);
      db.exec("COMMIT;");
    } catch (error) { db.exec("ROLLBACK;"); throw error; }
    res.json({ updated: true, tracks: playlistTracks(db, playlist.id) });
  });

  app.post("/api/playlists/import.m3u", requireAuth, async (req, res, next) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "Imported playlist";
      const content = typeof req.body?.content === "string" ? req.body.content : "";
      if (name.length < 1 || name.length > 100 || !content || content.length > 1024 * 1024) {
        return res.status(400).json({ error: "invalid_m3u", message: "Provide a playlist name and an M3U file no larger than 1 MB." });
      }
      await findTracks();
      const byPath = new Map(db.prepare("SELECT id, relative_path FROM tracks").all().map((row) => [row.relative_path.split(path.sep).join("/"), row.id]));
      const byBasename = new Map();
      for (const row of db.prepare("SELECT id, relative_path FROM tracks").all()) {
        const base = path.posix.basename(row.relative_path.split(path.sep).join("/")).toLowerCase();
        if (!byBasename.has(base)) byBasename.set(base, []);
        byBasename.get(base).push(row.id);
      }
      const found = [];
      for (const line of content.split(/\r?\n/)) {
        const entry = line.trim();
        if (!entry || entry.startsWith("#")) continue;
        const normalized = entry.replace(/\\/g, "/").replace(/^\.\/+/, "");
        let id = byPath.get(normalized);
        if (!id && !normalized.includes("..")) {
          const matches = byBasename.get(path.posix.basename(normalized).toLowerCase()) || [];
          if (matches.length === 1) id = matches[0];
        }
        if (id && !found.includes(id)) found.push(id);
        if (found.length >= 5000) break;
      }
      const userId = currentUserId(req);
      const id = crypto.randomUUID();
      db.exec("BEGIN IMMEDIATE;");
      try {
        db.prepare("INSERT INTO playlists(id, user_id, name, description) VALUES (?, ?, ?, ?)").run(id, userId, name, "Imported from M3U");
        const insert = db.prepare("INSERT INTO playlist_tracks(playlist_id, track_id, position) VALUES (?, ?, ?)");
        found.forEach((trackId, position) => insert.run(id, trackId, position));
        db.exec("COMMIT;");
      } catch (error) { db.exec("ROLLBACK;"); throw error; }
      res.status(201).json({ playlist: { id, name, trackCount: found.length }, importedTracks: found.length });
    } catch (error) { next(error); }
  });

  app.get("/api/favorites", requireAuth, async (req, res, next) => {
    try {
      await findTracks();
      const rows = db.prepare("SELECT t.* FROM favorites f JOIN tracks t ON t.id = f.track_id WHERE f.user_id = ? ORDER BY f.created_at DESC").all(currentUserId(req));
      res.setHeader("Cache-Control", "no-store");
      res.json({ tracks: getTracks(db, rows) });
    } catch (error) { next(error); }
  });

  app.post("/api/favorites/:trackId", requireAuth, async (req, res, next) => {
    try {
      await findTracks();
      if (!getTrackRow(db, req.params.trackId)) return res.status(404).json({ error: "track_not_found" });
      db.prepare("INSERT OR IGNORE INTO favorites(user_id, track_id) VALUES (?, ?)").run(currentUserId(req), req.params.trackId);
      res.status(201).json({ favorite: true, trackId: req.params.trackId });
    } catch (error) { next(error); }
  });

  app.delete("/api/favorites/:trackId", requireAuth, (req, res) => {
    db.prepare("DELETE FROM favorites WHERE user_id = ? AND track_id = ?").run(currentUserId(req), req.params.trackId);
    res.status(204).end();
  });

  app.post("/api/history", requireAuth, async (req, res, next) => {
    try {
      await findTracks();
      const trackId = typeof req.body?.trackId === "string" ? req.body.trackId : "";
      const position = Number(req.body?.positionSeconds || 0);
      if (!getTrackRow(db, trackId)) return res.status(404).json({ error: "track_not_found" });
      if (!Number.isFinite(position) || position < 0 || position > 86400) return res.status(400).json({ error: "invalid_position" });
      db.prepare("INSERT INTO play_history(user_id, track_id, position_seconds) VALUES (?, ?, ?)").run(currentUserId(req), trackId, position);
      res.status(201).json({ recorded: true });
    } catch (error) { next(error); }
  });

  app.get("/api/history", requireAuth, async (req, res, next) => {
    try {
      await findTracks();
      const limitValue = Number.parseInt(String(req.query.limit || "50"), 10);
      const limit = Number.isInteger(limitValue) ? Math.max(1, Math.min(200, limitValue)) : 50;
      const rows = db.prepare("SELECT h.id, h.played_at AS playedAt, h.position_seconds AS positionSeconds, t.id AS trackId, t.title, t.artist, t.album, t.duration, t.year, t.genre FROM play_history h JOIN tracks t ON t.id = h.track_id WHERE h.user_id = ? ORDER BY h.played_at DESC LIMIT ?").all(currentUserId(req), limit);
      res.setHeader("Cache-Control", "no-store");
      res.json({ history: rows });
    } catch (error) { next(error); }
  });
}
