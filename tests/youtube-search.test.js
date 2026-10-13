import test from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, createDatabase, latestMigrationVersion } from "../server/database.js";
import {
  extractVideoId,
  isAllowedYoutubeVideoUrl,
  parseIsoDuration,
  maskApiKey,
  markAlreadyInLibrary,
  searchYouTube,
  getApiState,
  isApiEnabled,
} from "../server/youtube-search.js";

test("extractVideoId parses common YouTube URL formats", () => {
  assert.equal(extractVideoId("abcdefghijk"), "abcdefghijk");
  assert.equal(extractVideoId("https://youtu.be/abcdefghijk"), "abcdefghijk");
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=abcdefghijk"), "abcdefghijk");
  assert.equal(extractVideoId("https://m.youtube.com/watch?v=abcdefghijk&list=PLxx"), "abcdefghijk");
  assert.equal(extractVideoId("https://music.youtube.com/watch?v=abcdefghijk"), "abcdefghijk");
  assert.equal(extractVideoId("https://www.youtube.com/shorts/abcdefghijk"), "abcdefghijk");
  assert.equal(extractVideoId("https://www.youtube.com/embed/abcdefghijk"), "abcdefghijk");
  assert.equal(extractVideoId("https://example.com/watch?v=abcdefghijk"), null);
  assert.equal(extractVideoId("https://www.youtube.com/playlist?list=PLxx"), null);
  assert.equal(extractVideoId("not a url"), null);
});

test("isAllowedYoutubeVideoUrl rejects non-YouTube hosts", () => {
  assert.equal(isAllowedYoutubeVideoUrl("https://youtu.be/abcdefghijk"), true);
  assert.equal(isAllowedYoutubeVideoUrl("https://evil.com/abcdefghijk"), false);
});

test("parseIsoDuration converts ISO-8601 durations", () => {
  assert.equal(parseIsoDuration("PT3M45S"), 225);
  assert.equal(parseIsoDuration("PT1H2M3S"), 3723);
  assert.equal(parseIsoDuration("PT90S"), 90);
  assert.equal(parseIsoDuration(""), 0);
  assert.equal(parseIsoDuration(null), 0);
});

test("maskApiKey never returns the full key", () => {
  assert.equal(maskApiKey(null), "(none)");
  assert.equal(maskApiKey("short"), "AIza****");
  const masked = maskApiKey("AIzaSyDummyKeyValueXYZ");
  assert.ok(masked.startsWith("AIza"));
  assert.ok(masked.includes("****"));
  assert.ok(!masked.includes("DummyKeyValue"));
});

test("migration v9 is applied and youtube_search_cache exists", () => {
  const db = createDatabase(":memory:");
  try {
    assert.ok(latestMigrationVersion(db) >= 9);
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'youtube_search_cache'")
      .get();
    assert.equal(table.name, "youtube_search_cache");
    const col = db
      .prepare("SELECT name FROM pragma_table_info('tracks') WHERE name = 'youtube_video_id'")
      .get();
    assert.equal(col.name, "youtube_video_id");
  } finally {
    closeDatabase(db);
  }
});

test("migration v9 is idempotent when reopening the database", () => {
  const db = createDatabase(":memory:");
  try {
    const version1 = latestMigrationVersion(db);
    assert.ok(version1 >= 9);
    const count = db.prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE version = 9").get().c;
    assert.equal(count, 1);
  } finally {
    closeDatabase(db);
  }
});

test("markAlreadyInLibrary uses youtube_video_id set without N+1", () => {
  const db = createDatabase(":memory:");
  try {
    db.prepare(
      `INSERT INTO tracks (id, relative_path, title, artist, album, size_bytes, mtime_ms, youtube_video_id)
       VALUES ('t1', 'a.mp3', 'Song', 'Artist', 'Album', 1, 1, 'abcdefghijk')`
    ).run();
    const items = [
      { videoId: "abcdefghijk", title: "A", channel: "C", channelId: "", duration: 1, thumbnail: "", publishedAt: "", url: "https://youtu.be/abcdefghijk", alreadyInLibrary: false },
      { videoId: "otherid0001", title: "B", channel: "C", channelId: "", duration: 1, thumbnail: "", publishedAt: "", url: "https://youtu.be/otherid0001", alreadyInLibrary: false },
    ];
    const marked = markAlreadyInLibrary(db, items);
    assert.equal(marked[0].alreadyInLibrary, true);
    assert.equal(marked[1].alreadyInLibrary, false);
  } finally {
    closeDatabase(db);
  }
});

test("searchYouTube rejects short or long queries", async () => {
  await assert.rejects(() => searchYouTube("a"), { code: "INVALID_QUERY" });
  await assert.rejects(() => searchYouTube("x".repeat(201)), { code: "INVALID_QUERY" });
});

test("getApiState reports disabled when no key is set", () => {
  const prev = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  try {
    assert.equal(isApiEnabled(), false);
    const state = getApiState();
    assert.equal(state.apiEnabled, false);
    assert.equal(state.source, "yt-dlp");
  } finally {
    if (prev !== undefined) process.env.YOUTUBE_API_KEY = prev;
  }
});

const hasKey = Boolean(process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_API_KEY.trim());
(hasKey ? test : test.skip)("integration: YouTube Data API returns results with duration", async () => {
  const result = await searchYouTube("lofi hip hop radio", { limit: 5, musicOnly: true });
  assert.ok(result.items.length > 0 && result.items.length <= 5);
  assert.ok(result.source === "api" || result.source === "yt-dlp");
  for (const item of result.items) {
    assert.match(item.videoId, /^[A-Za-z0-9_-]{11}$/);
    assert.ok(item.title.length > 0);
    assert.ok(typeof item.duration === "number");
    if (result.source === "api") {
      assert.ok(item.thumbnail.startsWith("http"));
    }
  }
});
