const PREFERENCE_KEYS = new Set(["appearance", "dismissed-playback"]);
const MAX_APPEARANCE_JSON_LENGTH = 1_600_000;
const MAX_WALLPAPER_DATA_URL_LENGTH = 1_450_000;
const WALLPAPER_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeAppearance(value) {
  const clean = {};
  const enums = {
    accent: ["rose", "ocean", "violet", "amber", "silver", "custom"],
    glass: ["liquid", "soft", "solid"],
    theme: ["dark", "light", "system"],
    density: ["compact", "comfortable"],
    navPosition: ["auto", "left", "right", "bottom"],
    backgroundPreset: ["midnight", "fog", "dawn", "neon", "minimal"],
    animationSpeed: ["slow", "normal", "fast"],
  };
  for (const [key, options] of Object.entries(enums)) {
    if (options.includes(value[key])) clean[key] = value[key];
  }
  if (typeof value.accentColor === "string" && /^#[0-9a-f]{6}$/i.test(value.accentColor)) clean.accentColor = value.accentColor;
  for (const [key, min, max] of [
    ["hue", 0, 359], ["saturation", 0, 100], ["value", 0, 100],
    ["glassOpacity", 35, 96], ["glassBlur", 0, 36], ["cornerRadius", 10, 32],
    ["wallpaperDim", 5, 85], ["wallpaperBlur", 0, 18],
  ]) {
    if (Number.isFinite(value[key]) && value[key] >= min && value[key] <= max) clean[key] = value[key];
  }
  if (typeof value.animations === "boolean") clean.animations = value.animations;
  if (typeof value.wallpaperDataUrl === "string" && value.wallpaperDataUrl.length <= MAX_WALLPAPER_DATA_URL_LENGTH &&
      (value.wallpaperDataUrl === "" || WALLPAPER_DATA_URL.test(value.wallpaperDataUrl))) {
    clean.wallpaperDataUrl = value.wallpaperDataUrl;
  } else if (value.wallpaperDataUrl !== undefined) {
    return { error: "invalid_wallpaper", message: "Wallpaper must be a PNG, JPEG, or WebP data URL within the storage limit." };
  }
  return { value: clean };
}

function normalizePreference(key, input) {
  if (!PREFERENCE_KEYS.has(key)) return { status: 404, error: "unknown_preference", message: "That preference is not supported." };
  if (!isPlainObject(input)) return { status: 400, error: "invalid_preference", message: "Preference value must be a JSON object." };
  let serialized;
  try { serialized = JSON.stringify(input); } catch {
    return { status: 400, error: "invalid_preference", message: "Preference value is not valid JSON." };
  }
  if (serialized.length > MAX_APPEARANCE_JSON_LENGTH) {
    return { status: 413, error: "preference_too_large", message: "Preference data is too large to store." };
  }
  if (key === "appearance") return sanitizeAppearance(input);
  const keys = input.keys;
  if (!Array.isArray(keys) || keys.length > 100 || keys.some((item) => typeof item !== "string" || item.length > 512)) {
    return { status: 400, error: "invalid_dismissals", message: "Playback dismissals must contain at most 100 short keys." };
  }
  return { value: { keys: [...new Set(keys)].slice(-100) } };
}

function readPreferences(db, userId) {
  const rows = db.prepare("SELECT preference_key AS preferenceKey, value_json AS valueJson FROM user_preferences WHERE user_id = ?").all(String(userId));
  const preferences = {};
  for (const row of rows) {
    try { preferences[row.preferenceKey] = JSON.parse(row.valueJson); } catch { /* Ignore an invalid preference row. */ }
  }
  return preferences;
}

export function mountUserPreferenceRoutes(app, { db, requireAuth }) {
  app.get("/api/preferences", requireAuth, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ preferences: readPreferences(db, req.authUser?.id || "legacy") });
  });

  app.get("/api/preferences/:key", requireAuth, (req, res) => {
    if (!PREFERENCE_KEYS.has(req.params.key)) {
      return res.status(404).json({ error: "unknown_preference", message: "That preference is not supported." });
    }
    const preferences = readPreferences(db, req.authUser?.id || "legacy");
    res.setHeader("Cache-Control", "no-store");
    return res.json({ key: req.params.key, value: preferences[req.params.key] ?? null });
  });

  app.put("/api/preferences/:key", requireAuth, (req, res) => {
    const normalized = normalizePreference(req.params.key, req.body?.value);
    if (normalized.error) {
      const { status, ...body } = normalized;
      return res.status(status || 400).json(body);
    }
    try {
      const userId = String(req.authUser?.id || "legacy");
      db.prepare(`
        INSERT INTO user_preferences(user_id, preference_key, value_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, preference_key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `).run(userId, req.params.key, JSON.stringify(normalized.value), new Date().toISOString());
      res.setHeader("Cache-Control", "no-store");
      return res.json({ key: req.params.key, value: normalized.value });
    } catch {
      return res.status(500).json({ error: "preference_save_failed", message: "Preference could not be saved." });
    }
  });
}
