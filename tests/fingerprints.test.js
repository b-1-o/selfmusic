import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getFileFingerprints,
  listFingerprintProviders,
  registerFingerprintProvider,
  sha256File
} from "../server/fingerprints.js";

test("SHA-256 fingerprint provider preserves the exact file hash contract", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "selfmusic-fingerprint-"));
  const filePath = path.join(directory, "track.mp3");
  const bytes = Buffer.from("SelfMusic fingerprint interface test");
  try {
    await fs.writeFile(filePath, bytes);
    const expected = crypto.createHash("sha256").update(bytes).digest("hex");
    assert.equal(await sha256File(filePath), expected);
    assert.deepEqual(await getFileFingerprints(filePath), { sha256: expected });
    assert.ok(listFingerprintProviders().includes("sha256"));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("secondary fingerprint providers can be added without changing the exact-hash API", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "selfmusic-fingerprint-"));
  const filePath = path.join(directory, "track.mp3");
  const bytes = Buffer.from("provider interface");
  const removeProvider = registerFingerprintProvider("test-provider", {
    async compute(targetPath) {
      return "test:" + (await fs.readFile(targetPath, "utf8"));
    }
  });
  try {
    await fs.writeFile(filePath, bytes);
    assert.deepEqual(await getFileFingerprints(filePath, ["sha256", "test-provider"]), {
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      "test-provider": "test:provider interface"
    });
    assert.equal(await sha256File(filePath), crypto.createHash("sha256").update(bytes).digest("hex"));
    assert.throws(() => registerFingerprintProvider("test-provider", { compute: async () => "duplicate" }), /already registered/);
    await assert.rejects(() => getFileFingerprints(filePath, ["chromaprint"]), /not installed/);
  } finally {
    removeProvider();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
