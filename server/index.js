import crypto from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { create as createYoutubeDl } from "youtube-dl-exec";
import { createDatabase } from "./database.js";
import { getTracks as readTracks, getTrackRow, hashFile, listAlbums, listArtists, scanLibrary } from "./library.js";
import { mountCollectionRoutes } from "./collections.js";
import { getTranscodedFile, originalSupportsFormat, parseTranscodeOptions, transcodingEnabled } from "./transcoder.js";
import { encryptSecret } from "./secret.js";
import { mountSubsonicRoutes } from "./subsonic.js";
import { flushQueue as flushLastFmQueue, mountLastFmRoutes } from "./lastfm.js";
import { createYoutubeJob, mountYoutubeJobRoutes } from "./youtube-jobs.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(projectRoot, ".env") });
const youtubedl = createYoutubeDl(process.env.YT_DLP_PATH || (process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"));

const app = express();
const port = Number.parseInt(process.env.PORT || "8787", 10);
const musicRoot = path.resolve(projectRoot, process.env.MUSIC_DIR || "music");
const databasePath = process.env.DATABASE_PATH === ":memory:"
  ? ":memory:"
  : path.resolve(projectRoot, process.env.DATABASE_PATH || "data/selfmusic.sqlite");
const coverCacheDir = path.resolve(projectRoot, process.env.COVER_CACHE_DIR || "data/artwork");
const transcodeCacheDir = path.resolve(projectRoot, process.env.TRANSCODE_CACHE_DIR || "data/transcodes");
const db = createDatabase(databasePath);
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
const youtubeSearchCache = new Map();

function configuredDuplicateStrategy() {
  const strategy = String(process.env.DUPLICATE_STRATEGY || "keep").toLowerCase();
  return ["skip", "keep", "ask"].includes(strategy) ? strategy : "keep";
}


const audioMimeToExtension = {
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/webm": ".webm"
};

function isYoutubeUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com"
    );
  } catch {
    return false;
  }
}

function ipv4ToBigInt(address) {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => (value << 8n) + BigInt(Number(part)), 0n);
}

function ipv6ToBigInt(address) {
  let input = address.toLowerCase().split("%")[0];
  if (input.includes(".")) return null;
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const parts = [...left, ...Array(missing).fill("0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.reduce((value, part) => (value << 16n) + BigInt("0x" + part), 0n);
}

function addressIsPublic(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const value = ipv4ToBigInt(address);
    if (value === null) return false;
    const blocked = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
      ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
      ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
      ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
    ];
    return !blocked.some(([network, bits]) => {
      const base = ipv4ToBigInt(network);
      return base !== null && (value >> BigInt(32 - bits)) === (base >> BigInt(32 - bits));
    });
  }

  if (family === 6) {
    const value = ipv6ToBigInt(address);
    if (value === null) return false;
    if ((value >> 125n) !== 1n) return false;
    const prefixMatches = (network, bits) => (value >> BigInt(128 - bits)) === (network >> BigInt(128 - bits));
    const blocked = [
      [(0x20010db8000000000000000000000000n), 32],
      [(0x20010000000000000000000000000000n), 23],
      [(0x20020000000000000000000000000000n), 16]
    ];
    return !blocked.some(([network, bits]) => prefixMatches(network, bits));
  }
  return false;
}

function validateImportUrl(value) {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("Paste a direct HTTPS link to an audio file.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("That URL is not valid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("For security, import links must use HTTPS and cannot include embedded credentials or fragments.");
  }
  if (url.port && url.port !== "443") {
    throw new Error("Only standard HTTPS links on port 443 are supported.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname.includes(".") || hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".test") ||
      hostname.endsWith(".invalid") || hostname.endsWith(".example") || net.isIP(hostname)) {
    throw new Error("The link must point to a public internet hostname.");
  }
  url.hostname = hostname;
  return url;
}

async function lookupPublicAddresses(hostname) {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !addressIsPublic(entry.address))) {
    throw new Error("The link resolves to a private or reserved network address and cannot be imported.");
  }
  return addresses;
}

function requestPublicHttps(url, addresses) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: "https:",
      hostname: url.hostname,
      port: 443,
      method: "GET",
      path: url.pathname + url.search,
      headers: {
        "User-Agent": "SelfMusic/0.1 (direct audio file importer)",
        Accept: "audio/*, application/octet-stream;q=0.9, */*;q=0.1"
      },
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => {
        const preferred = addresses.find((entry) => entry.family === 4) || addresses[0];
        callback(null, preferred.address, preferred.family);
      }
    }, resolve);

    request.setTimeout(20000, () => request.destroy(new Error("The source server timed out.")));
    request.on("error", reject);
    request.end();
  });
}

function safeUploadedName(input) {
  let name = path.posix.basename(String(input || "").replace(/\\/g, "/")).normalize("NFKC");
  name = name.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!name || name === "." || name === "..") name = "Imported track.mp3";
  return name;
}

async function chooseUniqueUploadPath(name) {
  const extension = path.extname(name).toLowerCase();
  const stem = path.basename(name, path.extname(name)).slice(0, 140) || "Imported track";
  let attempt = 1;
  while (attempt < 10000) {
    const suffix = attempt === 1 ? "" : " (" + attempt + ")";
    const candidate = path.join(uploadRoot, stem + suffix + extension);
    try {
      await fs.promises.access(candidate);
      attempt += 1;
    } catch {
      return candidate;
    }
  }
  throw new Error("Could not choose a unique filename for this import.");
}

// Классификация ошибок yt-dlp для понятного сообщения пользователю.
function describeYtdlpError(error) {
  const stderr = error?.stderr ? String(error.stderr) : "";
  const stdout = error?.stdout ? String(error.stdout) : "";
  const combined = (stderr + "\n" + stdout + "\n" + (error?.message || "")).toLowerCase();

  let code = "youtube_unavailable";
  let friendly = "Could not read that YouTube video. It may be private, age-restricted, region-locked, or YouTube changed something.";

  if (combined.includes("sign in to confirm") || combined.includes("not a bot") || combined.includes("confirm you're not a bot")) {
    code = "youtube_bot_check";
    friendly = "YouTube requires sign-in confirmation for this request. Export cookies from your browser to cookies.txt in the project root, then restart SelfMusic.";
  } else if (combined.includes("private video")) {
    code = "youtube_private";
    friendly = "This video is private.";
  } else if (combined.includes("video unavailable")) {
    code = "youtube_unavailable_video";
    friendly = "This video is unavailable.";
  } else if (combined.includes("age") && combined.includes("restrict")) {
    code = "youtube_age_restricted";
    friendly = "This video is age-restricted and requires cookies from a signed-in session.";
  } else if (combined.includes("http error 403") || combined.includes("403 forbidden")) {
    code = "youtube_forbidden";
    friendly = "YouTube returned 403 Forbidden. Try adding cookies.txt or updating yt-dlp (sudo pacman -S yt-dlp).";
  } else if (combined.includes("unsupported url") || combined.includes("is not a valid url")) {
    code = "youtube_bad_url";
    friendly = "That YouTube URL is not supported.";
  } else if (combined.includes("enoent") || combined.includes("no such file")) {
    code = "ytdlp_missing";
    friendly = "yt-dlp binary was not found. Install it with: sudo pacman -S yt-dlp";
  } else if (combined.includes("is not a valid") && combined.includes("url")) {
    code = "youtube_bad_url";
    friendly = "That YouTube URL is not supported.";
  }

  return { code, friendly, stderr, stdout };
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use("/api", enforceSameOriginMutation);

const genericRateLimitBuckets = new Map();
function rateLimitApi(req, res, next) {
  const windowMs = Math.max(10000, Number.parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || "60000", 10) || 60000);
  const max = Math.max(10, Number.parseInt(process.env.API_RATE_LIMIT_MAX || "60", 10) || 60);
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const normalizedPath = String(req.path || "/").replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, "/:id");
  const key = ip + ":" + normalizedPath;
  const now = Date.now();
  let bucket = genericRateLimitBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) bucket = { startedAt: now, count: 0 };
  bucket.count += 1;
  genericRateLimitBuckets.set(key, bucket);
  if (genericRateLimitBuckets.size > 10000) {
    for (const [entryKey, entry] of genericRateLimitBuckets) {
      if (now - entry.startedAt >= windowMs * 2) genericRateLimitBuckets.delete(entryKey);
    }
  }
  if (bucket.count > max) {
    res.setHeader("Retry-After", String(Math.ceil((windowMs - (now - bucket.startedAt)) / 1000)));
    return res.status(429).json({ error: "rate_limited", message: "Too many API requests. Try again shortly." });
  }
  next();
}
app.use("/api", rateLimitApi);

const rateLimitBuckets = new Map();
function rateLimitHeavyApi(req, res, next) {
  const requestPath = String(req.originalUrl || req.url || "").split("?")[0];
  const heavy = /^\/api\/(?:youtube\/(?:search|download)|import-url|upload|library\/scan|duplicates(?:\/merge)?|duplicates\/[^/]+)$/.test(requestPath);
  if (!heavy) return next();
  const windowMs = Math.max(10000, Number.parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || "60000", 10) || 60000);
  const max = Math.max(1, Number.parseInt(process.env.HEAVY_API_RATE_LIMIT_MAX || "8", 10) || 8);
  const key = (req.ip || req.socket.remoteAddress || "unknown") + ":" + requestPath;
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) bucket = { startedAt: now, count: 0 };
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  if (rateLimitBuckets.size > 5000) {
    for (const [entryKey, entry] of rateLimitBuckets) {
      if (now - entry.startedAt >= windowMs * 2) rateLimitBuckets.delete(entryKey);
    }
  }
  if (bucket.count > max) {
    res.setHeader("Retry-After", String(Math.ceil((windowMs - (now - bucket.startedAt)) / 1000)));
    return res.status(429).json({ error: "rate_limited", message: "Too many requests for this operation. Try again later." });
  }
  next();
}
app.use("/api", rateLimitHeavyApi);

app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    if (res.statusCode >= 400 || /^\/api\/(?:youtube|import-url|upload)/.test(req.path)) {
      console.info("[SelfMusic] request", JSON.stringify({
        method: req.method, path: req.path, status: res.statusCode,
        durationMs: Date.now() - started
      }));
    }
  });
  next();
});

function isConfigured() {
  const legacyPasswordConfigured =
    typeof process.env.SELF_MUSIC_PASSWORD === "string" &&
    process.env.SELF_MUSIC_PASSWORD.length >= 8 &&
    !process.env.SELF_MUSIC_PASSWORD.toLowerCase().includes("replace-with");
  if (legacyPasswordConfigured) return true;
  try {
    return Number(db.prepare("SELECT COUNT(*) AS count FROM users").get().count) > 0;
  } catch {
    return false;
  }
}

function constantTimeTextCompare(left, right) {
  const a = crypto.createHash("sha256").update(String(left)).digest();
  const b = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

function createSessionToken(userId = "legacy") {
  const expiresAt = String(Math.floor(Date.now() / 1000) + sessionLifetimeSeconds);
  if (userId === "legacy") {
    const signature = crypto.createHmac("sha256", sessionSecret).update(expiresAt).digest("base64url");
    return expiresAt + "." + signature;
  }
  const signedValue = userId + "." + expiresAt;
  const signature = crypto.createHmac("sha256", sessionSecret).update(signedValue).digest("base64url");
  return signedValue + "." + signature;
}

function getSessionInfo(req) {
  const cookies = String(req.headers.cookie || "").split(";").map((part) => part.trim());
  const entry = cookies.find((part) => part.startsWith(sessionCookie + "="));
  if (!entry) return { status: "missing", userId: null };

  const token = entry.slice(sessionCookie.length + 1);
  const parts = token.split(".");
  let userId = "legacy";
  let expiresAt;
  let signature;
  let signedValue;
  if (parts.length === 2) {
    [expiresAt, signature] = parts;
    signedValue = expiresAt;
  } else if (parts.length === 3) {
    [userId, expiresAt, signature] = parts;
    signedValue = userId + "." + expiresAt;
  } else {
    return { status: "invalid", userId: null };
  }
  const expiresAtNumber = Number(expiresAt);
  if (!expiresAt || !signature || !Number.isSafeInteger(expiresAtNumber) || expiresAtNumber <= Math.floor(Date.now() / 1000)) {
    return { status: "invalid", userId: null };
  }
  const expected = crypto.createHmac("sha256", sessionSecret).update(signedValue).digest("base64url");
  return constantTimeTextCompare(signature, expected)
    ? { status: "valid", userId }
    : { status: "invalid", userId: null };
}

function getSessionStatus(req) {
  return getSessionInfo(req).status;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = crypto.scryptSync(password, salt, 64).toString("base64url");
  return "scrypt$" + salt + "$" + derived;
}

function verifyPassword(password, encoded) {
  if (typeof encoded !== "string") return false;
  const [algorithm, salt, expectedText] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedText) return false;
  try {
    const expected = Buffer.from(expectedText, "base64url");
    const actual = crypto.scryptSync(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function sessionRequestIsSecure(req) {
  const forwardedProtocol = String(req.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
  let originIsHttps = false;
  try {
    originIsHttps = new URL(String(req.get("origin") || "")).protocol === "https:";
  } catch {
    // Requests without a valid Origin header can still use req.secure or proxy headers.
  }
  return Boolean(req.secure || forwardedProtocol === "https" || originIsHttps || process.env.NODE_ENV === "production");
}

function setSessionCookie(req, res, value, maxAge = sessionLifetimeSeconds) {
  const secure = sessionRequestIsSecure(req);
  // WebKit has had SameSite=Lax propagation bugs for same-origin JavaScript fetches.
  // On HTTPS, use None + Secure as a compatibility workaround.
  const flags = ["Path=/", "HttpOnly", "SameSite=" + (secure ? "None" : "Lax"), "Max-Age=" + maxAge];
  if (secure) flags.push("Secure");
  res.setHeader("Set-Cookie", sessionCookie + "=" + value + "; " + flags.join("; "));
}

function enforceSameOriginMutation(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const origin = req.get("origin");
  const fetchSite = String(req.get("sec-fetch-site") || "").toLowerCase();
  if (!origin) {
    if (fetchSite === "cross-site") {
      return res.status(403).json({ error: "cross_origin_request", message: "Cross-origin requests are not allowed." });
    }
    return next();
  }

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return res.status(403).json({ error: "invalid_origin", message: "The request origin could not be validated." });
  }

  // Tailscale Serve forwards the browser host while proxying to localhost.
  const forwardedHost = String(req.get("x-forwarded-host") || "").split(",")[0].trim();
  const expectedHost = forwardedHost || req.get("host") || "";
  if (originUrl.host.toLowerCase() !== expectedHost.toLowerCase()) {
    return res.status(403).json({ error: "cross_origin_request", message: "Cross-origin requests are not allowed." });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!isConfigured()) {
    return res.status(503).json({ error: "server_not_configured", message: "Set SELF_MUSIC_PASSWORD in .env before using the library." });
  }
  const session = getSessionInfo(req);
  if (session.status !== "valid") {
    return res.status(401).json({ error: "unauthorized", message: "Sign in to access your music library." });
  }
  if (session.userId === "legacy") {
    req.authUser = { id: "legacy", username: "owner", role: "admin", legacy: true };
    return next();
  }
  const user = db.prepare("SELECT id, username, role, created_at AS createdAt FROM users WHERE id = ?").get(session.userId);
  if (!user) {
    setSessionCookie(req, res, "", 0);
    return res.status(401).json({ error: "unauthorized", message: "This account no longer exists. Sign in again." });
  }
  req.authUser = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.authUser?.role !== "admin") {
    return res.status(403).json({ error: "admin_required", message: "Administrator access is required for this operation." });
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

async function findTracks(query = {}, options = {}) {
  await scanLibrary(db, musicRoot, { coverCacheDir, ...options });
  return readTracks(db, query);
}
mountCollectionRoutes(app, { db, requireAuth, findTracks });
mountSubsonicRoutes(app, { db, musicRoot, requireFindTracks: findTracks, resolveTrackFile });
mountLastFmRoutes(app, { db, requireAuth });
mountYoutubeJobRoutes(app, { db, requireAuth, requireAdmin, projectRoot, musicRoot, coverCacheDir, workDir: path.join(projectRoot, "data") });
async function resolveTrackFile(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/.test(id)) return null;
  const filePath = safeTrackPath(id);
  if (!filePath) return null;
  try {
    const entryStats = await fs.promises.lstat(filePath);
    if (entryStats.isSymbolicLink() || !entryStats.isFile() || !supportedExtensions.has(path.extname(filePath).toLowerCase())) return null;
    const rootRealPath = await fs.promises.realpath(musicRoot);
    const fileRealPath = await fs.promises.realpath(filePath);
    const relative = path.relative(rootRealPath, fileRealPath);
    if (!relative || relative === "." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return null;
    const stats = await fs.promises.stat(fileRealPath);
    return { filePath: fileRealPath, stats };
  } catch {
    return null;
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "SelfMusic", configured: isConfigured(), version: "0.1.0" });
});

app.get("/api/auth/session", (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Cookie");
  const sessionStatus = getSessionStatus(req);
  res.json({
    configured: isConfigured(),
    authenticated: isConfigured() && sessionStatus === "valid",
    sessionStatus,
  });
});

app.post("/api/auth/login", (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!isConfigured()) {
    return res.status(503).json({
      error: "server_not_configured",
      message: "Create .env from .env.example, set SELF_MUSIC_PASSWORD and SESSION_SECRET, then restart SelfMusic."
    });
  }

  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const attempt = loginAttempts.get(key);
  if (attempt && now - attempt.startedAt < 15 * 60 * 1000 && attempt.count >= 10) {
    return res.status(429).json({ error: "rate_limited", message: "Too many attempts. Wait 15 minutes and try again." });
  }

  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  let userId = null;
  let user = null;
  if (username) {
    user = db.prepare("SELECT id, password_hash FROM users WHERE username = ? COLLATE NOCASE").get(username);
    if (user && verifyPassword(password, user.password_hash)) userId = user.id;
  } else if (constantTimeTextCompare(password, process.env.SELF_MUSIC_PASSWORD)) {
    userId = "legacy";
  }

  if (!userId) {
    if (!attempt || now - attempt.startedAt >= 15 * 60 * 1000) {
      loginAttempts.set(key, { startedAt: now, count: 1 });
    } else {
      attempt.count += 1;
    }
    return res.status(401).json({ error: "invalid_credentials", message: "The username or password did not match." });
  }

  loginAttempts.delete(key);
  setSessionCookie(req, res, createSessionToken(userId));
  res.json({
    authenticated: true,
    user: user ? { id: user.id, username, role: db.prepare("SELECT role FROM users WHERE id = ?").get(user.id)?.role || "user" } : { id: "legacy", username: "owner", role: "admin" }
  });
});

app.get("/api/auth/profile", requireAuth, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ user: { id: req.authUser.id, username: req.authUser.username, role: req.authUser.role, legacy: Boolean(req.authUser.legacy) } });
});

app.post("/api/auth/register", requireAuth, (req, res) => {
  if (req.authUser.role !== "admin") {
    return res.status(403).json({ error: "admin_required", message: "Only an administrator can create accounts." });
  }
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const role = req.body?.role === "admin" ? "admin" : "user";
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: "invalid_username", message: "Username must be 3–32 characters using letters, numbers, dot, underscore or hyphen." });
  }
  if (password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: "invalid_password", message: "Account passwords must be 12–128 characters." });
  }
  try {
    const id = crypto.randomUUID();
    let encryptedPassword;
    try {
      encryptedPassword = encryptSecret(password);
    } catch (error) {
      return res.status(503).json({ error: "secret_encryption_unavailable", message: error.message });
    }
    db.prepare("INSERT INTO users(id, username, password_hash, subsonic_secret, role) VALUES (?, ?, ?, ?, ?)").run(id, username, hashPassword(password), encryptedPassword, role);
    console.info("[SelfMusic] account created", JSON.stringify({ id, role }));
    res.status(201).json({ user: { id, username, role } });
  } catch (error) {
    if (String(error?.code || "").includes("CONSTRAINT")) {
      return res.status(409).json({ error: "username_taken", message: "That username is already in use." });
    }
    throw error;
  }
});

app.get("/api/admin/users", requireAuth, (req, res) => {
  if (req.authUser.role !== "admin") return res.status(403).json({ error: "admin_required" });
  const users = db.prepare("SELECT id, username, role, created_at AS createdAt FROM users ORDER BY created_at, username COLLATE NOCASE").all();
  res.setHeader("Cache-Control", "no-store");
  res.json({ users });
});

app.patch("/api/admin/users/:id", requireAuth, (req, res) => {
  if (req.authUser.role !== "admin") return res.status(403).json({ error: "admin_required" });
  const id = String(req.params.id || "");
  const role = req.body?.role;
  if (!["admin", "user"].includes(role)) return res.status(400).json({ error: "invalid_role" });
  if (id === req.authUser.id && role !== "admin") return res.status(400).json({ error: "cannot_demote_self", message: "You cannot remove your own administrator role." });
  if (role !== "admin") {
    const target = db.prepare("SELECT role FROM users WHERE id = ?").get(id);
    const adminCount = Number(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count);
    if (target?.role === "admin" && adminCount <= 1) {
      return res.status(409).json({ error: "last_admin_required", message: "At least one managed administrator account must remain." });
    }
  }
  const result = db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  if (!result.changes) return res.status(404).json({ error: "user_not_found" });
  res.json({ updated: true, id, role });
});

app.delete("/api/admin/users/:id", requireAuth, (req, res) => {
  if (req.authUser.role !== "admin") return res.status(403).json({ error: "admin_required" });
  const id = String(req.params.id || "");
  if (!id || id === req.authUser.id || id === "legacy") return res.status(400).json({ error: "cannot_delete_user", message: "An administrator cannot delete their own account." });
  const result = db.prepare("DELETE FROM users WHERE id = ?").run(id);
  if (!result.changes) return res.status(404).json({ error: "user_not_found" });
  db.prepare("DELETE FROM playlists WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM favorites WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM play_history WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM lastfm_accounts WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM lastfm_pending_auth WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM scrobble_queue WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM youtube_jobs WHERE user_id = ?").run(id);
  console.info("[SelfMusic] account deleted", JSON.stringify({ id }));
  res.status(204).end();
});

app.post("/api/auth/logout", (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  setSessionCookie(req, res, "", 0);
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
        .replace(/[\x00-\x1F\x7F<>:"|?*]/g, "")
        .replace(/\s+/g, " ")
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

app.post("/api/upload", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await findTracks();
  } catch (error) {
    return next(error);
  }
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

    const duplicateStrategy = configuredDuplicateStrategy();
    const accepted = [];
    const skipped = [];
    const duplicateMatches = [];
    for (const file of files) {
      let sha256;
      try { sha256 = await hashFile(file.path); }
      catch (error) {
        await Promise.all(files.map((item) => fs.promises.unlink(item.path).catch(() => {})));
        return next(error);
      }
      const existing = db.prepare("SELECT id, title, artist, album FROM tracks WHERE sha256 = ? LIMIT 10").all(sha256);
      if (existing.length && duplicateStrategy === "skip") {
        await fs.promises.unlink(file.path).catch(() => {});
        skipped.push({ name: file.filename, reason: "duplicate", matches: existing });
        continue;
      }
      if (existing.length) duplicateMatches.push({ name: file.filename, sha256, strategy: duplicateStrategy, matches: existing });
      accepted.push(file);
    }
    try {
      await findTracks();
    } catch (error) {
      console.error("[SelfMusic] uploaded files could not be indexed immediately:", error.message);
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({
      uploaded: accepted.length,
      skipped: skipped.length,
      duplicateStrategy,
      duplicates: duplicateMatches,
      destination: "Uploads",
      files: accepted.map((file) => ({ name: file.filename, bytes: file.size })),
      skippedFiles: skipped
    });
  });
});

app.post("/api/import-url", requireAuth, requireAdmin, async (req, res, next) => {
  let targetPath = null;
  let targetCreated = false;
  try {
    await findTracks();
    let url = validateImportUrl(req.body?.url);
    let response = null;
    let redirects = 0;

    while (redirects <= 3) {
      const addresses = await lookupPublicAddresses(url.hostname);
      response = await requestPublicHttps(url, addresses);

      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        const location = response.headers.location;
        response.resume();
        if (!location || redirects === 3) {
          throw new Error("The source uses too many redirects or supplied an invalid redirect.");
        }
        url = validateImportUrl(new URL(location, url).toString());
        redirects += 1;
        continue;
      }
      break;
    }

    if (!response) throw new Error("The source did not return a response.");
    if (response.statusCode !== 200) {
      response.resume();
      throw new Error("The source could not provide the file (HTTP " + response.statusCode + "). Use a direct download link.");
    }

    const contentType = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const disposition = String(response.headers["content-disposition"] || "");
    let suggestedName = "";
    const utf8Filename = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
    const ordinaryFilename = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(disposition);
    if (utf8Filename) {
      try { suggestedName = decodeURIComponent(utf8Filename[1].trim()); } catch { suggestedName = ""; }
    } else if (ordinaryFilename) {
      suggestedName = (ordinaryFilename[1] || ordinaryFilename[2] || "").trim();
    }

    let urlName = "";
    try { urlName = decodeURIComponent(path.posix.basename(url.pathname)); } catch { urlName = path.posix.basename(url.pathname); }
    let filename = safeUploadedName(suggestedName || urlName || "Imported track");

    let extension = path.extname(filename).toLowerCase();
    if (!supportedExtensions.has(extension)) {
      const mimeExtension = audioMimeToExtension[contentType];
      if (!mimeExtension) {
        response.resume();
        throw new Error("This link did not return a supported audio file. Paste a direct MP3, FLAC, M4A, AAC, WAV, OGG, OPUS or WebM audio download link.");
      }
      filename = path.basename(filename, path.extname(filename)) + mimeExtension;
      extension = mimeExtension;
    }

    if (!(contentType.startsWith("audio/") || contentType === "application/octet-stream" ||
          contentType === "binary/octet-stream" || contentType === "application/force-download" || contentType === "")) {
      response.resume();
      throw new Error("The URL points to a webpage or unsupported content, not an audio file. Use a direct audio download URL.");
    }

    const contentLength = Number(response.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > maxUploadBytes) {
      response.resume();
      throw new Error("This file is larger than the 250 MB limit.");
    }

    await fs.promises.mkdir(uploadRoot, { recursive: true });
    targetPath = await chooseUniqueUploadPath(filename);

    let bytesReceived = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytesReceived += chunk.length;
        if (bytesReceived > maxUploadBytes) {
          callback(new Error("This file is larger than the 250 MB limit."));
        } else {
          callback(null, chunk);
        }
      }
    });

    try {
      await pipeline(response, limiter, fs.createWriteStream(targetPath, { flags: "wx" }));
      targetCreated = true;
    } catch (error) {
      await fs.promises.unlink(targetPath).catch(() => {});
      throw error;
    }

    if (bytesReceived === 0) {
      await fs.promises.unlink(targetPath).catch(() => {});
      throw new Error("The source returned an empty file.");
    }

    const sha256 = await hashFile(targetPath);
    const duplicateMatches = db.prepare("SELECT id, title, artist, album, relative_path AS path FROM tracks WHERE sha256 = ? LIMIT 10").all(sha256);
    const duplicateStrategy = configuredDuplicateStrategy();
    if (duplicateMatches.length && duplicateStrategy === "skip") {
      await fs.promises.unlink(targetPath).catch(() => {});
      targetCreated = false;
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ imported: false, skipped: true, reason: "duplicate", duplicateStrategy, duplicates: duplicateMatches });
    }

    await findTracks();
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({
      imported: true,
      name: path.basename(targetPath),
      bytes: bytesReceived,
      destination: "Uploads",
      duplicateStrategy,
      duplicates: duplicateStrategy === "ask" ? duplicateMatches : []
    });
  } catch (error) {
    if (targetPath && !targetCreated) await fs.promises.unlink(targetPath).catch(() => {});
    const message = String(error?.message || "Could not import this link.");
    const expectedImportFailure =
      ["The source server timed out.", "This file is larger than the 250 MB limit."].includes(message) ||
      message.startsWith("Paste a direct") ||
      message.startsWith("That URL") ||
      message.startsWith("For security") ||
      message.startsWith("Only standard") ||
      message.startsWith("The link") ||
      message.startsWith("This link") ||
      message.startsWith("The URL") ||
      message.startsWith("The source") ||
      message.startsWith("Could not choose");

    if (expectedImportFailure) {
      return res.status(400).json({ error: "url_import_failed", message });
    }
    if (["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(error?.code)) {
      return res.status(400).json({
        error: "url_source_unreachable",
        message: "The source could not be reached securely. Check the URL and use a public HTTPS link that downloads an audio file directly."
      });
    }
    next(error);
  }
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

app.get("/api/artists", requireAuth, async (_req, res, next) => {
  try {
    await findTracks();
    res.setHeader("Cache-Control", "no-store");
    res.json({ artists: listArtists(db) });
  } catch (error) { next(error); }
});

app.get("/api/albums", requireAuth, async (req, res, next) => {
  try {
    await findTracks();
    const artistId = typeof req.query.artistId === "string" ? req.query.artistId : null;
    if (artistId && !/^[A-Za-z0-9_-]{1,128}$/.test(artistId)) {
      return res.status(400).json({ error: "invalid_artist_id", message: "The artist ID is invalid." });
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ albums: listAlbums(db, artistId) });
  } catch (error) { next(error); }
});

app.get("/api/search", requireAuth, async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 1 || q.length > 100) {
      return res.status(400).json({ error: "invalid_query", message: "Search must contain 1–100 characters." });
    }
    const tracks = await findTracks({ q });
    res.setHeader("Cache-Control", "no-store");
    res.json({ tracks, total: tracks.length });
  } catch (error) { next(error); }
});

app.post("/api/library/scan", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const tracks = await findTracks({}, { force: true });
    console.info("[SelfMusic] library scan complete", JSON.stringify({ tracks: tracks.length }));
    res.setHeader("Cache-Control", "no-store");
    res.json({ scanned: true, tracks: tracks.length });
  } catch (error) { next(error); }
});

app.get("/api/duplicates", requireAuth, async (_req, res, next) => {
  try {
    await findTracks();
    const groups = db.prepare("SELECT sha256, COUNT(*) AS count FROM tracks WHERE sha256 IS NOT NULL GROUP BY sha256 HAVING COUNT(*) > 1 ORDER BY count DESC").all();
    const readGroup = db.prepare("SELECT id, title, artist, album, relative_path AS path, size_bytes AS bytes, added_at AS addedAt FROM tracks WHERE sha256 = ? ORDER BY added_at, relative_path");
    res.setHeader("Cache-Control", "no-store");
    res.json({ groups: groups.map((group) => ({ sha256: group.sha256, count: group.count, tracks: readGroup.all(group.sha256) })) });
  } catch (error) { next(error); }
});

app.post("/api/duplicates/merge", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const keepId = typeof req.body?.keepId === "string" ? req.body.keepId : "";
    const duplicateIds = req.body?.duplicateIds;
    if (!keepId || !Array.isArray(duplicateIds) || duplicateIds.length < 1 || duplicateIds.length > 100 ||
        duplicateIds.some((id) => typeof id !== "string" || id === keepId) ||
        new Set(duplicateIds).size !== duplicateIds.length) {
      return res.status(400).json({ error: "invalid_duplicate_merge", message: "Choose one keeper and 1–100 distinct duplicate track IDs." });
    }
    await findTracks();
    const keeper = getTrackRow(db, keepId);
    if (!keeper?.sha256) return res.status(404).json({ error: "track_not_found" });
    const duplicates = duplicateIds.map((id) => getTrackRow(db, id));
    if (duplicates.some((row) => !row || row.sha256 !== keeper.sha256)) {
      return res.status(409).json({ error: "not_identical_files", message: "Only tracks with identical SHA-256 content can be merged." });
    }
    const filesToRemove = [];
    for (const duplicate of duplicates) {
      const file = await resolveTrackFile(duplicate.id);
      if (!file) return res.status(409).json({ error: "duplicate_file_missing", message: "A duplicate file is no longer available." });
      filesToRemove.push({ duplicate, file });
    }
    const insertFavorite = db.prepare("INSERT OR IGNORE INTO favorites(user_id, track_id) SELECT user_id, ? FROM favorites WHERE track_id = ?");
    const playlists = db.prepare("SELECT playlist_id, position FROM playlist_tracks WHERE track_id = ? ORDER BY position");
    const existing = db.prepare("SELECT 1 AS found FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?");
    const maxPosition = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM playlist_tracks WHERE playlist_id = ?");
    const insertPlaylistTrack = db.prepare("INSERT OR IGNORE INTO playlist_tracks(playlist_id, track_id, position) VALUES (?, ?, ?)");
    const moveHistory = db.prepare("UPDATE play_history SET track_id = ? WHERE track_id = ?");
    const deleteTrackRow = db.prepare("DELETE FROM tracks WHERE id = ?");
    db.exec("BEGIN IMMEDIATE;");
    try {
      for (const { duplicate } of filesToRemove) {
        insertFavorite.run(keeper.id, duplicate.id);
        for (const row of playlists.all(duplicate.id)) {
          if (existing.get(row.playlist_id, keeper.id)) continue;
          const nextPosition = Number(maxPosition.get(row.playlist_id).position);
          insertPlaylistTrack.run(row.playlist_id, keeper.id, nextPosition);
        }
        moveHistory.run(keeper.id, duplicate.id);
        deleteTrackRow.run(duplicate.id);
      }
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
    for (const { file } of filesToRemove) await fs.promises.unlink(file.filePath).catch((error) => {
      console.error("[SelfMusic] merged duplicate file cleanup failed", error.message);
    });
    console.info("[SelfMusic] duplicates merged", JSON.stringify({ keepId, removedCount: duplicates.length }));
    res.json({ merged: true, kept: keepId, removed: duplicates.length });
  } catch (error) { next(error); }
});

app.delete("/api/duplicates/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const row = getTrackRow(db, req.params.id);
    const file = await resolveTrackFile(req.params.id);
    if (!row || !file) return res.status(404).json({ error: "track_not_found" });
    await fs.promises.unlink(file.filePath);
    db.prepare("DELETE FROM tracks WHERE id = ?").run(row.id);
    console.info("[SelfMusic] duplicate track deleted", JSON.stringify({ id: row.id }));
    res.json({ deleted: true, id: row.id });
  } catch (error) {
    if (error?.code === "ENOENT") return res.status(404).json({ error: "track_not_found" });
    next(error);
  }
});

app.get("/api/player/settings", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    transcodingEnabled: transcodingEnabled(),
    formats: ["original", "mp3", "opus", "aac"],
    defaultBitrate: process.env.DEFAULT_BITRATE || "192k",
    bitrates: ["64k", "96k", "128k", "160k", "192k", "256k", "320k"]
  });
});

app.delete("/api/tracks/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const track = await resolveTrackFile(req.params.id);
    if (!track) {
      return res.status(404).json({ error: "track_not_found", message: "This track is no longer in the library." });
    }

    // Resolve symlinks before deletion so a crafted track ID cannot escape MUSIC_DIR.
    const rootRealPath = await fs.promises.realpath(musicRoot);
    const fileRealPath = await fs.promises.realpath(track.filePath);
    const entryStats = await fs.promises.lstat(track.filePath);
    const relativePath = path.relative(rootRealPath, fileRealPath);
    if (
      entryStats.isSymbolicLink() ||
      !entryStats.isFile() ||
      !relativePath ||
      relativePath === "." ||
      relativePath.startsWith(".." + path.sep) ||
      path.isAbsolute(relativePath)
    ) {
      return res.status(400).json({ error: "invalid_track_path", message: "This file cannot be deleted from the library." });
    }

    const name = path.basename(track.filePath);
    const folder = path.dirname(track.filePath);
    const stem = path.basename(track.filePath, path.extname(track.filePath));
    await fs.promises.unlink(track.filePath);

    // Clean up thumbnails saved beside imported tracks, without touching folder covers.
    for (const extension of [".jpg", ".jpeg", ".png", ".webp", ".avif"]) {
      await fs.promises.unlink(path.join(folder, stem + extension)).catch(() => {});
    }

    res.setHeader("Cache-Control", "no-store");
    return res.json({ deleted: true, name });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return res.status(404).json({ error: "track_not_found", message: "This track is no longer in the library." });
    }
    next(error);
  }
});

app.get("/api/network/addresses", requireAuth, (_req, res) => {
  const local = new Set();
  const tailscale = new Set();
  const interfaces = os.networkInterfaces();

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    if (/^(docker|br-|veth|podman|cni|virbr|vEthernet)/i.test(interfaceName)) continue;
    for (const entry of entries || []) {
      if (entry.internal || (entry.family !== 4 && entry.family !== "IPv4")) continue;
      const address = String(entry.address || "");
      if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) {
        tailscale.add(address);
      } else if (/^10\./.test(address) || /^192\.168\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address)) {
        local.add(address);
      }
    }
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({ local: [...local], tailscale: [...tailscale] });
});

function parseIsoDuration(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(value || ""));
  if (!match) return null;
  const seconds = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  return Number.isFinite(seconds) ? Math.round(seconds) : null;
}

function pruneYoutubeSearchCache(now = Date.now()) {
  for (const [key, entry] of youtubeSearchCache) {
    if (entry.expiresAt <= now) youtubeSearchCache.delete(key);
  }
  while (youtubeSearchCache.size > 250) youtubeSearchCache.delete(youtubeSearchCache.keys().next().value);
}

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

    const cacheKey = query.toLocaleLowerCase();
    pruneYoutubeSearchCache();
    const cached = youtubeSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.json({ ...cached.payload, cached: true });
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
        thumbnail: String(item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || ""),
        duration: null
      }));

    if (items.length) {
      const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
      detailsUrl.searchParams.set("key", apiKey);
      detailsUrl.searchParams.set("part", "contentDetails");
      detailsUrl.searchParams.set("id", items.map((item) => item.videoId).join(","));
      try {
        const detailsResponse = await fetch(detailsUrl, { signal: AbortSignal.timeout(7000) });
        if (detailsResponse.ok) {
          const detailsPayload = await detailsResponse.json();
          const durationById = new Map((detailsPayload.items || []).map((item) => [item.id, parseIsoDuration(item.contentDetails?.duration)]));
          for (const item of items) item.duration = durationById.get(item.videoId) ?? null;
        }
      } catch (error) {
        console.warn("[SelfMusic] YouTube duration lookup failed:", error.message);
      }
    }

    const resultPayload = { items, totalResults: payload.pageInfo?.totalResults || items.length, cached: false };
    const cacheSeconds = Math.min(3600, Math.max(0, Number.parseInt(process.env.YOUTUBE_CACHE_TTL_SECONDS || "300", 10) || 300));
    if (cacheSeconds > 0) {
      youtubeSearchCache.set(cacheKey, { payload: resultPayload, expiresAt: Date.now() + cacheSeconds * 1000 });
      pruneYoutubeSearchCache();
    }
    res.setHeader("Cache-Control", "private, max-age=60");
    res.json(resultPayload);
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return res.status(504).json({ error: "youtube_timeout", message: "YouTube search took too long. Try again." });
    }
    next(error);
  }
});


async function ensureYoutubeArtwork(info, targetPath) {
  const directory = path.dirname(targetPath);
  const stem = path.basename(targetPath, path.extname(targetPath));
  const extensions = [".jpg", ".jpeg", ".png", ".webp", ".avif"];

  for (const extension of extensions) {
    const artworkPath = path.join(directory, stem + extension);
    try {
      const stats = await fs.promises.stat(artworkPath);
      if (stats.isFile() && stats.size > 0) return path.basename(artworkPath);
      if (stats.isFile()) await fs.promises.unlink(artworkPath).catch(() => {});
    } catch {
      // yt-dlp may not have left a sidecar thumbnail; try the metadata URL below.
    }
  }

  const candidate = String(info?.thumbnail || info?.thumbnails?.slice?.().reverse().find((item) => item?.url)?.url || "");
  if (!candidate) return null;
  let thumbnailUrl;
  try {
    thumbnailUrl = new URL(candidate);
  } catch {
    return null;
  }

  const supportedMimeTypes = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/avif": ".avif",
  };

  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    if (thumbnailUrl.protocol !== "https:" || !/(^|\.)ytimg\.com$/i.test(thumbnailUrl.hostname)) {
      throw new Error("Refusing an untrusted YouTube thumbnail URL.");
    }

    const response = await fetch(thumbnailUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
      headers: { "user-agent": "SelfMusic/0.1" },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirectCount === 3) throw new Error("YouTube thumbnail redirect limit reached.");
      thumbnailUrl = new URL(location, thumbnailUrl);
      continue;
    }
    if (!response.ok || !response.body) return null;

    const mimeType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const extension = supportedMimeTypes[mimeType];
    if (!extension) return null;

    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > 8 * 1024 * 1024) throw new Error("YouTube thumbnail exceeds the 8 MB limit.");
      chunks.push(buffer);
    }
    if (!totalBytes) return null;

    const artworkPath = path.join(directory, stem + extension);
    await fs.promises.writeFile(artworkPath, Buffer.concat(chunks), { flag: "wx" });
    return path.basename(artworkPath);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Download audio from a YouTube URL and convert to MP3 using yt-dlp.
// POST /api/youtube/download   body: { url: "https://www.youtube.com/watch?v=..." }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/youtube/download", requireAuth, requireAdmin, async (req, res, next) => {
  let targetPath = null;
  try {
    if (req.body?.async === true || String(req.query.async || "").toLowerCase() === "true") {
      try {
        const job = createYoutubeJob(db, {
          projectRoot,
          musicRoot,
          coverCacheDir,
          workDir: path.join(projectRoot, "data")
        }, req.authUser.id, req.body || {});
        res.setHeader("Cache-Control", "no-store");
        return res.status(202).json({ queued: true, job });
      } catch (error) {
        const status = error.code === "INVALID_YOUTUBE_URL" || error.code === "INVALID_YOUTUBE_BITRATE" ? 400 : error.code === "YOUTUBE_QUEUE_FULL" ? 429 : 500;
        return res.status(status).json({ error: String(error.code || "youtube_job_failed").toLowerCase(), message: error.message || "Could not queue this download." });
      }
    }
    const rawUrl = typeof req.body?.url === "string" ? req.body.url.trim() : "";

    if (!rawUrl || rawUrl.length > 2048) {
      return res.status(400).json({
        error: "invalid_youtube_url",
        message: "Paste a YouTube video URL."
      });
    }
    if (!isYoutubeUrl(rawUrl)) {
      return res.status(400).json({
        error: "invalid_youtube_url",
        message: "That does not look like a valid YouTube video URL."
      });
    }
    await findTracks();

    const ytdlpCommon = {
      noWarnings: true,
      noPlaylist: true,
      verbose: true,
      forceIpv4: true,
      extractorArgs: "youtube:player_client=android,web",
      addHeader: [
        "referer:youtube.com",
        "user-agent:Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
      ]
    };

    // Если пользователь положил cookies.txt в корень проекта — используем его.
    const cookiesPath = path.join(projectRoot, "cookies.txt");
    if (fs.existsSync(cookiesPath)) {
      ytdlpCommon.cookies = cookiesPath;
    }

    let info;
    try {
      info = await youtubedl(rawUrl, { ...ytdlpCommon, dumpSingleJson: true, skipDownload: true });
    } catch (error) {
      const described = describeYtdlpError(error);
      console.error("[SelfMusic] yt-dlp info failed:", {
        message: error?.message || "(no message)",
        code: error?.code,
        exitCode: error?.exitCode,
        signal: error?.signal,
        stderr: described.stderr ? described.stderr.slice(-4000) : "(empty)",
        stdout: described.stdout ? described.stdout.slice(-4000) : "(empty)"
      });
      return res.status(400).json({ error: described.code, message: described.friendly });
    }

    const durationSeconds = Number(info?.duration || 0);
    const maxDurationSeconds = Number.parseInt(process.env.YOUTUBE_MAX_DURATION_SECONDS || "3600", 10);
    if (Number.isFinite(durationSeconds) && durationSeconds > maxDurationSeconds) {
      return res.status(413).json({
        error: "youtube_too_long",
        message: "That video is longer than the allowed " + Math.round(maxDurationSeconds / 60) + " minutes."
      });
    }

    const rawTitle = String(info?.title || "YouTube audio");
    const baseName = safeUploadedName(rawTitle).replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 140) || "YouTube audio";
    const filename = baseName + ".mp3";

    await fs.promises.mkdir(uploadRoot, { recursive: true });
    targetPath = await chooseUniqueUploadPath(filename);

    // yt-dlp wants an output template; use stem + %(ext)s so it writes exactly <stem>.mp3.
    const outputTemplate = path.join(uploadRoot, path.basename(targetPath, ".mp3") + ".%(ext)s");

    try {
      await youtubedl(rawUrl, {
        ...ytdlpCommon,
        extractAudio: true,
        audioFormat: "mp3",
        audioQuality: 0,
        writeThumbnail: true,
        convertThumbnails: "jpg",
        embedThumbnail: true,
        output: outputTemplate
      });
    } catch (error) {
      const described = describeYtdlpError(error);
      await fs.promises.unlink(targetPath).catch(() => {});
      console.error("[SelfMusic] yt-dlp download error:", {
        message: error?.message || "(no message)",
        code: error?.code,
        exitCode: error?.exitCode,
        signal: error?.signal,
        stderr: described.stderr ? described.stderr.slice(-4000) : "(empty)",
        stdout: described.stdout ? described.stdout.slice(-4000) : "(empty)"
      });
      return res.status(500).json({ error: described.code, message: described.friendly });
    }

    let stats;
    try {
      stats = await fs.promises.stat(targetPath);
    } catch {
      return res.status(500).json({
        error: "youtube_empty_output",
        message: "The conversion produced no file."
      });
    }

    if (!stats.size) {
      await fs.promises.unlink(targetPath).catch(() => {});
      return res.status(500).json({
        error: "youtube_empty_output",
        message: "The conversion produced an empty file."
      });
    }

    const outputSha256 = await hashFile(targetPath);
    const duplicateMatches = db.prepare("SELECT id, title, artist, album, relative_path AS path FROM tracks WHERE sha256 = ? LIMIT 10").all(outputSha256);
    const duplicateStrategy = configuredDuplicateStrategy();
    if (duplicateMatches.length && duplicateStrategy === "skip") {
      const outputDir = path.dirname(targetPath);
      const outputStem = path.basename(targetPath, ".mp3");
      await fs.promises.unlink(targetPath).catch(() => {});
      await Promise.all([".jpg", ".jpeg", ".png", ".webp"].map((ext) => fs.promises.unlink(path.join(outputDir, outputStem + ext)).catch(() => {})));
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ downloaded: false, skipped: true, reason: "duplicate", duplicateStrategy, duplicates: duplicateMatches });
    }

    let artworkName = null;
    try {
      artworkName = await ensureYoutubeArtwork(info, targetPath);
    } catch (artworkError) {
      // A missing cover should not discard a successful audio conversion.
      console.warn("[SelfMusic] Could not save YouTube thumbnail:", artworkError?.message || artworkError);
    }

    try { await findTracks(); }
    catch (error) { console.error("[SelfMusic] downloaded audio could not be indexed immediately:", error.message); }
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({
      downloaded: true,
      name: path.basename(targetPath),
      bytes: stats.size,
      durationSeconds,
      title: rawTitle,
      artwork: Boolean(artworkName),
      destination: "Uploads",
      duplicateStrategy,
      duplicates: duplicateStrategy === "ask" ? duplicateMatches : []
    });
  } catch (error) {
    if (targetPath) await fs.promises.unlink(targetPath).catch(() => {});
    console.error("[SelfMusic] YouTube download error:", error?.message);
    next(error);
  }
});

app.get("/api/artwork/:id", requireAuth, async (req, res, next) => {
  try {
    const track = await resolveTrackFile(req.params.id);
    if (!track) return res.status(404).json({ error: "not_found" });
    const folder = path.dirname(track.filePath);
    const catalogTrack = getTrackRow(db, req.params.id);
    if (catalogTrack?.cover_path) {
      const coverPath = path.resolve(catalogTrack.cover_path);
      const cacheRoot = path.resolve(coverCacheDir);
      if (coverPath.startsWith(cacheRoot + path.sep)) {
        try {
          const coverStats = await fs.promises.lstat(coverPath);
          if (coverStats.isFile() && !coverStats.isSymbolicLink()) {
            res.setHeader("Cache-Control", "private, max-age=3600");
            res.type(mimeTypes[path.extname(coverPath).toLowerCase()] || "image/jpeg");
            return fs.createReadStream(coverPath).pipe(res);
          }
        } catch {
          // A stale embedded-cover cache entry should fall back to sidecar/folder art.
        }
      }
    }
    const trackStem = path.basename(track.filePath, path.extname(track.filePath));
    for (const extension of [".jpg", ".jpeg", ".png", ".webp", ".avif"]) {
      const trackArtPath = path.join(folder, trackStem + extension);
      try {
        const stats = await fs.promises.stat(trackArtPath);
        if (stats.isFile()) {
          res.setHeader("Cache-Control", "private, max-age=3600");
          res.type(mimeTypes[extension] || "application/octet-stream");
          return fs.createReadStream(trackArtPath).pipe(res);
        }
      } catch {
        // A track-specific thumbnail may not exist; try a folder cover next.
      }
    }
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

    const requestedFormat = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "";
    if (requestedFormat) {
      let options;
      try {
        options = parseTranscodeOptions(requestedFormat, req.query.bitrate);
      } catch (error) {
        return res.status(400).json({ error: "invalid_transcode_options", message: error.message });
      }
      if (!originalSupportsFormat(track.filePath, options.format)) {
        const trackRow = getTrackRow(db, req.params.id);
        if (!trackRow) return res.status(404).json({ error: "track_not_found" });
        let transcoded;
        try {
          transcoded = await getTranscodedFile(db, trackRow, track.filePath, transcodeCacheDir, options);
        } catch (error) {
          if (error.code === "TRANSCODE_DISABLED") return res.status(503).json({ error: error.code.toLowerCase(), message: error.message });
          if (error.code === "FFMPEG_MISSING") return res.status(503).json({ error: error.code.toLowerCase(), message: error.message });
          if (error.code === "TRANSCODE_TIMEOUT") return res.status(504).json({ error: error.code.toLowerCase(), message: error.message });
          if (["INVALID_TRANSCODE_FORMAT", "INVALID_TRANSCODE_BITRATE"].includes(error.code)) return res.status(400).json({ error: error.code.toLowerCase(), message: error.message });
          console.error("[SelfMusic] transcode failed", JSON.stringify({ trackId: req.params.id, code: error.code || "unknown", message: error.message }));
          return res.status(500).json({ error: "transcode_failed", message: error.message || "Could not transcode this audio." });
        }
        const size = transcoded.stats.size;
        res.setHeader("Content-Type", transcoded.options.mimeType);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-SelfMusic-Transcode-Cache", transcoded.cacheHit ? "HIT" : "MISS");
        const requestedRange = req.headers.range;
        if (!requestedRange) {
          res.setHeader("Content-Length", size);
          return fs.createReadStream(transcoded.filePath).pipe(res);
        }
        const match = /^bytes=(\\d*)-(\\d*)$/.exec(requestedRange);
        if (!match || (!match[1] && !match[2])) {
          res.setHeader("Content-Range", "bytes */" + size);
          return res.status(416).end();
        }
        let startByte = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        let endByte = match[2] ? Number(match[2]) : size - 1;
        if (!Number.isSafeInteger(startByte) || !Number.isSafeInteger(endByte) || startByte >= size || startByte > endByte || endByte < 0) {
          res.setHeader("Content-Range", "bytes */" + size);
          return res.status(416).end();
        }
        endByte = Math.min(endByte, size - 1);
        res.status(206);
        res.setHeader("Content-Range", "bytes " + startByte + "-" + endByte + "/" + size);
        res.setHeader("Content-Length", endByte - startByte + 1);
        return fs.createReadStream(transcoded.filePath, { start: startByte, end: endByte }).pipe(res);
      }
    }
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

function bootstrapAdminAccount() {
  const username = String(process.env.BOOTSTRAP_ADMIN_USERNAME || "admin").trim();
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "");
  if (!password) return;
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username) || password.length < 12 || password.length > 128) {
    console.error("[SelfMusic] BOOTSTRAP_ADMIN_USERNAME must be 3–32 safe characters and BOOTSTRAP_ADMIN_PASSWORD must be 12–128 characters.");
    return;
  }
  if (Number(db.prepare("SELECT COUNT(*) AS count FROM users").get().count) > 0) return;
  try {
    db.prepare("INSERT INTO users(id, username, password_hash, subsonic_secret, role) VALUES (?, ?, ?, ?, 'admin')").run(
      crypto.randomUUID(), username, hashPassword(password), encryptSecret(password)
    );
    console.info("[SelfMusic] bootstrap administrator created", JSON.stringify({ username }));
  } catch (error) {
    console.error("[SelfMusic] could not create bootstrap administrator:", error.message);
  }
}

fs.promises.mkdir(musicRoot, { recursive: true }).then(() => {
  bootstrapAdminAccount();
  app.listen(port, "0.0.0.0", () => {
    console.log("SelfMusic server listening on http://localhost:" + port);
    console.log("Music folder: " + musicRoot);
    console.log("SQLite database: " + databasePath);
    if (!isConfigured()) console.warn("Setup required: create .env and set SELF_MUSIC_PASSWORD to a password of at least 8 characters.");
    if (process.env.NODE_ENV === "production" && !hasPersistentSessionSecret) {
      console.warn("Set a random SESSION_SECRET of at least 32 characters in production so sessions remain valid after restarts.");
    }
  });
}).then(() => {
  const lastFmTimer = setInterval(() => {
    flushLastFmQueue(db).catch((error) => console.warn("[SelfMusic] Last.fm queue worker failed", error.message));
  }, 60000);
  lastFmTimer.unref();
}).catch((error) => {
  console.error("Could not prepare music directory:", error.message);
  process.exitCode = 1;
});
