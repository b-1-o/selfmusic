import crypto from "node:crypto";

function getKey() {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || "";
  if (secret.length < 32 || secret.toLowerCase().includes("replace-with")) {
    throw new Error("A persistent SESSION_SECRET of at least 32 characters is required to encrypt integration credentials.");
  }
  return crypto.scryptSync(secret, "SelfMusic integration secrets v1", 32);
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptSecret(value) {
  if (typeof value !== "string" || value.length < 40) throw new Error("Encrypted credential is invalid.");
  const bytes = Buffer.from(value, "base64url");
  const iv = bytes.subarray(0, 12);
  const tag = bytes.subarray(12, 28);
  const encrypted = bytes.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function constantTimeEqualText(a, b) {
  const left = crypto.createHash("sha256").update(String(a)).digest();
  const right = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}
