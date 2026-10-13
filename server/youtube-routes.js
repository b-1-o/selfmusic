/**
 * HTTP routes for YouTube search / status / cookies.
 * Keeps server/index.js thinner; logic lives in youtube-search.js.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  searchYouTube,
  getApiState,
  checkYtDlpAvailable,
  purgeExpiredSearchCache,
  isApiEnabled,
} from "./youtube-search.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cookiesPath = path.join(projectRoot, "cookies.txt");

function youtubeSearchRateLimit(req, res, next) {
  const windowMs = 60_000;
  const max = 30;
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const key = "yt-search:" + ip;
  const now = Date.now();
  if (!globalThis.__ytSearchBuckets) globalThis.__ytSearchBuckets = new Map();
  const buckets = globalThis.__ytSearchBuckets;
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) bucket = { startedAt: now, count: 0 };
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > max) {
    res.setHeader("Retry-After", String(Math.ceil((windowMs - (now - bucket.startedAt)) / 1000)));
    return res.status(429).json({
      error: "rate_limited",
      message: "Too many YouTube search requests. Try again shortly.",
    });
  }
  next();
}

async function cookiesPresent() {
  try {
    const st = await fs.stat(cookiesPath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

export function mountYoutubeSearchRoutes(app, { db, requireAuth, requireAdmin }) {
  const adminGate = typeof requireAdmin === "function" ? requireAdmin : requireAuth;

  async function handleYoutubeSearch(req, res, next) {
    try {
      const body = req.method === "POST" ? req.body || {} : {};
      const query =
        typeof body.query === "string"
          ? body.query.trim()
          : typeof req.query.q === "string"
            ? req.query.q.trim()
            : "";
      const limitRaw = body.limit ?? req.query.limit;
      const limit = limitRaw != null ? Number(limitRaw) : 20;
      const musicOnly = body.musicOnly !== false && req.query.musicOnly !== "false";

      if (query.length < 2 || query.length > 200) {
        return res.status(400).json({
          error: "invalid_query",
          message: "Enter a search with 2–200 characters.",
        });
      }
      if (!Number.isFinite(limit) || limit < 1 || limit > 50) {
        return res.status(400).json({
          error: "invalid_limit",
          message: "limit must be between 1 and 50.",
        });
      }

      const result = await searchYouTube(query, {
        limit: Math.floor(limit),
        musicOnly,
        db,
      });

      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        source: result.source,
        cached: Boolean(result.cached),
        items: result.items,
      });
    } catch (error) {
      if (error.code === "INVALID_QUERY") {
        return res.status(400).json({ error: "invalid_query", message: error.message });
      }
      if (error.code === "API_ERROR") {
        return res.status(error.status || 400).json({
          error: "youtube_api_error",
          message: error.message,
        });
      }
      if (error.code === "NO_KEY") {
        return res.status(503).json({
          error: "youtube_not_configured",
          message: "Set YOUTUBE_API_KEY in .env or use yt-dlp fallback.",
        });
      }
      if (
        error.name === "TimeoutError" ||
        error.name === "AbortError" ||
        error.code === "YTDLP_TIMEOUT"
      ) {
        return res.status(504).json({
          error: "youtube_timeout",
          message: "YouTube search took too long. Try again.",
        });
      }
      if (error.code === "YTDLP_MISSING") {
        return res.status(503).json({
          error: "ytdlp_missing",
          message: "yt-dlp is not installed on the server.",
        });
      }
      next(error);
    }
  }

  app.post("/api/youtube/search", requireAuth, youtubeSearchRateLimit, handleYoutubeSearch);

  // Deprecated: prefer POST /api/youtube/search
  app.get("/api/youtube/search", requireAuth, youtubeSearchRateLimit, (req, res, next) => {
    console.warn("[SelfMusic] GET /api/youtube/search is deprecated; use POST /api/youtube/search");
    return handleYoutubeSearch(req, res, next);
  });

  app.get("/api/youtube/status", requireAuth, async (req, res, next) => {
    try {
      const state = getApiState();
      const ytDlpAvailable = await checkYtDlpAvailable();
      const cookies = await cookiesPresent();
      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        apiEnabled: state.apiEnabled,
        apiValid: state.apiValid,
        quotaExceeded: state.quotaExceeded,
        source: state.source,
        ytDlpAvailable,
        cookiesConfigured: cookies,
      });
    } catch (error) {
      next(error);
    }
  });

  /** Admin: upload Netscape cookies.txt for age-restricted / sign-in videos (yt-dlp). */
  app.get("/api/youtube/cookies", requireAuth, adminGate, async (req, res, next) => {
    try {
      const configured = await cookiesPresent();
      let size = 0;
      if (configured) {
        size = (await fs.stat(cookiesPath)).size;
      }
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ configured, size, path: "cookies.txt" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/youtube/cookies", requireAuth, adminGate, async (req, res, next) => {
    try {
      let text = "";
      if (typeof req.body?.cookies === "string") {
        text = req.body.cookies;
      } else if (typeof req.body === "string") {
        text = req.body;
      } else if (Buffer.isBuffer(req.body)) {
        text = req.body.toString("utf8");
      }
      text = String(text || "").replace(/^\uFEFF/, "");
      if (!text.trim()) {
        return res.status(400).json({
          error: "empty_cookies",
          message: "Paste or upload a non-empty cookies.txt (Netscape format).",
        });
      }
      if (text.length > 2_000_000) {
        return res.status(400).json({
          error: "cookies_too_large",
          message: "Cookies file is too large (max ~2 MB).",
        });
      }
      // Basic Netscape / header check — reject obvious non-cookie payloads
      const looksLike =
        /# (Netscape|HTTP) Cookie File/i.test(text) ||
        /\tyoutube\.com\t/i.test(text) ||
        /\t\.youtube\.com\t/i.test(text) ||
        /youtube\.com.*\t/i.test(text);
      if (!looksLike) {
        return res.status(400).json({
          error: "invalid_cookies",
          message:
            "File does not look like a YouTube cookies.txt. Export with a browser extension (Netscape format) while signed into YouTube.",
        });
      }
      await fs.writeFile(cookiesPath, text, { encoding: "utf8", mode: 0o600 });
      res.json({ ok: true, configured: true, size: Buffer.byteLength(text, "utf8") });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/youtube/cookies", requireAuth, adminGate, async (req, res, next) => {
    try {
      await fs.unlink(cookiesPath).catch(() => {});
      res.json({ ok: true, configured: false });
    } catch (error) {
      next(error);
    }
  });
}

export { isApiEnabled, purgeExpiredSearchCache };
