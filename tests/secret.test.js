import test from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret } from "../server/secret.js";

test("encrypts and decrypts integration secrets using a persistent environment key", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-secret-for-unit-tests-with-more-than-32-characters";
  try {
    const clear = "lastfm-session-key-do-not-store-plaintext";
    const encrypted = encryptSecret(clear);
    assert.notEqual(encrypted, clear);
    assert.equal(decryptSecret(encrypted), clear);
    process.env.SESSION_SECRET = "a-different-test-secret-with-more-than-32-characters";
    assert.throws(() => decryptSecret(encrypted));
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});
