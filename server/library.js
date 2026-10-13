import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File } from "./fingerprints.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const metadataScript = path.join(moduleDir, "metadata.py");
const extensions = new Set([".mp3", ".flac", ".ogg", ".m4a", ".opus", ".wav", ".aac", ".webm"]);
const maxTracks = 20000;
let activeScan = null;

function stableId(namespace, value) {
  return namespace + "_" + crypto.createHash("sha1").update(String(value).toLocaleLowerCase()).digest("hex").slice(0, 24);
}

function fallbackTags(filePath, musicRoot) {
  const relativePath = path.relative(musicRoot, filePath);
  const parent = path.dirname(relativePath);
  const folders = parent === "." ? [] : parent.split(path.sep).filter(Boolean);
  const stem = path.basename(filePath, path.extname(filePath));
  const title = stem.replace(/[_]+/g, " ").replace(/^\d{1,3}\s*[-_.]\s*/, "").trim();
  return {
    title: title || stem || path.basename(filePath),
    artist: folders.length ? folders[0] : "Unknown artist",
    album: folders.length > 1 ? folders.slice(1).join(" / ") : (folders[0] || "Local library"),
    albumArtist: null,
    year: null,
    genre: null,
    trackNumber: null,
    discNumber: null,
    duration: null,
    bitrate: null,
    sampleRate: null,
    codec: path.extname(filePath).slice(1).toLowerCase(),
    cover: null
  };
}

function readMetadata(filePath, musicRoot) {
  return new Promise((resolve) => {
    const command = process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
    const child = spawn(command, [metadataScript, filePath], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let output = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(fallbackTags(filePath, musicRoot));
    }, 12000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      if (output.length > 12 * 1024 * 1024) {
        child.kill("SIGKILL");
        finish(fallbackTags(filePath, musicRoot));
      }
    });
    child.on("error", () => finish(fallbackTags(filePath, musicRoot)));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(output);
        if (parsed.error) return finish(fallbackTags(filePath, musicRoot));
        return finish({ ...fallbackTags(filePath, musicRoot), ...parsed });
      } catch {
        return finish(fallbackTags(filePath, musicRoot));
      }
    });
  });
}

// Preserve the existing import API while routing exact hashes through the
// fingerprint provider interface. All current database/API fields remain sha256.
export async function hashFile(filePath) {
  return sha256File(filePath);
}

async function walkAudioFiles(root) {
  const files = [];
  async function walk(folder) {
    if (files.length >= maxTracks) return;
    let entries;
    try {
      entries = await fs.promises.readdir(folder, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    for (const entry of entries) {
      if (files.length >= maxTracks) break;
      if (!entry.name || entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files;
}

function safeRelativePath(root, filePath) {
  const relative = path.relative(root, filePath);
  if (!relative || relative === "." || path.isAbsolute(relative) || relative.split(path.sep).some((part) => part === "..")) {
    throw new Error("Refusing a track path outside the music library.");
  }
  return relative;
}

function saveCover(cacheDir, sha256, cover) {
  if (!cover?.base64 || !/^\.(jpg|png|webp)$/.test(String(cover.extension || ""))) return null;
  let bytes;
  try {
    bytes = Buffer.from(cover.base64, "base64");
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) return null;
  fs.mkdirSync(cacheDir, { recursive: true });
  const targetPath = path.join(cacheDir, sha256 + cover.extension);
  if (!fs.existsSync(targetPath)) {
    try {
      fs.writeFileSync(targetPath, bytes, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") return null;
    }
  }
  return targetPath;
}

export async function scanLibrary(db, musicRoot, options = {}) {
  if (activeScan) return activeScan;
  activeScan = doScan(db, musicRoot, options).finally(() => { activeScan = null; });
  return activeScan;
}

async function doScan(db, musicRoot, options) {
  await fs.promises.mkdir(musicRoot, { recursive: true });
  const rootRealPath = await fs.promises.realpath(musicRoot);
  const coverCacheDir = options.coverCacheDir || path.resolve(path.dirname(rootRealPath), "artwork");
  const files = await walkAudioFiles(rootRealPath);
  const findByPath = db.prepare("SELECT * FROM tracks WHERE relative_path = ?");
  const upsertArtist = db.prepare("INSERT INTO artists(id, name) VALUES (?, ?) ON CONFLICT(name) DO NOTHING");
  const findArtist = db.prepare("SELECT id FROM artists WHERE name = ?");
  const upsertAlbum = db.prepare("INSERT INTO albums(id, artist_id, title, album_artist, year, genre, artwork_path) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(artist_id, title) DO UPDATE SET album_artist = excluded.album_artist, year = excluded.year, genre = excluded.genre, artwork_path = COALESCE(excluded.artwork_path, albums.artwork_path)");
  const findAlbum = db.prepare("SELECT id FROM albums WHERE artist_id = ? AND title = ?");
  const upsertTrack = db.prepare(`
    INSERT INTO tracks(
      id, relative_path, title, artist_id, album_id, artist, album, album_artist,
      year, genre, track_number, disc_number, duration, bitrate, sample_rate,
      codec, size_bytes, mtime_ms, sha256, cover_path, last_seen_at
    ) VALUES (
      @id, @relative_path, @title, @artist_id, @album_id, @artist, @album, @album_artist,
      @year, @genre, @track_number, @disc_number, @duration, @bitrate, @sample_rate,
      @codec, @size_bytes, @mtime_ms, @sha256, @cover_path, CURRENT_TIMESTAMP
    )
    ON CONFLICT(relative_path) DO UPDATE SET
      title = excluded.title, artist_id = excluded.artist_id, album_id = excluded.album_id,
      artist = excluded.artist, album = excluded.album, album_artist = excluded.album_artist,
      year = excluded.year, genre = excluded.genre, track_number = excluded.track_number,
      disc_number = excluded.disc_number, duration = excluded.duration, bitrate = excluded.bitrate,
      sample_rate = excluded.sample_rate, codec = excluded.codec, size_bytes = excluded.size_bytes,
      mtime_ms = excluded.mtime_ms, sha256 = excluded.sha256,
      cover_path = COALESCE(excluded.cover_path, tracks.cover_path), last_seen_at = CURRENT_TIMESTAMP
  `);
  db.exec("CREATE TEMP TABLE IF NOT EXISTS scan_seen_paths (relative_path TEXT PRIMARY KEY); DELETE FROM scan_seen_paths;");
  const addSeen = db.prepare("INSERT OR IGNORE INTO scan_seen_paths(relative_path) VALUES (?)");

  for (const filePath of files) {
    const relativePath = safeRelativePath(rootRealPath, filePath);
    addSeen.run(relativePath);
    const stats = await fs.promises.stat(filePath);
    const existing = findByPath.get(relativePath);
    const unchanged = existing && Number(existing.size_bytes) === stats.size && Number(existing.mtime_ms) === Math.trunc(stats.mtimeMs);
    if (unchanged && !options.force) {
      db.prepare("UPDATE tracks SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.id);
      continue;
    }

    const sha256 = await hashFile(filePath);
    const tags = await readMetadata(filePath, rootRealPath);
    const fallback = fallbackTags(filePath, rootRealPath);
    const title = String(tags.title || fallback.title).slice(0, 500);
    const artist = String(tags.artist || tags.albumArtist || fallback.artist).slice(0, 300);
    const album = String(tags.album || fallback.album).slice(0, 300);
    const artistId = stableId("artist", artist);
    const albumId = stableId("album", artistId + "\0" + album);
    upsertArtist.run(artistId, artist);
    const actualArtistId = findArtist.get(artist)?.id || artistId;
    const coverPath = saveCover(coverCacheDir, sha256, tags.cover);
    upsertAlbum.run(albumId, actualArtistId, album, tags.albumArtist || artist, Number.isInteger(tags.year) ? tags.year : null, tags.genre || null, coverPath);
    const actualAlbumId = findAlbum.get(actualArtistId, album)?.id || albumId;
    const id = Buffer.from(relativePath).toString("base64url");

    upsertTrack.run({
      id,
      relative_path: relativePath,
      title,
      artist_id: actualArtistId,
      album_id: actualAlbumId,
      artist,
      album,
      album_artist: tags.albumArtist || artist,
      year: Number.isInteger(tags.year) ? tags.year : null,
      genre: tags.genre ? String(tags.genre).slice(0, 200) : null,
      track_number: Number.isInteger(tags.trackNumber) ? tags.trackNumber : null,
      disc_number: Number.isInteger(tags.discNumber) ? tags.discNumber : null,
      duration: Number.isFinite(Number(tags.duration)) && tags.duration !== null && Number(tags.duration) >= 0 ? Number(tags.duration) : null,
      bitrate: Number.isFinite(Number(tags.bitrate)) && Number(tags.bitrate) > 0 ? Number(tags.bitrate) : null,
      sample_rate: Number.isFinite(Number(tags.sampleRate)) && Number(tags.sampleRate) > 0 ? Number(tags.sampleRate) : null,
      codec: String(tags.codec || path.extname(filePath).slice(1)).toLowerCase(),
      size_bytes: stats.size,
      mtime_ms: Math.trunc(stats.mtimeMs),
      sha256,
      cover_path: coverPath
    });
  }

  db.exec(`
    DELETE FROM tracks WHERE relative_path NOT IN (SELECT relative_path FROM scan_seen_paths);
    DELETE FROM albums WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE tracks.album_id = albums.id);
    DELETE FROM artists WHERE NOT EXISTS (SELECT 1 FROM albums WHERE albums.artist_id = artists.id);
    DROP TABLE scan_seen_paths;
  `);
  return getTracks(db);
}

export function getTracks(db, query = {}) {
  const clauses = [];
  const params = [];
  if (query.artist) { clauses.push("artist = ? COLLATE NOCASE"); params.push(String(query.artist).slice(0, 300)); }
  if (query.album) { clauses.push("album = ? COLLATE NOCASE"); params.push(String(query.album).slice(0, 300)); }
  if (query.year) { clauses.push("year = ?"); params.push(Number(query.year)); }
  if (query.genre) { clauses.push("genre = ? COLLATE NOCASE"); params.push(String(query.genre).slice(0, 200)); }
  if (query.q) {
    clauses.push("(title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\' OR album LIKE ? ESCAPE '\\' OR genre LIKE ? ESCAPE '\\' OR album_artist LIKE ? ESCAPE '\\')");
    const term = "%" + String(query.q).slice(0, 100).replace(/[\\%_]/g, "\\$&") + "%";
    params.push(term, term, term, term, term);
  }
  const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
  const rows = db.prepare("SELECT * FROM tracks" + where + " ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_number IS NULL, track_number, title COLLATE NOCASE").all(...params);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    albumArtist: row.album_artist,
    year: row.year,
    genre: row.genre,
    trackNumber: row.track_number,
    discNumber: row.disc_number,
    duration: row.duration,
    bitrate: row.bitrate,
    sampleRate: row.sample_rate,
    codec: row.codec,
    bytes: row.size_bytes,
    sha256: row.sha256,
    streamUrl: "/api/stream/" + row.id,
    artworkUrl: "/api/artwork/" + row.id,
    addedAt: row.added_at
  }));
}

export function getTrackRow(db, id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/.test(id)) return null;
  return db.prepare("SELECT * FROM tracks WHERE id = ?").get(id) || null;
}

export function listArtists(db) {
  return db.prepare("SELECT a.id, a.name, COUNT(t.id) AS trackCount, COUNT(DISTINCT t.album_id) AS albumCount FROM artists a LEFT JOIN tracks t ON t.artist_id = a.id GROUP BY a.id ORDER BY a.name COLLATE NOCASE").all();
}

export function listAlbums(db, artistId = null) {
  if (artistId) {
    return db.prepare("SELECT a.id, a.title, a.artist_id AS artistId, ar.name AS artist, a.album_artist AS albumArtist, a.year, a.genre, a.artwork_path AS artworkPath, COUNT(t.id) AS trackCount FROM albums a JOIN artists ar ON ar.id = a.artist_id LEFT JOIN tracks t ON t.album_id = a.id WHERE a.artist_id = ? GROUP BY a.id ORDER BY a.year DESC, a.title COLLATE NOCASE").all(artistId);
  }
  return db.prepare("SELECT a.id, a.title, a.artist_id AS artistId, ar.name AS artist, a.album_artist AS albumArtist, a.year, a.genre, a.artwork_path AS artworkPath, COUNT(t.id) AS trackCount FROM albums a JOIN artists ar ON ar.id = a.artist_id LEFT JOIN tracks t ON t.album_id = a.id GROUP BY a.id ORDER BY a.title COLLATE NOCASE").all();
}
