import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getTrackRow, scanLibrary } from "./library.js";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const BITRATES = new Set(["64k", "96k", "128k", "160k", "192k", "256k", "320k"]);
let workerRunning = false;
let workerContext = null;

function normalizeVideoUrl(body) {
  const videoId = typeof body?.videoId === "string" ? body.videoId.trim() : "";
  let input = typeof body?.url === "string" ? body.url.trim() : "";
  if (!input && videoId) {
    if (!VIDEO_ID.test(videoId)) {
      const error = new Error("videoId must be a valid 11-character YouTube ID.");
      error.code = "INVALID_YOUTUBE_URL";
      throw error;
    }
    input = "https://www.youtube.com/watch?v=" + videoId;
  }
  if (!input || input.length > 2048) {
    const error = new Error("Provide a YouTube URL or videoId.");
    error.code = "INVALID_YOUTUBE_URL";
    throw error;
  }

  let parsed;
  try { parsed = new URL(input); } catch {
    const error = new Error("The YouTube URL is invalid.");
    error.code = "INVALID_YOUTUBE_URL";
    throw error;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port ||
      !(host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com"))) {
    const error = new Error("Only HTTPS URLs from youtube.com and youtu.be are supported.");
    error.code = "INVALID_YOUTUBE_URL";
    throw error;
  }
  let id = "";
  if (host === "youtu.be") id = parsed.pathname.split("/").filter(Boolean)[0] || "";
  else id = parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).find((part) => VIDEO_ID.test(part)) || "";
  if (!VIDEO_ID.test(id)) {
    const error = new Error("The URL must point to one YouTube video, not a channel or playlist.");
    error.code = "INVALID_YOUTUBE_URL";
    throw error;
  }
  return "https://www.youtube.com/watch?v=" + id;
}

function cleanMetadata(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const output = {};
  for (const key of ["title", "artist", "album", "genre", "year"]) {
    const raw = input[key];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, key === "title" ? 200 : 120);
    if (!value) continue;
    if (key === "year") {
      const year = Number.parseInt(value, 10);
      if (Number.isInteger(year) && year >= 1800 && year <= 2200) output.year = String(year);
    } else output[key] = value;
  }
  return Object.keys(output).length ? output : null;
}

function sanitizeName(value) {
  let name = String(value || "YouTube audio")
    .normalize("NFKC")
    .replace(/[\/\\\x00-\x1f\x7f<>:"|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 140);
  if (!name || name === "." || name === "..") name = "YouTube audio";
  return name;
}

function publicJob(row) {
  return {
    id: row.id,
    status: row.status,
    progress: Number(row.progress) || 0,
    url: row.url,
    title: row.title || null,
    trackId: row.track_id || null,
    bitrate: row.bitrate || "192k",
    error: row.error_code ? { code: row.error_code, message: row.error_message || "Download failed." } : null,
    result: row.result_json ? safelyParseJson(row.result_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function safelyParseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function updateJob(db, id, fields) {
  const current = db.prepare("SELECT status, progress, title, track_id, error_code, error_message, result_json FROM youtube_jobs WHERE id = ?").get(id);
  if (!current) return;
  const next = {
    status: fields.status ?? current.status,
    progress: fields.progress ?? current.progress,
    title: fields.title ?? current.title,
    trackId: fields.trackId === undefined ? current.track_id : fields.trackId,
    errorCode: fields.errorCode === undefined ? current.error_code : fields.errorCode,
    errorMessage: fields.errorMessage === undefined ? current.error_message : fields.errorMessage,
    resultJson: fields.result === undefined ? current.result_json : JSON.stringify(fields.result)
  };
  db.prepare(`
    UPDATE youtube_jobs SET status = ?, progress = ?, title = ?, track_id = ?,
      error_code = ?, error_message = ?, result_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(next.status, next.progress, next.title, next.trackId, next.errorCode, next.errorMessage, next.resultJson, id);
}

function runProcess(binary, args, { timeoutMs, maxOutputBytes = 8 * 1024 * 1024, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let lastProgress = -1;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const error = new Error("The YouTube processing task exceeded its time limit.");
      error.code = "YOUTUBE_TIMEOUT";
      finish(error);
    }, timeoutMs);
    const consume = (chunk, streamName) => {
      const text = chunk.toString("utf8");
      if (streamName === "stdout") stdout = (stdout + text).slice(-maxOutputBytes);
      else stderr = (stderr + text).slice(-maxOutputBytes);
      const progressText = stdout + "\n" + stderr;
      for (const match of progressText.matchAll(/(?:\[download\]\s*)?(\d{1,3}(?:\.\d+)?)\s*%/g)) {
        const value = Math.min(99, Math.max(0, Number(match[1])));
        if (Number.isFinite(value) && value > lastProgress) {
          lastProgress = value;
          onProgress?.(value);
        }
      }
    };
    child.stdout.on("data", (chunk) => consume(chunk, "stdout"));
    child.stderr.on("data", (chunk) => consume(chunk, "stderr"));
    child.on("error", (error) => {
      const wrapped = new Error(error.code === "ENOENT" ? "yt-dlp was not found. Install yt-dlp and FFmpeg, or set YT_DLP_PATH." : "Could not start yt-dlp.");
      wrapped.code = error.code === "ENOENT" ? "YTDLP_MISSING" : "YOUTUBE_START_FAILED";
      finish(wrapped);
    });
    child.on("close", (code, signal) => {
      if (code === 0) return finish(null, { stdout, stderr });
      const combined = (stderr + "\n" + stdout).toLowerCase();
      let codeName = "YOUTUBE_DOWNLOAD_FAILED";
      let message = "yt-dlp could not download or convert this video.";
      if (/private video|members.only|sign in to confirm|age.restricted/.test(combined)) {
        codeName = "YOUTUBE_RESTRICTED";
        message = "This video requires authorization or is age restricted. Only use content you are authorized to access.";
      } else if (/not available in your country|geo.restricted|blocked in your country/.test(combined)) {
        codeName = "YOUTUBE_REGION_BLOCKED";
        message = "This video is not available in the server's region.";
      } else if (/copyright|unavailable due to a copyright claim/.test(combined)) {
        codeName = "YOUTUBE_COPYRIGHT_BLOCKED";
        message = "This video is unavailable because of a copyright restriction.";
      } else if (/ffmpeg.*not found|ffmpeg is not installed/.test(combined)) {
        codeName = "FFMPEG_MISSING";
        message = "FFmpeg is required to convert the audio to MP3.";
      } else if (signal === "SIGKILL") {
        codeName = "YOUTUBE_TIMEOUT";
        message = "The download or conversion exceeded its time limit.";
      }
      const error = new Error(message);
      error.code = codeName;
      error.details = (stderr || stdout).slice(-2000);
      finish(error);
    });
  });
}

async function runFfmpegMetadata(outputPath, metadata, jobDir) {
  if (!metadata || !Object.keys(metadata).length) return;
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const tempPath = path.join(jobDir, "retag-" + crypto.randomUUID() + ".mp3");
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", outputPath, "-map", "0:a:0", "-c:a", "copy", "-id3v2_version", "3"];
  for (const key of ["title", "artist", "album", "year", "genre"]) {
    if (metadata[key]) args.push("-metadata", (key === "year" ? "date" : key) + "=" + metadata[key]);
  }
  args.push(tempPath);
  try {
    await runProcess(ffmpeg, args, { timeoutMs: 120000, maxOutputBytes: 20000 });
    await fs.unlink(outputPath);
    await fs.rename(tempPath, outputPath);
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

async function runOneJob(db, config, row) {
  const jobId = row.id;
  const ytdlp = process.env.YT_DLP_PATH || (process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  const musicRoot = path.resolve(config.musicRoot);
  const uploadRoot = path.join(musicRoot, "Uploads");
  await fs.mkdir(uploadRoot, { recursive: true });
  const jobTemp = path.join(config.workDir, "youtube", jobId);
  await fs.mkdir(jobTemp, { recursive: true });
  const url = normalizeVideoUrl({ url: row.url });
  updateJob(db, jobId, { status: "running", progress: 1, errorCode: null, errorMessage: null });

  let outputPath = null;
  try {
    const infoArgs = ["--no-warnings", "--no-playlist", "--dump-single-json", "--skip-download", "--no-colors", url];
    const cookiePath = path.join(config.projectRoot, "cookies.txt");
    try { await fs.access(cookiePath); infoArgs.splice(infoArgs.length - 1, 0, "--cookies", cookiePath); } catch {}
    const infoResult = await runProcess(ytdlp, infoArgs, { timeoutMs: 60000, maxOutputBytes: 6 * 1024 * 1024 });
    const info = JSON.parse(infoResult.stdout);
    const durationSeconds = Number(info?.duration || 0);
    const maxDuration = Math.max(1, Number.parseInt(process.env.YOUTUBE_MAX_DURATION_SECONDS || "3600", 10) || 3600);
    if (Number.isFinite(durationSeconds) && durationSeconds > maxDuration) {
      const error = new Error("This video is longer than the configured maximum of " + Math.round(maxDuration / 60) + " minutes.");
      error.code = "YOUTUBE_TOO_LONG";
      throw error;
    }

    const inputMetadata = safelyParseJson(row.metadata_json) || {};
    const effectiveMetadata = cleanMetadata({
      title: inputMetadata.title || String(info.title || "YouTube audio"),
      artist: inputMetadata.artist || info.artist || info.uploader || info.channel || "",
      album: inputMetadata.album || info.album || "",
      year: inputMetadata.year || info.release_year || info.upload_date?.slice?.(0, 4) || "",
      genre: inputMetadata.genre || (Array.isArray(info.categories) ? info.categories[0] : "")
    });
    const title = effectiveMetadata?.title || String(info.title || "YouTube audio");
    updateJob(db, jobId, { progress: 2, title });

    const stem = sanitizeName(title);
    let suffix = 1;
    while (suffix < 10000) {
      const candidate = path.join(uploadRoot, stem + (suffix === 1 ? "" : " (" + suffix + ")") + ".mp3");
      try { await fs.access(candidate); suffix += 1; } catch { outputPath = candidate; break; }
    }
    if (!outputPath) throw new Error("Could not reserve a destination filename.");

    const outputTemplate = path.join(uploadRoot, path.basename(outputPath, ".mp3") + ".%(ext)s");
    const bitrate = BITRATES.has(String(row.bitrate || "").toLowerCase()) ? String(row.bitrate).toLowerCase() : "192k";
    const args = [
      "--no-warnings", "--no-playlist", "--newline", "--progress", "--no-colors",
      "--extract-audio", "--audio-format", "mp3", "--audio-quality", bitrate.toUpperCase(),
      "--embed-metadata", "--embed-thumbnail", "--write-thumbnail", "--convert-thumbnails", "jpg",
      "-o", outputTemplate
    ];
    if (await fs.stat(cookiePath).then(() => true).catch(() => false)) args.unshift("--cookies", cookiePath);
    args.push(url);
    const result = await runProcess(ytdlp, args, {
      timeoutMs: 20 * 60 * 1000,
      maxOutputBytes: 200000,
      onProgress: (value) => updateJob(db, jobId, { progress: Math.min(95, 2 + value * 0.9) })
    });
    void result;

    const expected = await fs.stat(outputPath);
    if (!expected.isFile() || expected.size < 1) {
      const error = new Error("yt-dlp finished without producing an MP3 file.");
      error.code = "YOUTUBE_EMPTY_OUTPUT";
      throw error;
    }
    await runFfmpegMetadata(outputPath, effectiveMetadata, jobTemp);
    const finalStats = await fs.stat(outputPath);

    const relativePath = path.relative(musicRoot, outputPath);
    if (!relativePath || relativePath.startsWith(".." + path.sep) || path.isAbsolute(relativePath)) {
      const error = new Error("Refusing a destination outside MUSIC_DIR.");
      error.code = "INVALID_OUTPUT_PATH";
      throw error;
    }
    await scanLibrary(db, musicRoot, { coverCacheDir: config.coverCacheDir, force: true });
    const trackId = Buffer.from(relativePath).toString("base64url");
    const track = getTrackRow(db, trackId);
    const resultPayload = {
      name: path.basename(outputPath),
      bytes: finalStats.size,
      durationSeconds,
      title,
      artist: effectiveMetadata?.artist || "",
      album: effectiveMetadata?.album || "",
      destination: "MUSIC_DIR/Uploads"
    };
    updateJob(db, jobId, { status: "completed", progress: 100, title, trackId: track?.id || trackId, result: resultPayload });
    console.info("[SelfMusic] YouTube job completed", JSON.stringify({ jobId, trackId: track?.id || trackId, bytes: finalStats.size }));
  } catch (error) {
    if (outputPath) await fs.unlink(outputPath).catch(() => {});
    const code = String(error.code || "YOUTUBE_DOWNLOAD_FAILED");
    const message = String(error.message || "The YouTube download failed.").slice(0, 800);
    updateJob(db, jobId, { status: "failed", progress: 0, errorCode: code, errorMessage: message });
    console.warn("[SelfMusic] YouTube job failed", JSON.stringify({ jobId, code, message }));
  } finally {
    await fs.rm(jobTemp, { recursive: true, force: true }).catch(() => {});
  }
}

async function drainQueue() {
  if (workerRunning || !workerContext) return;
  workerRunning = true;
  const { db, config } = workerContext;
  try {
    while (true) {
      const next = db.prepare("SELECT * FROM youtube_jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1").get();
      if (!next) break;
      await runOneJob(db, config, next);
    }
  } catch (error) {
    console.error("[SelfMusic] YouTube queue worker failed", error.message);
  } finally {
    workerRunning = false;
    const pending = db.prepare("SELECT 1 AS found FROM youtube_jobs WHERE status = 'queued' LIMIT 1").get();
    if (pending) setImmediate(() => { void drainQueue(); });
  }
}

export function createYoutubeJob(db, config, userId, body = {}) {
  const url = normalizeVideoUrl(body);
  const bitrate = String(body.bitrate || process.env.DEFAULT_BITRATE || "192k").toLowerCase();
  if (!BITRATES.has(bitrate)) {
    const error = new Error("Supported MP3 bitrates are 64k, 96k, 128k, 160k, 192k, 256k and 320k.");
    error.code = "INVALID_YOUTUBE_BITRATE";
    throw error;
  }
  const metadata = cleanMetadata(body.metadata);
  const count = Number(db.prepare("SELECT COUNT(*) AS count FROM youtube_jobs WHERE status IN ('queued', 'running')").get().count);
  if (count >= 3) {
    const error = new Error("The YouTube queue is full. Wait for a current task to finish.");
    error.code = "YOUTUBE_QUEUE_FULL";
    throw error;
  }
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO youtube_jobs(id, user_id, status, progress, url, bitrate, metadata_json) VALUES (?, ?, 'queued', 0, ?, ?, ?)").run(
    id, String(userId), url, bitrate, metadata ? JSON.stringify(metadata) : null
  );
  setImmediate(() => { void drainQueue(); });
  return publicJob(db.prepare("SELECT * FROM youtube_jobs WHERE id = ?").get(id));
}

export function mountYoutubeJobRoutes(app, config) {
  const { db, requireAuth, requireAdmin } = config;
  const workerConfig = {
    projectRoot: path.resolve(config.projectRoot),
    musicRoot: path.resolve(config.musicRoot),
    coverCacheDir: path.resolve(config.coverCacheDir),
    workDir: path.resolve(config.workDir)
  };
  fs.mkdir(workerConfig.workDir, { recursive: true }).catch((error) => console.error("[SelfMusic] YouTube work directory failed", error.message));
  db.prepare("UPDATE youtube_jobs SET status = 'queued', progress = 0, updated_at = CURRENT_TIMESTAMP WHERE status = 'running'").run();
  workerContext = { db, config: workerConfig };

  app.post("/api/youtube/jobs", requireAuth, requireAdmin, (req, res) => {
    try {
      const job = createYoutubeJob(db, workerConfig, req.authUser.id, req.body || {});
      return res.status(202).json({ job });
    } catch (error) {
      const status = error.code === "INVALID_YOUTUBE_URL" || error.code === "INVALID_YOUTUBE_BITRATE" ? 400 : error.code === "YOUTUBE_QUEUE_FULL" ? 429 : 500;
      return res.status(status).json({ error: String(error.code || "youtube_job_failed").toLowerCase(), message: error.message || "Could not queue this download." });
    }
  });

  app.get("/api/youtube/status/:id", requireAuth, (req, res) => {
    const id = String(req.params.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "invalid_job_id" });
    const readJob = () => db.prepare("SELECT * FROM youtube_jobs WHERE id = ?").get(id) || null;
    const allowed = (job) => job && (job.user_id === req.authUser.id || req.authUser.role === "admin");
    const initial = readJob();
    if (!allowed(initial)) return res.status(404).json({ error: "job_not_found" });

    if (!String(req.get("accept") || "").includes("text/event-stream")) {
      res.setHeader("Cache-Control", "no-store");
      return res.json({ job: publicJob(initial) });
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    let closed = false;
    let timer;
    const writeStatus = () => {
      if (closed) return;
      const job = readJob();
      if (!allowed(job)) {
        res.write("event: error\ndata: {\"error\":\"job_not_found\"}\n\n");
        res.end();
        return finish();
      }
      res.write("event: status\ndata: " + JSON.stringify(publicJob(job)) + "\n\n");
      if (["completed", "failed", "cancelled"].includes(job.status)) {
        res.end();
        finish();
      }
    };
    const finish = () => {
      closed = true;
      clearInterval(timer);
      clearTimeout(timeout);
    };
    timer = setInterval(writeStatus, 900);
    const timeout = setTimeout(() => { if (!closed) { res.end(); finish(); } }, 25 * 60 * 1000);
    res.on("close", finish);
    writeStatus();
  });
}
