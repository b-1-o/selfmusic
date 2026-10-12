import crypto from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { create as createYoutubeDl } from "youtube-dl-exec";

const youtubedl = createYoutubeDl("/usr/bin/yt-dlp");

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

app.post("/api/import-url", requireAuth, async (req, res, next) => {
  let targetPath = null;
  let targetCreated = false;
  try {
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

    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({
      imported: true,
      name: path.basename(targetPath),
      bytes: bytesReceived,
      destination: "Uploads"
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

// ─────────────────────────────────────────────────────────────────────────────
// Download audio from a YouTube URL and convert to MP3 using yt-dlp.
// POST /api/youtube/download   body: { url: "https://www.youtube.com/watch?v=..." }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/youtube/download", requireAuth, async (req, res, next) => {
  let targetPath = null;
  try {
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

    const ytdlpCommon = {
      noWarnings: true,
      noCheckCertificates: true,
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

    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({
      downloaded: true,
      name: path.basename(targetPath),
      bytes: stats.size,
      durationSeconds,
      title: rawTitle,
      destination: "Uploads"
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
