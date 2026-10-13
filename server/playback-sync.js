const MAX_QUEUE_ITEMS = 500;
const MAX_POSITION_SECONDS = 24 * 60 * 60;
const REPEAT_MODES = new Set(["off", "one", "all"]);

function asState(row) {
  if (!row) {
    return {
      revision: 0,
      queue: [],
      currentTrackId: null,
      positionSeconds: 0,
      isPlaying: false,
      repeatMode: "off",
      shuffle: false,
      sourceDeviceId: null,
      updatedAt: null
    };
  }

  let queue = [];
  try {
    const parsed = JSON.parse(row.queueJson);
    if (Array.isArray(parsed)) queue = parsed;
  } catch {
    // A damaged queue should not prevent the rest of the account from loading.
  }

  return {
    revision: Number(row.revision),
    queue,
    currentTrackId: row.currentTrackId || null,
    positionSeconds: Number(row.positionSeconds || 0),
    isPlaying: Boolean(row.isPlaying),
    repeatMode: row.repeatMode,
    shuffle: Boolean(row.shuffle),
    sourceDeviceId: row.sourceDeviceId || null,
    updatedAt: row.updatedAt || null
  };
}

export function readPlaybackState(db, userId) {
  const row = db.prepare(`
    SELECT revision, queue_json AS queueJson, current_track_id AS currentTrackId,
      position_seconds AS positionSeconds, is_playing AS isPlaying,
      repeat_mode AS repeatMode, shuffle, source_device_id AS sourceDeviceId,
      updated_at AS updatedAt
    FROM playback_states WHERE user_id = ?
  `).get(String(userId));
  return asState(row);
}

function validatePlaybackInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "invalid_body", message: "Provide a playback-state JSON object." };
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    return { error: "invalid_revision", message: "expectedRevision must be a non-negative integer." };
  }
  if (!Array.isArray(input.queue) || input.queue.length > MAX_QUEUE_ITEMS) {
    return { error: "invalid_queue", message: "queue must be an array with no more than 500 track IDs." };
  }
  if (input.queue.some((id) => typeof id !== "string" || id.length < 1 || id.length > 2048)) {
    return { error: "invalid_queue", message: "Every queue item must be a valid track ID string." };
  }
  const currentTrackId = input.currentTrackId === "" || input.currentTrackId === undefined
    ? null
    : input.currentTrackId;
  if (currentTrackId !== null && (typeof currentTrackId !== "string" || currentTrackId.length > 2048)) {
    return { error: "invalid_current_track", message: "currentTrackId must be a track ID or null." };
  }
  if (currentTrackId !== null && !input.queue.includes(currentTrackId)) {
    return { error: "invalid_current_track", message: "currentTrackId must be present in queue." };
  }
  if (!Number.isFinite(input.positionSeconds) || input.positionSeconds < 0 || input.positionSeconds > MAX_POSITION_SECONDS) {
    return { error: "invalid_position", message: "positionSeconds must be between 0 and 86400." };
  }
  if (typeof input.isPlaying !== "boolean") {
    return { error: "invalid_playing_state", message: "isPlaying must be a boolean." };
  }
  if (!REPEAT_MODES.has(input.repeatMode)) {
    return { error: "invalid_repeat_mode", message: "repeatMode must be off, one, or all." };
  }
  if (typeof input.shuffle !== "boolean") {
    return { error: "invalid_shuffle", message: "shuffle must be a boolean." };
  }
  const sourceDeviceId = input.sourceDeviceId == null ? null : input.sourceDeviceId;
  if (sourceDeviceId !== null && (typeof sourceDeviceId !== "string" || sourceDeviceId.length < 1 || sourceDeviceId.length > 128)) {
    return { error: "invalid_device_id", message: "sourceDeviceId must be a string of at most 128 characters." };
  }

  return {
    value: {
      expectedRevision: input.expectedRevision,
      queue: [...input.queue],
      currentTrackId,
      positionSeconds: input.positionSeconds,
      isPlaying: input.isPlaying,
      repeatMode: input.repeatMode,
      shuffle: input.shuffle,
      sourceDeviceId
    }
  };
}

/**
 * Store one user's current playback snapshot with optimistic concurrency.
 * Track references are validated against the indexed library before writes.
 */
export function savePlaybackState(db, userId, input) {
  const normalized = validatePlaybackInput(input);
  if (normalized.error) return { ok: false, status: 400, error: normalized.error, message: normalized.message };
  const value = normalized.value;
  const distinctTrackIds = [...new Set(value.queue)];
  if (distinctTrackIds.length) {
    const placeholders = distinctTrackIds.map(() => "?").join(",");
    const rows = db.prepare(`SELECT id FROM tracks WHERE id IN (${placeholders})`).all(...distinctTrackIds);
    const known = new Set(rows.map((row) => row.id));
    const missing = distinctTrackIds.filter((id) => !known.has(id));
    if (missing.length) {
      return { ok: false, status: 400, error: "unknown_track", message: "The queue contains track IDs that are not in the library.", missingTrackIds: missing.slice(0, 10) };
    }
  }

  const ownerId = String(userId);
  db.exec("BEGIN IMMEDIATE;");
  try {
    const current = readPlaybackState(db, ownerId);
    if (current.revision !== value.expectedRevision) {
      db.exec("ROLLBACK;");
      return { ok: false, status: 409, error: "revision_conflict", message: "Playback state changed on another device.", state: current };
    }

    const updatedAt = new Date().toISOString();
    const revision = current.revision + 1;
    db.prepare(`
      INSERT INTO playback_states (
        user_id, revision, queue_json, current_track_id, position_seconds,
        is_playing, repeat_mode, shuffle, source_device_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        revision = excluded.revision,
        queue_json = excluded.queue_json,
        current_track_id = excluded.current_track_id,
        position_seconds = excluded.position_seconds,
        is_playing = excluded.is_playing,
        repeat_mode = excluded.repeat_mode,
        shuffle = excluded.shuffle,
        source_device_id = excluded.source_device_id,
        updated_at = excluded.updated_at
    `).run(
      ownerId,
      revision,
      JSON.stringify(value.queue),
      value.currentTrackId,
      value.positionSeconds,
      value.isPlaying ? 1 : 0,
      value.repeatMode,
      value.shuffle ? 1 : 0,
      value.sourceDeviceId,
      updatedAt
    );
    db.exec("COMMIT;");
    return { ok: true, state: readPlaybackState(db, ownerId) };
  } catch (error) {
    try { db.exec("ROLLBACK;"); } catch {}
    throw error;
  }
}

export function mountPlaybackSyncRoutes(app, { db, requireAuth }) {
  const clientsByUser = new Map();

  function publish(userId, state) {
    const clients = clientsByUser.get(String(userId));
    if (!clients) return;
    const message = "event: playback-state\ndata: " + JSON.stringify(state) + "\n\n";
    for (const response of clients) {
      try {
        if (!response.writableEnded && !response.destroyed) response.write(message);
        else clients.delete(response);
      } catch {
        clients.delete(response);
      }
    }
    if (!clients.size) clientsByUser.delete(String(userId));
  }

  app.get("/api/playback/state", requireAuth, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ state: readPlaybackState(db, req.authUser?.id || "legacy") });
  });

  app.put("/api/playback/state", requireAuth, (req, res) => {
    try {
      const userId = String(req.authUser?.id || "legacy");
      const result = savePlaybackState(db, userId, req.body);
      if (!result.ok) {
        if (result.state) publish(userId, result.state);
        const { status, ...body } = result;
        return res.status(status).json(body);
      }
      publish(userId, result.state);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ state: result.state });
    } catch (error) {
      return res.status(500).json({ error: "playback_state_failed", message: "Playback state could not be saved." });
    }
  });

  app.get("/api/playback/events", requireAuth, (req, res) => {
    const userId = String(req.authUser?.id || "legacy");
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write("retry: 3000\n\n");
    res.write("event: playback-state\ndata: " + JSON.stringify(readPlaybackState(db, userId)) + "\n\n");

    let clients = clientsByUser.get(userId);
    if (!clients) {
      clients = new Set();
      clientsByUser.set(userId, clients);
    }
    clients.add(res);

    const heartbeat = setInterval(() => {
      try {
        if (res.writableEnded || res.destroyed) return clearInterval(heartbeat);
        res.write(": keep-alive\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);
    heartbeat.unref?.();

    const cleanup = () => {
      clearInterval(heartbeat);
      const current = clientsByUser.get(userId);
      current?.delete(res);
      if (current && !current.size) clientsByUser.delete(userId);
    };
    res.on("close", cleanup);
  });
}
