import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const FORMAT_CONFIG = {
  mp3: { codec: "libmp3lame", extension: ".mp3", mimeType: "audio/mpeg" },
  opus: { codec: "libopus", extension: ".opus", mimeType: "audio/ogg" },
  aac: { codec: "aac", extension: ".aac", mimeType: "audio/aac" }
};
const ALLOWED_BITRATES = new Set(["32k", "48k", "64k", "96k", "112k", "128k", "160k", "192k", "224k", "256k", "320k"]);
const inFlight = new Map();

export function parseTranscodeOptions(format, bitrate) {
  const normalizedFormat = String(format || "").toLowerCase();
  if (!Object.hasOwn(FORMAT_CONFIG, normalizedFormat)) {
    const error = new Error("Supported formats are mp3, opus and aac.");
    error.code = "INVALID_TRANSCODE_FORMAT";
    throw error;
  }
  const normalizedBitrate = String(bitrate || process.env.DEFAULT_BITRATE || "192k").toLowerCase();
  if (!ALLOWED_BITRATES.has(normalizedBitrate)) {
    const error = new Error("Choose a supported bitrate from 32k to 320k.");
    error.code = "INVALID_TRANSCODE_BITRATE";
    throw error;
  }
  return { format: normalizedFormat, bitrate: normalizedBitrate, ...FORMAT_CONFIG[normalizedFormat] };
}

export function originalSupportsFormat(filePath, format) {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  if (format === "mp3") return extension === ".mp3";
  if (format === "opus") return extension === ".opus";
  if (format === "aac") return extension === ".aac";
  return false;
}

export function transcodeCacheKey(track, options) {
  const identity = String(track.sha256 || track.relative_path || track.id || "");
  const material = [identity, track.size_bytes ?? "", track.mtime_ms ?? "", options.format, options.bitrate].join("\0");
  return crypto.createHash("sha256").update(material).digest("hex");
}

function runFfmpeg(inputPath, outputPath, options) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
    const args = [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-i", inputPath,
      "-map", "0:a:0", "-vn",
      "-c:a", options.codec, "-b:a", options.bitrate,
      "-map_metadata", "0"
    ];
    if (options.format === "aac") args.push("-f", "adts");
    else if (options.format === "opus") args.push("-f", "ogg");
    args.push(outputPath);
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const error = new Error("Audio transcoding exceeded the 20-minute limit.");
      error.code = "TRANSCODE_TIMEOUT";
      finish(error);
    }, 20 * 60 * 1000);
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-6000);
    });
    child.on("error", (error) => {
      const wrapped = new Error(error.code === "ENOENT" ? "FFmpeg is not installed or FFMPEG_PATH is invalid." : "Could not start FFmpeg.");
      wrapped.code = error.code === "ENOENT" ? "FFMPEG_MISSING" : "TRANSCODE_START_FAILED";
      finish(wrapped);
    });
    child.on("close", (code) => {
      if (code === 0) return finish();
      const error = new Error("FFmpeg failed to transcode this track.");
      error.code = "TRANSCODE_FAILED";
      error.details = stderr;
      finish(error);
    });
  });
}

export async function getTranscodedFile(db, track, sourcePath, cacheDir, options) {
  if (process.env.TRANSCODE_ENABLED !== "true") {
    const error = new Error("Transcoding is disabled. Set TRANSCODE_ENABLED=true in .env and restart SelfMusic.");
    error.code = "TRANSCODE_DISABLED";
    throw error;
  }
  const normalized = parseTranscodeOptions(options.format, options.bitrate);
  const cacheRoot = path.resolve(cacheDir);
  await fs.mkdir(cacheRoot, { recursive: true });
  const key = transcodeCacheKey(track, normalized);
  const outputPath = path.join(cacheRoot, key + normalized.extension);
  const cached = db.prepare("SELECT file_path FROM transcode_cache WHERE cache_key = ?").get(key);

  if (cached && path.resolve(cached.file_path) === outputPath && outputPath.startsWith(cacheRoot + path.sep)) {
    try {
      const stats = await fs.lstat(outputPath);
      if (stats.isFile() && !stats.isSymbolicLink() && stats.size > 0) {
        db.prepare("UPDATE transcode_cache SET accessed_at = CURRENT_TIMESTAMP WHERE cache_key = ?").run(key);
        return { filePath: outputPath, stats, options: normalized, cacheHit: true };
      }
    } catch {
      // Remove stale database references and regenerate the cache object.
    }
  }

  if (inFlight.has(key)) {
    await inFlight.get(key);
    const stats = await fs.stat(outputPath);
    return { filePath: outputPath, stats, options: normalized, cacheHit: true };
  }

  const generation = (async () => {
    const temporaryPath = path.join(cacheRoot, key + "." + crypto.randomUUID() + ".tmp" + normalized.extension);
    try {
      await runFfmpeg(sourcePath, temporaryPath, normalized);
      const stats = await fs.stat(temporaryPath);
      if (!stats.isFile() || stats.size < 1) {
        const error = new Error("FFmpeg produced an empty audio file.");
        error.code = "TRANSCODE_EMPTY";
        throw error;
      }
      await fs.rename(temporaryPath, outputPath);
      const finalStats = await fs.stat(outputPath);
      db.prepare(`
        INSERT INTO transcode_cache(cache_key, track_id, format, bitrate, file_path, size_bytes, accessed_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(cache_key) DO UPDATE SET
          file_path = excluded.file_path, size_bytes = excluded.size_bytes,
          accessed_at = CURRENT_TIMESTAMP
      `).run(key, track.id, normalized.format, normalized.bitrate, outputPath, finalStats.size);
      return finalStats;
    } finally {
      await fs.unlink(temporaryPath).catch(() => {});
    }
  })();
  inFlight.set(key, generation);
  try {
    const stats = await generation;
    return { filePath: outputPath, stats, options: normalized, cacheHit: false };
  } finally {
    inFlight.delete(key);
  }
}

export function transcodingEnabled() {
  return process.env.TRANSCODE_ENABLED === "true";
}
