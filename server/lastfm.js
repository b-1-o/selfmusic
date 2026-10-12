import crypto from "node:crypto";
import { decryptSecret, encryptSecret } from "./secret.js";
import { getTrackRow } from "./library.js";

function apiConfig() {
  const apiKey = String(process.env.LASTFM_API_KEY || "").trim();
  const apiSecret = String(process.env.LASTFM_API_SECRET || "").trim();
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}

function lastfmSignature(params, secret) {
  const body = Object.keys(params)
    .filter((key) => key !== "format" && key !== "callback" && key !== "api_sig")
    .sort()
    .map((key) => key + String(params[key]))
    .join("") + secret;
  return crypto.createHash("md5").update(body, "utf8").digest("hex");
}

async function callLastFm(params, includeSignature = true) {
  const config = apiConfig();
  if (!config) {
    const error = new Error("Set LASTFM_API_KEY and LASTFM_API_SECRET to enable Last.fm.");
    error.code = "LASTFM_NOT_CONFIGURED";
    throw error;
  }
  const payload = { ...params, api_key: config.apiKey, format: "json" };
  if (includeSignature) payload.api_sig = lastfmSignature(payload, config.apiSecret);
  const url = new URL("https://ws.audioscrobbler.com/2.0/");
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "SelfMusic/0.1 (self-hosted scrobbler)" } });
  let result;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (!response.ok || !result || result.error || result.session?.key === undefined && result.token === undefined && result.scrobbles === undefined && result.nowplaying === undefined && params.method !== "auth.getToken") {
    const message = String(result?.message || result?.error || "Last.fm did not accept the request.");
    const error = new Error(message);
    error.code = "LASTFM_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return result;
}

function safeText(value, maximum = 300) {
  return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, maximum) : "";
}

function getAccount(db, userId) {
  const account = db.prepare("SELECT session_key AS sessionKey, username FROM lastfm_accounts WHERE user_id = ?").get(userId);
  if (!account) return null;
  try {
    return { ...account, sessionKey: decryptSecret(account.sessionKey) };
  } catch {
    return null;
  }
}

async function publishScrobble(db, userId, payload) {
  const account = getAccount(db, userId);
  if (!account) return false;
  await callLastFm({
    method: "track.scrobble",
    sk: account.sessionKey,
    artist: payload.artist,
    track: payload.track,
    album: payload.album || undefined,
    timestamp: payload.timestamp,
    duration: payload.duration || undefined
  });
  return true;
}

export function mountLastFmRoutes(app, { db, requireAuth }) {
  app.get("/api/lastfm/status", requireAuth, (req, res) => {
    const account = db.prepare("SELECT username, connected_at AS connectedAt FROM lastfm_accounts WHERE user_id = ?").get(req.authUser.id);
    res.setHeader("Cache-Control", "no-store");
    res.json({ configured: Boolean(apiConfig()), connected: Boolean(account), account: account || null });
  });

  app.post("/api/lastfm/connect", requireAuth, async (req, res) => {
    try {
      const config = apiConfig();
      if (!config) return res.status(503).json({ error: "lastfm_not_configured", message: "Set LASTFM_API_KEY and LASTFM_API_SECRET in .env, then restart SelfMusic." });
      const tokenResult = await callLastFm({ method: "auth.getToken" }, false);
      const token = String(tokenResult?.token || "");
      if (!/^[A-Za-z0-9]{8,256}$/.test(token)) return res.status(502).json({ error: "lastfm_invalid_token", message: "Last.fm did not return a valid authorization token." });
      const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString().replace("T", " ").replace("Z", "");
      db.prepare("INSERT INTO lastfm_pending_auth(user_id, token, expires_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, created_at = CURRENT_TIMESTAMP, expires_at = excluded.expires_at").run(req.authUser.id, token, expiry);

      let callbackUrl = String(process.env.LASTFM_CALLBACK_URL || "").trim();
      if (!callbackUrl) {
        const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
        const proto = String(req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0].trim().toLowerCase();
        if (!host || !["http", "https"].includes(proto) || /[\r\n@]/.test(host)) {
          return res.status(400).json({ error: "lastfm_callback_required", message: "Set LASTFM_CALLBACK_URL to your SelfMusic public HTTPS callback URL." });
        }
        callbackUrl = new URL("/api/lastfm/callback", proto + "://" + host).toString();
      }
      const authUrl = new URL("https://www.last.fm/api/auth/");
      authUrl.searchParams.set("api_key", config.apiKey);
      authUrl.searchParams.set("token", token);
      authUrl.searchParams.set("cb", callbackUrl);
      res.json({ authUrl: authUrl.toString(), expiresInSeconds: 900 });
    } catch (error) {
      console.error("[SelfMusic] Last.fm connect failed", error.message);
      res.status(error.code === "LASTFM_NOT_CONFIGURED" ? 503 : 502).json({
        error: error.code === "LASTFM_NOT_CONFIGURED" ? "lastfm_not_configured" : "lastfm_connect_failed",
        message: error.message || "Could not start Last.fm authorization."
      });
    }
  });

  app.get("/api/lastfm/callback", requireAuth, async (req, res) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const pending = db.prepare("SELECT token, expires_at AS expiresAt FROM lastfm_pending_auth WHERE user_id = ?").get(req.authUser.id);
      if (!pending || !token || pending.token !== token || Date.parse(pending.expiresAt + "Z") < Date.now()) {
        return res.status(400).send("Last.fm authorization expired or does not match this signed-in account. Return to SelfMusic and connect again.");
      }
      const result = await callLastFm({ method: "auth.getSession", token });
      const sessionKey = String(result?.session?.key || "");
      const username = safeText(String(result?.session?.name || ""), 100);
      if (!sessionKey) return res.status(502).send("Last.fm did not return a session. Return to SelfMusic and try again.");
      const encrypted = encryptSecret(sessionKey);
      db.prepare("INSERT INTO lastfm_accounts(user_id, session_key, username) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET session_key = excluded.session_key, username = excluded.username, connected_at = CURRENT_TIMESTAMP").run(req.authUser.id, encrypted, username || null);
      db.prepare("DELETE FROM lastfm_pending_auth WHERE user_id = ?").run(req.authUser.id);
      console.info("[SelfMusic] Last.fm connected", JSON.stringify({ userId: req.authUser.id, username }));
      return res.redirect(303, "/?lastfm=connected");
    } catch (error) {
      console.error("[SelfMusic] Last.fm callback failed", error.message);
      return res.status(502).send("Could not finish Last.fm authorization. Return to SelfMusic and try again.");
    }
  });

  app.delete("/api/lastfm/connect", requireAuth, (req, res) => {
    db.prepare("DELETE FROM lastfm_accounts WHERE user_id = ?").run(req.authUser.id);
    db.prepare("DELETE FROM scrobble_queue WHERE user_id = ?").run(req.authUser.id);
    db.prepare("DELETE FROM lastfm_pending_auth WHERE user_id = ?").run(req.authUser.id);
    res.status(204).end();
  });

  app.post("/api/lastfm/now-playing", requireAuth, async (req, res) => {
    try {
      const account = getAccount(db, req.authUser.id);
      if (!account) return res.status(409).json({ error: "lastfm_not_connected", message: "Connect Last.fm from your profile first." });
      const trackId = typeof req.body?.trackId === "string" ? req.body.trackId : "";
      const track = trackId ? getTrackRow(db, trackId) : null;
      const artist = safeText(req.body?.artist || track?.artist);
      const title = safeText(req.body?.track || track?.title);
      const album = safeText(req.body?.album || track?.album);
      const duration = Math.floor(Number(req.body?.durationSeconds ?? track?.duration ?? 0));
      if (!artist || !title) return res.status(400).json({ error: "invalid_track_metadata", message: "Artist and track title are required." });
      await callLastFm({
        method: "track.updateNowPlaying",
        sk: account.sessionKey,
        artist,
        track: title,
        album: album || undefined,
        duration: Number.isFinite(duration) && duration > 0 ? duration : undefined
      });
      res.json({ accepted: true });
    } catch (error) {
      console.warn("[SelfMusic] Last.fm now-playing failed", error.message);
      res.status(502).json({ error: "lastfm_unavailable", message: "Last.fm is temporarily unavailable." });
    }
  });

  app.post("/api/lastfm/scrobble", requireAuth, async (req, res) => {
    try {
      const account = getAccount(db, req.authUser.id);
      if (!account) return res.status(409).json({ error: "lastfm_not_connected", message: "Connect Last.fm from your profile first." });
      const trackId = typeof req.body?.trackId === "string" ? req.body.trackId : "";
      const track = trackId ? getTrackRow(db, trackId) : null;
      if (!track) return res.status(404).json({ error: "track_not_found" });
      const duration = Number(track.duration || req.body?.durationSeconds || 0);
      const listened = Number(req.body?.listenedSeconds);
      if (!Number.isFinite(listened) || listened < 0 || !Number.isFinite(duration) || duration <= 0) {
        return res.status(400).json({ error: "invalid_playback_progress" });
      }
      if (listened <= duration * 0.5 && listened <= 240) {
        return res.json({ queued: false, reason: "scrobble_threshold_not_reached" });
      }
      const payload = {
        artist: safeText(track.artist),
        track: safeText(track.title),
        album: safeText(track.album),
        duration: Math.floor(duration),
        timestamp: Math.floor(Date.now() / 1000)
      };
      const inserted = db.prepare("INSERT INTO scrobble_queue(user_id, payload_json) VALUES (?, ?)").run(req.authUser.id, JSON.stringify(payload));
      res.status(202).json({ queued: true, id: Number(inserted.lastInsertRowid) });
      queueMicrotask(() => { flushQueue(db).catch((error) => console.warn("[SelfMusic] Last.fm queue flush failed", error.message)); });
    } catch (error) {
      console.error("[SelfMusic] Last.fm scrobble enqueue failed", error.message);
      res.status(502).json({ error: "lastfm_unavailable", message: "Could not queue this scrobble." });
    }
  });
}

export async function flushQueue(db, limit = 20) {
  const rows = db.prepare("SELECT id, user_id AS userId, payload_json AS payloadJson, attempts FROM scrobble_queue WHERE next_attempt_at <= CURRENT_TIMESTAMP ORDER BY id LIMIT ?").all(limit);
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payloadJson);
      const delivered = await publishScrobble(db, row.userId, payload);
      if (delivered) {
        db.prepare("DELETE FROM scrobble_queue WHERE id = ?").run(row.id);
      } else {
        db.prepare("UPDATE scrobble_queue SET attempts = attempts + 1, next_attempt_at = datetime('now', '+15 minutes'), last_error = ? WHERE id = ?").run("No Last.fm connection exists for this user.", row.id);
      }
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      const delaySeconds = Math.min(6 * 60 * 60, 60 * Math.pow(2, Math.min(attempts, 8)));
      db.prepare("UPDATE scrobble_queue SET attempts = attempts + 1, next_attempt_at = datetime('now', ?), last_error = ? WHERE id = ?").run("+" + delaySeconds + " seconds", String(error.message || "Last.fm failed").slice(0, 500), row.id);
    }
  }
  return { processed: rows.length };
}
