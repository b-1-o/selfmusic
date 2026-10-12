import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import dotenv from "dotenv";
import multer from "multer";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(projectRoot, ".env") });

const app = express();
const port = Number.parseInt(process.env.PORT || "8787", 10);
const musicRoot = path.resolve(projectRoot, process.env.MUSIC_DIR || "music");
const configuredSessionSecret = process.env.SESSION_SECRET || "";
const hasPersistentSessionSecret = configuredSessionSecret.length >= 32 && !configuredSessionSecret.toLowerCase().includes("replace-with");
const sessionSecret = hasPersistentSessionSecret ? configuredSessionSecret : crypto.randomBytes(32).toString("hex");
const sessionCookie = "selfmusic_session";
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const supportedExtensions = new Set([".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus", ".webm"]);
const mimeTypes = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".webm": "audio/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif"
};
const artNames = ["cover.webp", "cover.jpg", "cover.jpeg", "cover.png", "folder.webp", "folder.jpg", "folder.jpeg", "folder.png"];
const loginAttempts = new Map();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "16kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

function isConfigured() {
  return typeof process.env.SELF_MUSIC_PASSWORD === "string" && process.env.SELF_MUSIC_PASSWORD.length >= 12 && !process.env.SELF_MUSIC_PASSWORD.toLowerCase().includes("replace-with");
}

function constantTimeTextCompare(left, right) {
  const a = crypto.createHash("sha256").update(String(left)).digest();
  const b = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

function createSessionToken() {
  const expiresAt = String(Math.floor(Date.now() / 1000) + sessionLifetimeSeconds);
  const signature = crypto.createHmac("sha256", sessionSecret).update(expiresAt).digest("base64url");
  return expiresAt + "." + signature;
}

function hasValidSession(req) {
  const cookies = String(req.headers.cookie || "").split(";").map((part) => part.trim());
  const entry = cookies.find((part) => part.startsWith(sessionCookie + "="));
  if (!entry) return false;

  const token = entry.slice(sessionCookie.length + 1);
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac("sha256", sessionSecret).update(expiresAt).digest("base64url");
  return constantTimeTextCompare(signature, expected);
}

function setSessionCookie(req, res, value, maxAge = sessionLifetimeSeconds) {
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=" + maxAge];
  if (secure || process.env.NODE_ENV === "production") flags.push("Secure");
  res.setHeader("Set-Cookie", sessionCookie + "=" + value + "; " + flags.join("; "));
}

function requireAuth(req, res, next) {
  if (!isConfigured()) {
    return res.status(503).json({ error: "server_not_configured", message: "Set SELF_MUSIC_PASSWORD in .env before using the library." });
  }
  if (!hasValidSession(req)) {
    return res.status(401).json({ error: "unauthorized", message: "Sign in to access your music library." });
  }
  next();
}

function safeTrackPath(id) {
  let relativePath;
  try {
    relativePath = Buffer.from(String(id), "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!relativePath || relativePath.includes("\0") || path.isAbsolute(relativePath)) return null;
  const absolutePath = path.resolve(musicRoot, relativePath);
  if (absolutePath !== musicRoot && !absolutePath.startsWith(musicRoot + path.sep)) return null;
  return absolutePath;
}

async function findTracks() {
  const tracks = [];
  async function walk(folder) {
    if (tracks.length >= 20000) return;
    let entries;
    try {
      entries = await fs.promises.readdir(folder, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    for (const entry of entries) {
      if (tracks.length >= 20000) break;
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const absolutePath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !supportedExtensions.has(path.extname(entry.name).toLowerCase())) continue;

      const relativePath = path.relative(musicRoot, absolutePath);
      const parent = path.dirname(relativePath);
      const title = path.basename(entry.name, path.extname(entry.name))
        .replace(/[_]+/g, " ")
        .replace(/^\d{1,3}\s*[-_.]\s*/, "")
        .trim();
      const artist = parent === "." ? "Unknown artist" : path.basename(parent);
      tracks.push({
        id: Buffer.from(relativePath).toString("base64url"),
        title: title || entry.name,
        artist,
        album: parent === "." ? "Local library" : parent.split(path.sep).join(" / "),
        streamUrl: "/api/stream/" + Buffer.from(relativePath).toString("base64url"),
        artworkUrl: "/api/artwork/" + Buffer.from(relativePath).toString("base64url")
      });
    }
  }

  await walk(musicRoot);
  return tracks;
}

async function resolveTrackFile(id) {
  const filePath = safeTrackPath(id);
  if (!filePath) return null;
  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile() || !supportedExtensions.has(path.extname(filePath).toLowerCase())) return null;
    return { filePath, stats };
  } catch {
    return null;
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "SelfMusic", configured: isConfigured(), version: "0.1.0" });
});

app.get("/api/auth/session", (req, res) => {
  res.json({ configured: isConfigured(), authenticated: isConfigured() && hasValidSession(req) });
});

app.post("/api/auth/login", (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({
      error: "server_not_configured",
      message: "Create .env from .env.example, set a password of at least 12 characters, then restart SelfMusic."
    });
  }

  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const attempt = loginAttempts.get(key);
  if (attempt && now - attempt.startedAt < 15 * 60 * 1000 && attempt.count >= 10) {
    return res.status(429).json({ error: "rate_limited", message: "Too many attempts. Wait 15 minutes and try again." });
  }

  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!constantTimeTextCompare(password, process.env.SELF_MUSIC_PASSWORD)) {
    if (!attempt || now - attempt.startedAt >= 15 * 60 * 1000) {
      loginAttempts.set(key, { startedAt: now, count: 1 });
    } else {
      attempt.count += 1;
    }
    return res.status(401).json({ error: "invalid_password", message: "That password did not match." });
  }

  loginAttempts.delete(key);
  setSessionCookie(req, res, createSessionToken());
  res.json({ authenticated: true });
});

app.post("/api/auth/logout", (_req, res) => {
  res.setHeader("Set-Cookie", sessionCookie + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.status(204).end();
});

const uploadRoot = path.join(musicRoot, "Uploads");
const maxUploadBytes = 250 * 1024 * 1024;
const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdir(uploadRoot, { recursive: true }, (error) => callback(error, uploadRoot));
    },
    filename: (_req, file, callback) => {
      const originalName = path.posix.basename(String(file.originalname || "track").replace(/\\/g, "/"));
      const extension = path.extname(originalName).toLowerCase();
      if (!supportedExtensions.has(extension)) {
        return callback(new Error("Unsupported audio format. Use MP3, M4A, AAC, FLAC, WAV, OGG, OPUS or WebM."));
      }

      let stem = path.basename(originalName, path.extname(originalName))
        .normalize("NFKC")
        .replace(/[\\u0000-\\u001f\\u007f<>:"/\\\\|?*]/g, "")
        .replace(/\\s+/g, " ")
        .trim()
        .slice(0, 140);
      if (!stem || stem === "." || stem === "..") stem = "Track";

      let candidate = stem + extension;
      let suffix = 2;
      while (fs.existsSync(path.join(uploadRoot, candidate))) {
        candidate = stem + " (" + suffix++ + ")" + extension;
      }
      callback(null, candidate);
    }
  }),
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(String(file.originalname || "")).toLowerCase();
    if (!supportedExtensions.has(extension)) {
      return callback(new Error("Unsupported audio format. Use MP3, M4A, AAC, FLAC, WAV, OGG, OPUS or WebM."));
    }
    callback(null, true);
  },
  limits: {
    fileSize: maxUploadBytes,
    files: 20,
    fields: 0,
    parts: 20,
    fieldNameSize: 100
  }
});

app.post("/api/upload", requireAuth, (req, res, next) => {
  audioUpload.array("files", 20)(req, res, async (error) => {
    if (error) {
      const receivedFiles = Array.isArray(req.files) ? req.files : [];
      await Promise.all(receivedFiles.map((file) => fs.promises.unlink(file.path).catch(() => {})));

      if (error instanceof multer.MulterError) {
        const tooLarge = error.code === "LIMIT_FILE_SIZE";
        const tooMany = error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE";
        return res.status(tooLarge ? 413 : 400).json({
          error: error.code.toLowerCase(),
          message: tooLarge
            ? "Each file must be 250 MB or smaller."
            : tooMany
              ? "Upload up to 20 audio files at a time."
              : "The upload could not be processed."
        });
      }
      return res.status(400).json({
        error: "invalid_upload",
        message: error.message || "The selected files could not be uploaded."
      });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return res.status(400).json({
        error: "no_files",
        message: "Choose at least one supported audio file first."
      });
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({
      uploaded: files.length,
      destination: "Uploads",
      files: files.map((file) => ({ name: file.filename, bytes: file.size }))
    });
  });
});

app.get("/api/tracks", requireAuth, async (_req, res, next) => {
  try {
    const tracks = await findTracks();
    res.setHeader("Cache-Control", "no-store");
    res.json({ tracks, truncated: tracks.length >= 20000 });
  } catch (error) {
    next(error);
  }
});

app.get("/api/youtube/search", requireAuth, async (req, res, next) => {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: "youtube_not_configured",
        message: "Set YOUTUBE_API_KEY in .env and restart SelfMusic to enable YouTube search."
      });
    }

    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (query.length < 2 || query.length > 100) {
      return res.status(400).json({
        error: "invalid_query",
        message: "Enter a search with 2–100 characters."
      });
    }

    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("videoSyndicated", "true");
    url.searchParams.set("safeSearch", "moderate");
    url.searchParams.set("maxResults", "18");
    url.searchParams.set("q", query);

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const payload = await response.json();

    if (!response.ok) {
      const reason = payload?.error?.errors?.[0]?.reason || "";
      if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
        return res.status(429).json({
          error: "youtube_quota_exceeded",
          message: "YouTube search quota has been used up for today. Try again later."
        });
      }
      console.warn("[SelfMusic] YouTube API request failed:", payload?.error?.message || response.status);
      return res.status(502).json({
        error: "youtube_api_error",
        message: "YouTube search is unavailable. Check the API key and YouTube Data API v3 settings."
      });
    }

    const items = (Array.isArray(payload.items) ? payload.items : [])
      .filter((item) => /^[A-Za-z0-9_-]{11}$/.test(String(item?.id?.videoId || "")))
      .map((item) => ({
        videoId: item.id.videoId,
        title: String(item.snippet?.title || "Untitled video"),
        channelTitle: String(item.snippet?.channelTitle || "YouTube"),
        description: String(item.snippet?.description || ""),
        thumbnail: String(item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "")
      }));

    res.setHeader("Cache-Control", "no-store");
    res.json({ items, totalResults: payload.pageInfo?.totalResults || items.length });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return res.status(504).json({ error: "youtube_timeout", message: "YouTube search took too long. Try again." });
    }
    next(error);
  }
});

app.get("/api/artwork/:id", requireAuth, async (req, res, next) => {
  try {
    const track = await resolveTrackFile(req.params.id);
    if (!track) return res.status(404).json({ error: "not_found" });
    const folder = path.dirname(track.filePath);
    for (const name of artNames) {
      const artPath = path.join(folder, name);
      try {
        const stats = await fs.promises.stat(artPath);
        if (stats.isFile()) {
          res.setHeader("Cache-Control", "private, max-age=3600");
          res.type(mimeTypes[path.extname(artPath).toLowerCase()] || "application/octet-stream");
          return fs.createReadStream(artPath).pipe(res);
        }
      } catch {
        // Try the next recognized cover filename.
      }
    }
    res.redirect(302, "/icon.svg");
  } catch (error) {
    next(error);
  }
});

app.get("/api/stream/:id", requireAuth, async (req, res, next) => {
  try {
    const track = await resolveTrackFile(req.params.id);
    if (!track) return res.status(404).json({ error: "track_not_found" });

    const size = track.stats.size;
    const type = mimeTypes[path.extname(track.filePath).toLowerCase()] || "application/octet-stream";
    res.setHeader("Content-Type", type);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, no-store");

    const rangeHeader = req.headers.range;
    if (!rangeHeader) {
      res.setHeader("Content-Length", size);
      return fs.createReadStream(track.filePath).pipe(res);
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match || (!match[1] && !match[2])) {
      res.setHeader("Content-Range", "bytes */" + size);
      return res.status(416).end();
    }

    let start;
    let end;
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      start = Math.max(0, size - suffixLength);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : size - 1;
    }

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) {
      res.setHeader("Content-Range", "bytes */" + size);
      return res.status(416).end();
    }

    end = Math.min(end, size - 1);
    res.status(206);
    res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + size);
    res.setHeader("Content-Length", end - start + 1);
    fs.createReadStream(track.filePath, { start, end }).pipe(res);
  } catch (error) {
    next(error);
  }
});

const distPath = path.join(projectRoot, "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, { index: false, maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  console.error("[SelfMusic]", error.message);
  if (res.headersSent) return;
  res.status(500).json({ error: "internal_error", message: "SelfMusic hit an unexpected error." });
});

fs.promises.mkdir(musicRoot, { recursive: true }).then(() => {
  app.listen(port, "0.0.0.0", () => {
    console.log("SelfMusic server listening on http://localhost:" + port);
    console.log("Music folder: " + musicRoot);
    if (!isConfigured()) console.warn("Setup required: create .env and set SELF_MUSIC_PASSWORD to a password of at least 12 characters.");
    if (process.env.NODE_ENV === "production" && !hasPersistentSessionSecret) {
      console.warn("Set a random SESSION_SECRET of at least 32 characters in production so sessions remain valid after restarts.");
    }
  });
}).catch((error) => {
  console.error("Could not prepare music directory:", error.message);
  process.exitCode = 1;
});
