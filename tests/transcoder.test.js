import test from "node:test";
import assert from "node:assert/strict";
import { originalSupportsFormat, parseTranscodeOptions, transcodeCacheKey } from "../server/transcoder.js";

test("validates formats and bitrates before invoking FFmpeg", () => {
  assert.equal(parseTranscodeOptions("mp3", "128k").codec, "libmp3lame");
  assert.equal(parseTranscodeOptions("opus", "96k").mimeType, "audio/ogg");
  assert.equal(parseTranscodeOptions("aac", "256k").extension, ".aac");
  assert.throws(() => parseTranscodeOptions("wav", "128k"), { code: "INVALID_TRANSCODE_FORMAT" });
  assert.throws(() => parseTranscodeOptions("mp3", "8k"), { code: "INVALID_TRANSCODE_BITRATE" });
  assert.throws(() => parseTranscodeOptions("../mp3", "128k"), { code: "INVALID_TRANSCODE_FORMAT" });
});

test("skips transcode when the original extension already matches the requested format", () => {
  assert.equal(originalSupportsFormat("/music/song.mp3", "mp3"), true);
  assert.equal(originalSupportsFormat("/music/song.opus", "opus"), true);
  assert.equal(originalSupportsFormat("/music/song.m4a", "aac"), false);
  assert.equal(originalSupportsFormat("/music/song.mp3", "aac"), false);
});

test("transcode cache keys change with source content and output preferences", () => {
  const base = { id: "track_1", sha256: "abc123", size_bytes: 1024, mtime_ms: 55 };
  assert.equal(transcodeCacheKey(base, { format: "mp3", bitrate: "128k" }), transcodeCacheKey({ ...base }, { format: "mp3", bitrate: "128k" }));
  assert.notEqual(transcodeCacheKey(base, { format: "mp3", bitrate: "128k" }), transcodeCacheKey(base, { format: "mp3", bitrate: "192k" }));
  assert.notEqual(transcodeCacheKey(base, { format: "mp3", bitrate: "128k" }), transcodeCacheKey({ ...base, sha256: "different" }, { format: "mp3", bitrate: "128k" }));
});
