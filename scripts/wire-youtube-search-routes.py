#!/usr/bin/env python3
from pathlib import Path
path = Path("server/index.js")
text = path.read_text(encoding="utf-8")
original = text
old_imp = 'import { createYoutubeJob, mountYoutubeJobRoutes } from "./youtube-jobs.js";\n'
new_imp = old_imp + 'import { mountYoutubeSearchRoutes, isApiEnabled, purgeExpiredSearchCache } from "./youtube-routes.js";\n'
if old_imp not in text:
    raise SystemExit("ERROR: youtube-jobs import not found")
if "youtube-routes.js" not in text:
    text = text.replace(old_imp, new_imp, 1)
text = text.replace("const youtubeSearchCache = new Map();\n", "", 1)
anchor = (
    'mountYoutubeJobRoutes(app, { db, requireAuth, requireAdmin, projectRoot, '
    'musicRoot, coverCacheDir, workDir: path.join(projectRoot, "data") });\n'
)
mount_block = (
    anchor
    + "mountYoutubeSearchRoutes(app, { db, requireAuth });\n"
    + "try {\n"
    + "  purgeExpiredSearchCache(db);\n"
    + "} catch (error) {\n"
    + '  console.warn("[SelfMusic] youtube search cache purge skipped:", error.message);\n'
    + "}\n"
    + "const youtubeCachePurgeTimer = setInterval(() => {\n"
    + "  try { purgeExpiredSearchCache(db); } catch (error) {\n"
    + '    console.warn("[SelfMusic] youtube search cache purge failed:", error.message);\n'
    + "  }\n"
    + "}, 60 * 60 * 1000);\n"
    + "youtubeCachePurgeTimer.unref();\n"
)
if "mountYoutubeSearchRoutes(app" not in text:
    if anchor not in text:
        raise SystemExit("ERROR: mountYoutubeJobRoutes anchor not found")
    text = text.replace(anchor, mount_block, 1)
old_health = '  res.json({ ok: true, app: "SelfMusic", configured: isConfigured(), version: "0.1.0" });\n'
new_health = (
    "  res.json({\n"
    "    ok: true,\n"
    '    app: "SelfMusic",\n'
    "    configured: isConfigured(),\n"
    '    version: "0.1.0",\n'
    "    youtube_api_enabled: isApiEnabled(),\n"
    "  });\n"
)
if "youtube_api_enabled" not in text:
    if old_health not in text:
        raise SystemExit("ERROR: /api/health body not found")
    text = text.replace(old_health, new_health, 1)
start = text.find("function pruneYoutubeSearchCache")
end = text.find("async function ensureYoutubeArtwork")
if start != -1 and end != -1 and start < end:
    text = (
        text[:start]
        + "// YouTube search routes: mountYoutubeSearchRoutes (POST canonical; GET deprecated).\n\n"
        + text[end:]
    )
elif 'app.get("/api/youtube/search"' in text and "mountYoutubeSearchRoutes" in text:
    raise SystemExit("ERROR: legacy GET still present")
if text == original:
    raise SystemExit("ERROR: no changes applied")
path.write_text(text, encoding="utf-8")
print("OK bytes", len(text.encode("utf-8")))
print("mount", text.count("mountYoutubeSearchRoutes"))
print("health_flag", "youtube_api_enabled" in text)
print("legacy_prune", "function pruneYoutubeSearchCache" in text)
print("inline_GET", 'app.get("/api/youtube/search"' in text)
