/**
 * YouTube search module for SelfMusic.
 * Uses YouTube Data API v3 when YOUTUBE_API_KEY is set; falls back to yt-dlp.
 * Results are cached (in-memory + SQLite) and enriched with alreadyInLibrary.
 */

import crypto from "node:crypto";
import { spawn } from "node:child_process";

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const META_CACHE_TTL_MS = 60 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 60 * 60 * 1000;
const API_TIMEOUT_MS = 5000;
const YTDLP_TIMEOUT_MS = 25000;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/** @type {Map<string, { expiresAt: number, payload: object }>} */
const memoryCache = new Map();

/** @type {{ exceededUntil: number, lastQuotaHeader: string | null, keyValid: boolean | null }} */
const apiState = {
  exceededUntil: 0,
  lastQuotaHeader: null,
  keyValid: null,
};

function maskApiKey(key) {
  if (!key || typeof key !== "string") return "(none)";
  const k = key.trim();
  if (k.length < 12) return "AIza****";
  return k.slice(0, 4) + "****" + k.slice(-3);
}

export function getYoutubeApiKey() {
  const raw = process.env.YOUTUBE_API_KEY;
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return key.length > 0 ? key : null;
}

export function isApiEnabled() {
  return Boolean(getYoutubeApiKey());
}

export function isQuotaExceeded() {
  return Date.now() < apiState.exceededUntil;
}

export function getApiState() {
  return {
    apiEnabled: isApiEnabled(),
    apiValid: apiState.keyValid,
    quotaExceeded: isQuotaExceeded(),
    source: isApiEnabled() && !isQuotaExceeded() ? "api" : "yt-dlp",
  };
}

function hashQuery(query, limit, regionCode, musicOnly) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ q: query, limit, regionCode, musicOnly }))
    .digest("hex")
    .slice(0, 32);
}

function pruneMemoryCache(now = Date.now()) {
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) memoryCache.delete(key);
  }
  while (memoryCache.size > 300) {
    memoryCache.delete(memoryCache.keys().next().value);
  }
}

export function parseIsoDuration(iso) {
  if (!iso || typeof iso !== "string") return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

export function extractVideoId(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (VIDEO_ID_RE.test(value)) return value;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const allowed = new Set([
      "youtu.be",
      "youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtube-nocookie.com",
    ]);
    if (!allowed.has(host)) return null;
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] || "";
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    const v = url.searchParams.get("v");
    if (v && VIDEO_ID_RE.test(v)) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      if (["shorts", "embed", "v", "live"].includes(parts[i]) && VIDEO_ID_RE.test(parts[i + 1])) {
        return parts[i + 1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function isAllowedYoutubeVideoUrl(value) {
  return extractVideoId(value) !== null;
}

function normalizeItem(raw) {
  const videoId = String(raw.videoId || raw.id || "");
  if (!VIDEO_ID_RE.test(videoId)) return null;
  const duration =
    typeof raw.duration === "number" && Number.isFinite(raw.duration)
      ? Math.max(0, Math.round(raw.duration))
      : parseIsoDuration(raw.durationIso || raw.contentDetails?.duration || "");
  return {
    videoId,
    title: String(raw.title || "Untitled").slice(0, 300),
    channel: String(raw.channel || raw.channelTitle || raw.uploader || "YouTube").slice(0, 200),
    channelId: String(raw.channelId || ""),
    duration,
    thumbnail: String(raw.thumbnail || ""),
    publishedAt: String(raw.publishedAt || raw.upload_date || ""),
    viewCount: typeof raw.viewCount === "number" ? raw.viewCount : undefined,
    url: "https://youtu.be/" + videoId,
    alreadyInLibrary: Boolean(raw.alreadyInLibrary),
  };
}

async function fetchJson(url, { timeoutMs = API_TIMEOUT_MS, retries = 0 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      const remaining = response.headers.get("x-ratelimit-remaining") || response.headers.get("x-goog-quota-remaining");
      if (remaining != null) apiState.lastQuotaHeader = String(remaining);
      const body = await response.json().catch(() => ({}));
      return { response, body, remaining };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastError;
}

async function searchViaApi(query, { limit, regionCode, relevanceLanguage, musicOnly }) {
  const key = getYoutubeApiKey();
  if (!key) throw Object.assign(new Error("API key not configured"), { code: "NO_KEY" });

  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("key", key);
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("maxResults", String(Math.min(MAX_LIMIT, Math.max(1, limit))));
  searchUrl.searchParams.set("safeSearch", "none");
  if (musicOnly) searchUrl.searchParams.set("videoCategoryId", "10");
  if (regionCode) searchUrl.searchParams.set("regionCode", regionCode);
  if (relevanceLanguage) searchUrl.searchParams.set("relevanceLanguage", relevanceLanguage);

  const { response, body } = await fetchJson(searchUrl, { retries: 1 });

  if (!response.ok) {
    const reason = body?.error?.errors?.[0]?.reason || "";
    const message = body?.error?.message || `HTTP ${response.status}`;
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      apiState.exceededUntil = Date.now() + QUOTA_COOLDOWN_MS;
      const err = new Error("YouTube API quota exceeded");
      err.code = "QUOTA_EXCEEDED";
      throw err;
    }
    if (reason === "keyInvalid" || reason === "invalid" || (response.status === 400 && /API key/i.test(message))) {
      apiState.keyValid = false;
      const err = new Error("YouTube API key is invalid");
      err.code = "KEY_INVALID";
      throw err;
    }
    if (response.status >= 500) {
      const err = new Error("YouTube API temporary error");
      err.code = "API_TEMP";
      throw err;
    }
    const err = new Error(message);
    err.code = "API_ERROR";
    err.status = response.status;
    throw err;
  }

  apiState.keyValid = true;
  const searchItems = Array.isArray(body.items) ? body.items : [];
  const videoIds = searchItems
    .map((item) => item?.id?.videoId)
    .filter((id) => VIDEO_ID_RE.test(String(id || "")));

  if (!videoIds.length) {
    return { source: "api", items: [] };
  }

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("key", key);
  videosUrl.searchParams.set("part", "contentDetails,snippet,statistics");
  videosUrl.searchParams.set("id", videoIds.join(","));

  const { response: vRes, body: vBody } = await fetchJson(videosUrl, { retries: 1 });
  const detailsById = new Map();
  if (vRes.ok && Array.isArray(vBody.items)) {
    for (const item of vBody.items) {
      if (item?.id) detailsById.set(item.id, item);
    }
  }

  const items = [];
  for (const item of searchItems) {
    const videoId = item?.id?.videoId;
    if (!VIDEO_ID_RE.test(String(videoId || ""))) continue;
    const detail = detailsById.get(videoId) || {};
    const snippet = detail.snippet || item.snippet || {};
    const stats = detail.statistics || {};
    const content = detail.contentDetails || {};
    const thumb =
      snippet.thumbnails?.medium?.url ||
      snippet.thumbnails?.high?.url ||
      snippet.thumbnails?.default?.url ||
      item.snippet?.thumbnails?.medium?.url ||
      "";
    const normalized = normalizeItem({
      videoId,
      title: snippet.title || item.snippet?.title,
      channel: snippet.channelTitle || item.snippet?.channelTitle,
      channelId: snippet.channelId || item.snippet?.channelId || "",
      durationIso: content.duration,
      thumbnail: thumb,
      publishedAt: snippet.publishedAt || item.snippet?.publishedAt || "",
      viewCount: stats.viewCount ? Number(stats.viewCount) : undefined,
    });
    if (normalized) items.push(normalized);
  }

  return { source: "api", items };
}

function runYtDlpSearch(query, limit) {
  return new Promise((resolve, reject) => {
    const binary = process.env.YT_DLP_PATH || (process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    const searchTerm = `ytsearch${limit}:${query}`;
    const args = [
      searchTerm,
      "--dump-json",
      "--flat-playlist",
      "--no-warnings",
      "--no-playlist",
      "--skip-download",
    ];
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(Object.assign(new Error("yt-dlp search timed out"), { code: "YTDLP_TIMEOUT" }));
    }, YTDLP_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 8 * 1024 * 1024) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const code = error.code === "ENOENT" ? "YTDLP_MISSING" : "YTDLP_START_FAILED";
      reject(Object.assign(new Error(error.message), { code }));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        reject(Object.assign(new Error(stderr.slice(-500) || "yt-dlp search failed"), { code: "YTDLP_FAILED" }));
        return;
      }
      const items = [];
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const row = JSON.parse(trimmed);
          const videoId = row.id || row.url?.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1];
          if (!VIDEO_ID_RE.test(String(videoId || ""))) continue;
          const thumb =
            (Array.isArray(row.thumbnails) && row.thumbnails[0]?.url) ||
            row.thumbnail ||
            "";
          const normalized = normalizeItem({
            videoId,
            title: row.title,
            channel: row.channel || row.uploader || row.creator,
            channelId: row.channel_id || "",
            duration: Number(row.duration) || 0,
            thumbnail: thumb,
            publishedAt: row.upload_date
              ? `${row.upload_date.slice(0, 4)}-${row.upload_date.slice(4, 6)}-${row.upload_date.slice(6, 8)}`
              : "",
            viewCount: row.view_count != null ? Number(row.view_count) : undefined,
          });
          if (normalized) items.push(normalized);
        } catch {
          // skip malformed lines
        }
      }
      resolve({ source: "yt-dlp", items });
    });
  });
}

export function markAlreadyInLibrary(db, items) {
  if (!db || !items?.length) return items;
  const ids = items.map((i) => i.videoId).filter(Boolean);
  if (!ids.length) return items;

  let existing = new Set();
  try {
    const hasColumn = db
      .prepare("SELECT 1 AS ok FROM pragma_table_info('tracks') WHERE name = 'youtube_video_id'")
      .get();
    if (hasColumn) {
      const placeholders = ids.map(() => "?").join(",");
      const rows = db
        .prepare(`SELECT youtube_video_id AS id FROM tracks WHERE youtube_video_id IN (${placeholders})`)
        .all(...ids);
      existing = new Set(rows.map((r) => r.id));
    } else {
      const rows = db
        .prepare(
          `SELECT url FROM youtube_jobs WHERE status = 'completed' AND (
            ${ids.map(() => "url LIKE '%' || ? || '%'").join(" OR ")}
          )`
        )
        .all(...ids);
      for (const row of rows) {
        const vid = extractVideoId(row.url);
        if (vid) existing.add(vid);
      }
    }
  } catch (error) {
    console.warn("[SelfMusic] alreadyInLibrary lookup failed:", error.message);
  }

  return items.map((item) => ({
    ...item,
    alreadyInLibrary: existing.has(item.videoId),
  }));
}

function readSqliteCache(db, queryHash) {
  if (!db) return null;
  try {
    const row = db
      .prepare(
        "SELECT response_json, source, expires_at FROM youtube_search_cache WHERE query_hash = ? AND expires_at > ?"
      )
      .get(queryHash, Date.now());
    if (!row) return null;
    const payload = JSON.parse(row.response_json);
    return { source: row.source, items: payload.items || [], cached: true };
  } catch {
    return null;
  }
}

function writeSqliteCache(db, queryHash, query, source, items) {
  if (!db) return;
  try {
    const expiresAt = Date.now() + SEARCH_CACHE_TTL_MS;
    db.prepare(
      `INSERT INTO youtube_search_cache (query_hash, query, source, response_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(query_hash) DO UPDATE SET
         source = excluded.source,
         response_json = excluded.response_json,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at`
    ).run(queryHash, query, source, JSON.stringify({ items }), Date.now(), expiresAt);
  } catch (error) {
    console.warn("[SelfMusic] youtube_search_cache write failed:", error.message);
  }
}

export function purgeExpiredSearchCache(db) {
  if (!db) return;
  try {
    db.prepare("DELETE FROM youtube_search_cache WHERE expires_at <= ?").run(Date.now());
  } catch {
    // table may not exist yet
  }
  pruneMemoryCache();
}

export async function searchYouTube(query, options = {}) {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(options.limit) || DEFAULT_LIMIT));
  const regionCode = options.regionCode || "US";
  const relevanceLanguage = options.relevanceLanguage || undefined;
  const musicOnly = options.musicOnly !== false;
  const db = options.db || null;
  const forceSource = options.forceSource || "auto";

  const normalizedQuery = String(query || "").trim();
  if (normalizedQuery.length < 2 || normalizedQuery.length > 200) {
    const err = new Error("Query must be 2–200 characters.");
    err.code = "INVALID_QUERY";
    throw err;
  }

  const directId = extractVideoId(normalizedQuery);
  if (directId && /^https?:\/\//i.test(normalizedQuery)) {
    const single = await resolveSingleVideo(directId, db);
    return { source: single.source, cached: false, items: markAlreadyInLibrary(db, [single.item]) };
  }

  const queryHash = hashQuery(normalizedQuery.toLocaleLowerCase(), limit, regionCode, musicOnly);

  pruneMemoryCache();
  const mem = memoryCache.get(queryHash);
  if (mem && mem.expiresAt > Date.now()) {
    return {
      source: mem.payload.source,
      cached: true,
      items: markAlreadyInLibrary(db, mem.payload.items),
    };
  }

  const sqlCached = readSqliteCache(db, queryHash);
  if (sqlCached) {
    memoryCache.set(queryHash, {
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      payload: { source: sqlCached.source, items: sqlCached.items },
    });
    return {
      source: sqlCached.source,
      cached: true,
      items: markAlreadyInLibrary(db, sqlCached.items),
    };
  }

  const preferApi =
    forceSource === "api" ||
    (forceSource === "auto" && isApiEnabled() && !isQuotaExceeded());

  let result;
  if (preferApi) {
    try {
      result = await searchViaApi(normalizedQuery, {
        limit,
        regionCode,
        relevanceLanguage,
        musicOnly,
      });
    } catch (error) {
      if (error.code === "QUOTA_EXCEEDED" || error.code === "KEY_INVALID" || error.code === "API_TEMP") {
        console.warn(
          "[SelfMusic] YouTube API search failed, falling back to yt-dlp:",
          error.code,
          "(key " + maskApiKey(getYoutubeApiKey()) + ")"
        );
        result = await runYtDlpSearch(normalizedQuery, limit);
      } else if (error.code === "API_ERROR") {
        throw error;
      } else {
        console.warn("[SelfMusic] YouTube API error, falling back to yt-dlp:", error.message);
        result = await runYtDlpSearch(normalizedQuery, limit);
      }
    }
  } else {
    if (forceSource === "api" && !isApiEnabled()) {
      const err = new Error("YOUTUBE_API_KEY is not configured.");
      err.code = "NO_KEY";
      throw err;
    }
    result = await runYtDlpSearch(normalizedQuery, limit);
  }

  if (result.items.length || result.source === "yt-dlp") {
    memoryCache.set(queryHash, {
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      payload: { source: result.source, items: result.items },
    });
    writeSqliteCache(db, queryHash, normalizedQuery, result.source, result.items);
  }

  return {
    source: result.source,
    cached: false,
    items: markAlreadyInLibrary(db, result.items),
  };
}

async function resolveSingleVideo(videoId, db) {
  const key = getYoutubeApiKey();
  if (key && !isQuotaExceeded()) {
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.searchParams.set("key", key);
      url.searchParams.set("part", "contentDetails,snippet,statistics");
      url.searchParams.set("id", videoId);
      const { response, body } = await fetchJson(url);
      if (response.ok && Array.isArray(body.items) && body.items[0]) {
        const item = body.items[0];
        const snippet = item.snippet || {};
        const content = item.contentDetails || {};
        const stats = item.statistics || {};
        const normalized = normalizeItem({
          videoId,
          title: snippet.title,
          channel: snippet.channelTitle,
          channelId: snippet.channelId,
          durationIso: content.duration,
          thumbnail:
            snippet.thumbnails?.medium?.url ||
            snippet.thumbnails?.high?.url ||
            snippet.thumbnails?.default?.url ||
            "",
          publishedAt: snippet.publishedAt,
          viewCount: stats.viewCount ? Number(stats.viewCount) : undefined,
        });
        if (normalized) return { source: "api", item: normalized };
      }
    } catch {
      // fall through
    }
  }

  const result = await runYtDlpSearch(videoId, 1);
  const item = result.items[0] || normalizeItem({ videoId, title: videoId, channel: "YouTube" });
  return { source: "yt-dlp", item };
}

export async function checkYtDlpAvailable() {
  return new Promise((resolve) => {
    const binary = process.env.YT_DLP_PATH || (process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    const child = spawn(binary, ["--version"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 4000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

export async function validateApiKey() {
  const key = getYoutubeApiKey();
  if (!key) return { valid: false, reason: "missing" };
  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("key", key);
    url.searchParams.set("part", "id");
    url.searchParams.set("id", "dQw4w9WgXcQ");
    const { response, body } = await fetchJson(url, { timeoutMs: 8000 });
    if (response.ok) {
      apiState.keyValid = true;
      return { valid: true };
    }
    const reason = body?.error?.errors?.[0]?.reason || "";
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      apiState.exceededUntil = Date.now() + QUOTA_COOLDOWN_MS;
      apiState.keyValid = true;
      return { valid: true, reason: "quota_exceeded" };
    }
    if (reason === "keyInvalid") {
      apiState.keyValid = false;
      return { valid: false, reason: "invalid" };
    }
    apiState.keyValid = false;
    return { valid: false, reason: reason || "error" };
  } catch (error) {
    return { valid: false, reason: error.message || "network" };
  }
}

export { maskApiKey, VIDEO_ID_RE };
