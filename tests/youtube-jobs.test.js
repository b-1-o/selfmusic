import test from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, createDatabase } from "../server/database.js";
import { createYoutubeJob } from "../server/youtube-jobs.js";

test("creates durable YouTube jobs and sanitizes metadata overrides", () => {
  const db = createDatabase(":memory:");
  try {
    const job = createYoutubeJob(db, {}, "user-1", {
      videoId: "abcdefghijk",
      bitrate: "128k",
      metadata: {
        title: "  My Title\nUnsafe Line  ",
        artist: "Example Artist",
        year: "2024; rm -rf /",
        unsupported: "ignored"
      }
    });
    assert.equal(job.status, "queued");
    assert.equal(job.progress, 0);
    assert.equal(job.bitrate, "128k");
    assert.equal(job.url, "https://www.youtube.com/watch?v=abcdefghijk");
    const row = db.prepare("SELECT user_id, metadata_json FROM youtube_jobs WHERE id = ?").get(job.id);
    assert.equal(row.user_id, "user-1");
    const metadata = JSON.parse(row.metadata_json);
    assert.equal(metadata.title, "My Title Unsafe Line");
    assert.equal(metadata.artist, "Example Artist");
    assert.equal(metadata.year, undefined);
    assert.equal(metadata.unsupported, undefined);
  } finally {
    closeDatabase(db);
  }
});

test("rejects non-YouTube hosts, insecure URLs, playlists, and invalid bitrates", () => {
  const db = createDatabase(":memory:");
  try {
    assert.throws(() => createYoutubeJob(db, {}, "admin-1", { url: "https://example.com/watch?v=abcdefghijk" }), { code: "INVALID_YOUTUBE_URL" });
    assert.throws(() => createYoutubeJob(db, {}, "admin-1", { url: "http://youtube.com/watch?v=abcdefghijk" }), { code: "INVALID_YOUTUBE_URL" });
    assert.throws(() => createYoutubeJob(db, {}, "admin-1", { url: "https://youtube.com/playlist?list=abcdefghijk" }), { code: "INVALID_YOUTUBE_URL" });
    assert.throws(() => createYoutubeJob(db, {}, "admin-1", { videoId: "invalid" }), { code: "INVALID_YOUTUBE_URL" });
    assert.throws(() => createYoutubeJob(db, {}, "admin-1", { videoId: "abcdefghijk", bitrate: "8k" }), { code: "INVALID_YOUTUBE_BITRATE" });
  } finally {
    closeDatabase(db);
  }
});

test("limits the number of active download jobs", () => {
  const db = createDatabase(":memory:");
  try {
    for (let index = 0; index < 3; index += 1) {
      db.prepare("INSERT INTO youtube_jobs(id, user_id, status, progress, url, bitrate) VALUES (?, ?, 'queued', 0, ?, '192k')").run(
        "job-" + index, "user-1", "https://www.youtube.com/watch?v=abcdefghijk"
      );
    }
    assert.throws(() => createYoutubeJob(db, {}, "user-1", { videoId: "abcdefghijk" }), { code: "YOUTUBE_QUEUE_FULL" });
  } finally {
    closeDatabase(db);
  }
});
