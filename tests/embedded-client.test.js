import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const readSource = (relativePath) => fs.readFile(new URL("../" + relativePath, import.meta.url), "utf8");

test("embedded SelfMusic clients use an exact origin allow-list and no wildcard CORS", async () => {
  const server = await readSource("server/index.js");
  assert.ok(server.includes("SELF_MUSIC_ALLOWED_ORIGINS"));
  assert.ok(server.includes('res.setHeader("Access-Control-Allow-Origin", origin)'));
  assert.ok(server.includes("configuredEmbeddedClientOrigins"));
  assert.ok(server.includes('if (req.method === "OPTIONS") return res.status(403).json({ error: "origin_not_allowed" })'));
  assert.ok(!server.includes('res.setHeader("Access-Control-Allow-Origin", "*")'));
});

test("embedded access tokens are separate, bearer-authenticated, and one-hour limited", async () => {
  const server = await readSource("server/index.js");
  assert.ok(server.includes('const bearer = authorization.match(/^Bearer\\s+([^\\s]+)$/i)'));
  assert.ok(server.includes('accessToken: embeddedClient ? createSessionToken(userId, 60 * 60) : undefined'));
  assert.ok(server.includes("setSessionCookie(req, res, createSessionToken(userId))"));
  assert.ok(server.includes("safeLifetimeSeconds = Math.max(60, Math.min(sessionLifetimeSeconds"));
  assert.ok(server.includes("revokedSessionTokens.set(token, expirySeconds * 1000)"));
  assert.ok(server.includes("revokedUntil > now"));
});

test("media tickets are restricted to one track, purpose, and expiration time", async () => {
  const server = await readSource("server/index.js");
  assert.ok(server.includes('app.post("/api/embed/media-tickets", requireAuth'));
  assert.ok(server.includes('["artwork", "stream"].includes(purpose)'));
  assert.ok(server.includes('ticket.purpose !== purpose || ticket.trackId !== req.params.id'));
  assert.ok(server.includes("ticket.expiresAt <= Date.now()"));
  assert.ok(server.includes("id.length > 2048 || id.includes"));
  assert.ok(server.includes('app.get("/api/artwork/:id", requireMediaAccess("artwork")'));
  assert.ok(server.includes('app.get("/api/stream/:id", requireMediaAccess("stream")'));
});
