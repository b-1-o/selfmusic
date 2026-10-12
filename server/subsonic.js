import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { decryptSecret, constantTimeEqualText } from "./secret.js";
import { getTracks, getTrackRow, listAlbums, listArtists } from "./library.js";

const VERSION = "1.16.1";

function envelope(res, body = {}, status = "ok") {
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    "subsonic-response": {
      status,
      version: VERSION,
      type: "SelfMusic",
      serverVersion: "0.1.0",
      openSubsonic: true,
      ...body
    }
  });
}

function fail(res, code, message, httpStatus = 200) {
  return res.status(httpStatus).json({
    "subsonic-response": {
      status: "failed",
      version: VERSION,
      type: "SelfMusic",
      serverVersion: "0.1.0",
      openSubsonic: true,
      error: { code, message }
    }
  });
}

function decodePassword(value) {
  if (typeof value !== "string") return "";
  if (!value.startsWith("enc:")) return value;
  try {
    return Buffer.from(value.slice(4), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function verifyScryptPassword(password, encoded) {
  const [algorithm, salt, expectedText] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || !salt || !expectedText) return false;
  try {
    const expected = Buffer.from(expectedText, "base64url");
    const actual = crypto.scryptSync(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function authUser(db, req) {
  const username = typeof req.query.u === "string" ? req.query.u.trim() : "";
  if (!username || username.length > 128) return null;
  const user = db.prepare("SELECT id, username, role, password_hash AS passwordHash, subsonic_secret AS subsonicSecret FROM users WHERE username = ? COLLATE NOCASE").get(username);
  const isLegacy = !user && ["owner", "admin"].includes(username.toLowerCase());

  if (!user && !isLegacy) return null;
  const plainPassword = decodePassword(req.query.p);
  let valid = false;
  if (typeof req.query.t === "string" && typeof req.query.s === "string" &&
      req.query.t.length === 32 && req.query.s.length >= 1 && req.query.s.length <= 128) {
    let storedPassword = "";
    try {
      storedPassword = user
        ? decryptSecret(user.subsonicSecret)
        : String(process.env.SELF_MUSIC_PASSWORD || "");
    } catch {
      storedPassword = "";
    }
    const expectedToken = crypto.createHash("md5").update(storedPassword + req.query.s, "utf8").digest("hex");
    valid = Boolean(storedPassword) && constantTimeEqualText(req.query.t.toLowerCase(), expectedToken);
  } else if (plainPassword) {
    if (user) valid = verifyScryptPassword(plainPassword, user.passwordHash);
    else valid = constantTimeEqualText(plainPassword, process.env.SELF_MUSIC_PASSWORD || "");
  }
  if (!valid) return null;

  return user
    ? { id: user.id, username: user.username, role: user.role }
    : { id: "legacy", username: "owner", role: "admin", legacy: true };
}

function trackToSong(track) {
  const duration = Number(track.duration);
  const bitrate = Number(track.bitrate);
  const suffix = String(track.codec || path.extname(track.relative_path || "").slice(1)).toLowerCase();
  return {
    id: track.id,
    parent: track.album_id || track.albumId || undefined,
    isDir: false,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.album_artist || track.albumArtist || track.artist,
    track: track.track_number ?? track.trackNumber ?? undefined,
    discNumber: track.disc_number ?? track.discNumber ?? undefined,
    year: track.year ?? undefined,
    genre: track.genre ?? undefined,
    duration: Number.isFinite(duration) && duration >= 0 ? Math.floor(duration) : undefined,
    bitRate: Number.isFinite(bitrate) && bitrate > 0 ? Math.round(bitrate / 1000) : undefined,
    size: Number(track.size_bytes ?? track.bytes) || undefined,
    suffix,
    contentType: suffix === "mp3" ? "audio/mpeg" : suffix === "flac" ? "audio/flac" : suffix === "opus" ? "audio/ogg" : "audio/" + suffix,
    path: track.relative_path || undefined,
    coverArt: track.album_id || track.albumId || track.id
  };
}

function dbPlaylist(db, userId, id) {
  return db.prepare("SELECT id, user_id AS userId, name, description, created_at AS createdAt, updated_at AS updatedAt FROM playlists WHERE id = ? AND user_id = ?").get(id, userId) || null;
}

function getPlaylistSongs(db, id) {
  return db.prepare("SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ? ORDER BY pt.position").all(id).map(trackToSong);
}

function streamAudio(req, res, filePath, name = path.basename(filePath)) {
  const stats = fs.statSync(filePath);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", "audio/" + path.extname(filePath).slice(1).toLowerCase());
  res.setHeader("Cache-Control", "private, no-store");
  if (req.path.endsWith("/download.view")) {
    res.setHeader("Content-Disposition", 'attachment; filename="' + String(name).replace(/["\\\r\n]/g, "_") + '"');
  }
  const range = req.headers.range;
  if (!range) {
    res.setHeader("Content-Length", stats.size);
    return fs.createReadStream(filePath).pipe(res);
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) {
    res.setHeader("Content-Range", "bytes */" + stats.size);
    return res.status(416).end();
  }
  let start = match[1] ? Number(match[1]) : Math.max(0, stats.size - Number(match[2]));
  let end = match[2] ? Number(match[2]) : stats.size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stats.size || start > end) {
    res.setHeader("Content-Range", "bytes */" + stats.size);
    return res.status(416).end();
  }
  end = Math.min(end, stats.size - 1);
  res.status(206);
  res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + stats.size);
  res.setHeader("Content-Length", end - start + 1);
  return fs.createReadStream(filePath, { start, end }).pipe(res);
}

function listSongIds(query) {
  let values = query.songId ?? [];
  if (!Array.isArray(values)) values = [values];
  return values.filter((value) => typeof value === "string" && value.length <= 2048);
}

function securePlaylistUpdate(db, playlistId, songIds) {
  const position = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM playlist_tracks WHERE playlist_id = ?");
  const insert = db.prepare("INSERT OR IGNORE INTO playlist_tracks(playlist_id, track_id, position) VALUES (?, ?, ?)");
  let next = Number(position.get(playlistId).position);
  for (const id of songIds) {
    const existing = getTrackRow(db, id);
    if (!existing) continue;
    if (insert.run(playlistId, id, next).changes) next += 1;
  }
}

export function mountSubsonicRoutes(app, { db, musicRoot, requireFindTracks, resolveTrackFile }) {
  app.get("/rest/:method.view", async (req, res, next) => {
    const method = String(req.params.method || "");
    if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(method)) return fail(res, 10, "Invalid API method.");

    const user = authUser(db, req);
    if (!user) return fail(res, 40, "Wrong username or password.");
    const userId = user.id;
    const requestedId = typeof req.query.id === "string" ? req.query.id : "";

    try {
      if (["ping", "getLicense"].includes(method)) {
        if (method === "ping") return envelope(res);
        return envelope(res, { license: { valid: true, email: "", licenseExpires: "2099-12-31T23:59:59" } });
      }

      if (method === "getMusicFolders") {
        return envelope(res, { musicFolders: { musicFolder: [{ id: "1", name: "Music" }] } });
      }

      if (["getIndexes", "getArtists", "getArtist", "getAlbum", "getSong", "search3", "getStarred2"].includes(method)) {
        await requireFindTracks();
      }

      if (method === "getArtists" || method === "getIndexes") {
        const artists = listArtists(db).map((artist) => {
          const albums = listAlbums(db, artist.id);
          return {
            id: artist.id,
            name: artist.name,
            albumCount: artist.albumCount,
            coverArt: albums[0]?.id || artist.id
          };
        });
        if (method === "getArtists") return envelope(res, { artists: { index: groupArtistIndexes(artists) } });
        return envelope(res, { indexes: { lastModified: Date.now(), ignoredArticles: "The El La Los Las Le Les", index: groupArtistIndexes(artists) } });
      }

      if (method === "getArtist") {
        const artist = listArtists(db).find((entry) => entry.id === requestedId);
        if (!artist) return fail(res, 70, "Artist not found.");
        const albums = listAlbums(db, artist.id).map((album) => ({
          id: album.id,
          name: album.title,
          artist: album.artist,
          artistId: album.artistId,
          year: album.year ?? undefined,
          genre: album.genre ?? undefined,
          songCount: album.trackCount,
          coverArt: album.id
        }));
        return envelope(res, { artist: { id: artist.id, name: artist.name, albumCount: albums.length, album: albums } });
      }

      if (method === "getAlbum") {
        const album = db.prepare("SELECT a.*, ar.name AS artist FROM albums a JOIN artists ar ON ar.id = a.artist_id WHERE a.id = ?").get(requestedId);
        if (!album) return fail(res, 70, "Album not found.");
        const children = db.prepare("SELECT * FROM tracks WHERE album_id = ? ORDER BY disc_number IS NULL, disc_number, track_number IS NULL, track_number, title COLLATE NOCASE").all(album.id).map(trackToSong);
        return envelope(res, { album: { id: album.id, name: album.title, artist: album.artist, artistId: album.artist_id, year: album.year ?? undefined, genre: album.genre ?? undefined, songCount: children.length, coverArt: album.id, song: children } });
      }

      if (method === "getSong") {
        const row = getTrackRow(db, requestedId);
        return row ? envelope(res, { song: trackToSong(row) }) : fail(res, 70, "Song not found.");
      }

      if (method === "search3") {
        const query = typeof req.query.query === "string" ? req.query.query.trim().slice(0, 100) : "";
        if (!query) return envelope(res, { searchResult3: {} });
        const songs = getTracks(db, { q: query }).slice(0, 500).map(trackToSong);
        const artists = listArtists(db).filter((artist) => artist.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 50).map((artist) => ({ id: artist.id, name: artist.name, albumCount: artist.albumCount }));
        const albums = listAlbums(db).filter((album) => album.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 50).map((album) => ({ id: album.id, name: album.title, artist: album.artist, artistId: album.artistId, year: album.year ?? undefined, songCount: album.trackCount }));
        return envelope(res, { searchResult3: { artist: artists, album: albums, song: songs } });
      }

      if (method === "getPlaylists") {
        const playlists = db.prepare("SELECT p.id, p.name, p.description, p.created_at AS createdAt, p.updated_at AS updatedAt, COUNT(pt.track_id) AS songCount FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id WHERE p.user_id = ? GROUP BY p.id ORDER BY p.name COLLATE NOCASE").all(userId);
        return envelope(res, { playlists: { playlist: playlists.map((playlist) => ({ ...playlist, owner: user.username, public: false, allowedUser: [], song: undefined })) } });
      }

      if (method === "getPlaylist") {
        const playlist = dbPlaylist(db, userId, requestedId);
        if (!playlist) return fail(res, 70, "Playlist not found.");
        const songs = getPlaylistSongs(db, playlist.id);
        return envelope(res, { playlist: { ...playlist, owner: user.username, public: false, songCount: songs.length, duration: songs.reduce((sum, song) => sum + (song.duration || 0), 0), entry: songs } });
      }

      if (method === "createPlaylist") {
        if (user.role !== "admin" && !user.id) return fail(res, 50, "Insufficient privileges.");
        const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
        if (!name || name.length > 100) return fail(res, 10, "Playlist name must contain 1–100 characters.");
        const id = crypto.randomUUID();
        db.prepare("INSERT INTO playlists(id, user_id, name, description) VALUES (?, ?, ?, '')").run(id, userId, name);
        securePlaylistUpdate(db, id, listSongIds(req.query));
        return envelope(res, { playlists: { playlist: [{ id, name, owner: user.username }] } });
      }

      if (method === "updatePlaylist") {
        const playlist = dbPlaylist(db, userId, requestedId);
        if (!playlist) return fail(res, 70, "Playlist not found.");
        const name = typeof req.query.name === "string" ? req.query.name.trim() : playlist.name;
        if (!name || name.length > 100) return fail(res, 10, "Playlist name must contain 1–100 characters.");
        db.prepare("UPDATE playlists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").run(name, playlist.id, userId);
        const indexes = req.query.songIndexToRemove;
        if (indexes !== undefined) {
          const removeIndexes = (Array.isArray(indexes) ? indexes : [indexes]).map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < 5000);
          const ids = db.prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position").all(playlist.id).map((row) => row.track_id);
          const removals = new Set(removeIndexes.map((index) => ids[index]).filter(Boolean));
          const remove = db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?");
          for (const id of removals) remove.run(playlist.id, id);
          const remaining = db.prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position").all(playlist.id);
          const update = db.prepare("UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?");
          remaining.forEach((row, index) => update.run(index, playlist.id, row.track_id));
        }
        securePlaylistUpdate(db, playlist.id, listSongIds(req.query));
        return envelope(res);
      }

      if (method === "deletePlaylist") {
        const result = db.prepare("DELETE FROM playlists WHERE id = ? AND user_id = ?").run(requestedId, userId);
        return result.changes ? envelope(res) : fail(res, 70, "Playlist not found.");
      }

      if (method === "star" || method === "unstar") {
        const ids = listSongIds({ songId: req.query.id });
        const trackId = ids[0];
        if (trackId && getTrackRow(db, trackId)) {
          if (method === "star") db.prepare("INSERT OR IGNORE INTO favorites(user_id, track_id) VALUES (?, ?)").run(userId, trackId);
          else db.prepare("DELETE FROM favorites WHERE user_id = ? AND track_id = ?").run(userId, trackId);
        } else if (requestedId) return fail(res, 70, "Song not found.");
        return envelope(res);
      }

      if (method === "getStarred2") {
        const rows = db.prepare("SELECT t.* FROM favorites f JOIN tracks t ON t.id = f.track_id WHERE f.user_id = ? ORDER BY f.created_at DESC").all(userId);
        return envelope(res, { starred2: { song: rows.map(trackToSong) } });
      }

      if (method === "scrobble") {
        const ids = listSongIds({ songId: req.query.id });
        const trackId = ids[0];
        if (!trackId || !getTrackRow(db, trackId)) return fail(res, 70, "Song not found.");
        const submission = !["false", "0", "no"].includes(String(req.query.submission || "true").toLowerCase());
        if (submission) {
          const timestamp = Number(req.query.time);
          db.prepare("INSERT INTO play_history(user_id, track_id, played_at, position_seconds) VALUES (?, ?, ?, 0)").run(
            userId, trackId,
            Number.isFinite(timestamp) && timestamp > 0
              ? new Date(timestamp < 100000000000 ? timestamp * 1000 : timestamp).toISOString().replace("T", " ").replace("Z", "")
              : new Date().toISOString().replace("T", " ").replace("Z", "")
          );
        }
        return envelope(res);
      }

      if (method === "stream" || method === "download") {
        const row = getTrackRow(db, requestedId);
        if (!row) return fail(res, 70, "Song not found.");
        const file = await resolveTrackFile(requestedId);
        if (!file) return fail(res, 70, "Song file not found.");
        return streamAudio(req, res, file.filePath, path.basename(file.filePath));
      }

      return fail(res, 40, "Unsupported Subsonic method: " + method + ".");
    } catch (error) {
      next(error);
    }
  });

  app.get("/rest", (req, res) => fail(res, 10, "Use /rest/{method}.view with a supported Subsonic method."));
}

function groupArtistIndexes(artists) {
  const groups = new Map();
  for (const artist of artists) {
    const initial = String(artist.name || "").trim().charAt(0).toLocaleUpperCase();
    const key = /^[A-Z0-9]$/.test(initial) ? initial : "#";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(artist);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, artist]) => ({ name, artist }));
}
