import test from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, createDatabase } from "../server/database.js";
import { readPlaybackState, savePlaybackState } from "../server/playback-sync.js";

function setup() {
  const db = createDatabase(":memory:");
  db.prepare("INSERT INTO tracks(id, relative_path, title) VALUES (?, ?, ?)").run("track-a", "a.mp3", "Track A");
  db.prepare("INSERT INTO tracks(id, relative_path, title) VALUES (?, ?, ?)").run("track-b", "b.mp3", "Track B");
  return db;
}

function snapshot(overrides = {}) {
  return {
    expectedRevision: 0,
    queue: ["track-a", "track-b"],
    currentTrackId: "track-a",
    positionSeconds: 12.5,
    isPlaying: true,
    repeatMode: "all",
    shuffle: false,
    sourceDeviceId: "phone",
    ...overrides
  };
}

test("playback state defaults to an empty revision-zero snapshot", () => {
  const db = setup();
  try {
    assert.deepEqual(readPlaybackState(db, "user-a"), {
      revision: 0,
      queue: [],
      currentTrackId: null,
      positionSeconds: 0,
      isPlaying: false,
      repeatMode: "off",
      shuffle: false,
      sourceDeviceId: null,
      updatedAt: null
    });
  } finally {
    closeDatabase(db);
  }
});

test("playback state is persisted per user and revision increments", () => {
  const db = setup();
  try {
    const first = savePlaybackState(db, "user-a", snapshot());
    assert.equal(first.ok, true);
    assert.equal(first.state.revision, 1);
    assert.deepEqual(first.state.queue, ["track-a", "track-b"]);
    assert.equal(first.state.currentTrackId, "track-a");
    assert.equal(first.state.positionSeconds, 12.5);
    assert.equal(first.state.sourceDeviceId, "phone");
    assert.equal(typeof first.state.updatedAt, "string");

    const second = savePlaybackState(db, "user-a", snapshot({
      expectedRevision: 1,
      positionSeconds: 24,
      sourceDeviceId: "laptop",
      isPlaying: false
    }));
    assert.equal(second.ok, true);
    assert.equal(second.state.revision, 2);
    assert.equal(second.state.positionSeconds, 24);
    assert.equal(second.state.isPlaying, false);
    assert.equal(readPlaybackState(db, "user-b").revision, 0);
    assert.deepEqual(readPlaybackState(db, "user-b").queue, []);
  } finally {
    closeDatabase(db);
  }
});

test("stale writes return a revision conflict without overwriting newer state", () => {
  const db = setup();
  try {
    assert.equal(savePlaybackState(db, "user-a", snapshot()).ok, true);
    const conflict = savePlaybackState(db, "user-a", snapshot({ positionSeconds: 44 }));
    assert.equal(conflict.ok, false);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.error, "revision_conflict");
    assert.equal(conflict.state.revision, 1);
    assert.equal(readPlaybackState(db, "user-a").positionSeconds, 12.5);
  } finally {
    closeDatabase(db);
  }
});

test("invalid queue references and playback fields are rejected", () => {
  const db = setup();
  try {
    const missingTrack = savePlaybackState(db, "user-a", snapshot({ queue: ["not-in-library"] }));
    assert.equal(missingTrack.ok, false);
    assert.equal(missingTrack.status, 400);
    assert.equal(missingTrack.error, "unknown_track");

    const missingCurrent = savePlaybackState(db, "user-a", snapshot({ currentTrackId: "track-b", queue: ["track-a"] }));
    assert.equal(missingCurrent.error, "invalid_current_track");

    const invalidRepeat = savePlaybackState(db, "user-a", snapshot({ repeatMode: "forever" }));
    assert.equal(invalidRepeat.error, "invalid_repeat_mode");

    const invalidRevision = savePlaybackState(db, "user-a", snapshot({ expectedRevision: -1 }));
    assert.equal(invalidRevision.error, "invalid_revision");
    assert.equal(readPlaybackState(db, "user-a").revision, 0);
  } finally {
    closeDatabase(db);
  }
});

test("playback queue size and position are bounded", () => {
  const db = setup();
  try {
    const tooLarge = savePlaybackState(db, "user-a", snapshot({ queue: Array(501).fill("track-a") }));
    assert.equal(tooLarge.error, "invalid_queue");
    const invalidPosition = savePlaybackState(db, "user-a", snapshot({ positionSeconds: 86401 }));
    assert.equal(invalidPosition.error, "invalid_position");
  } finally {
    closeDatabase(db);
  }
});
