import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeDatabase, createDatabase } from "../server/database.js";
import { getTracks, listAlbums, listArtists, scanLibrary } from "../server/library.js";

test("scans nested music folders into artist, album and searchable track rows", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "selfmusic-library-"));
  const musicRoot = path.join(temp, "music");
  const trackPath = path.join(musicRoot, "Example Artist", "Night Album", "01 - Moonlight.mp3");
  await fs.mkdir(path.dirname(trackPath), { recursive: true });
  await fs.writeFile(trackPath, Buffer.alloc(0));
  const db = createDatabase(":memory:");
  try {
    const tracks = await scanLibrary(db, musicRoot, { coverCacheDir: path.join(temp, "artwork") });
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].title, "Moonlight");
    assert.equal(tracks[0].artist, "Example Artist");
    assert.equal(tracks[0].album, "Night Album");
    assert.equal(tracks[0].codec, "mp3");
    assert.match(tracks[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(getTracks(db, { q: "moonlight" }).length, 1);
    assert.equal(listArtists(db).length, 1);
    assert.equal(listArtists(db)[0].name, "Example Artist");
    assert.equal(listAlbums(db).length, 1);
    assert.equal(listAlbums(db)[0].title, "Night Album");

    await scanLibrary(db, musicRoot, { coverCacheDir: path.join(temp, "artwork") });
    assert.equal(getTracks(db).length, 1, "rescanning unchanged files must not duplicate database records");
  } finally {
    closeDatabase(db);
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test("rejects malformed search patterns safely", () => {
  const db = createDatabase(":memory:");
  try {
    assert.deepEqual(getTracks(db, { q: "%" }), []);
    assert.deepEqual(getTracks(db, { q: "_" }), []);
  } finally {
    closeDatabase(db);
  }
});
