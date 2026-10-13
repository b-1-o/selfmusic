import crypto from "node:crypto";
import fs from "node:fs";

const providers = new Map();

export function registerFingerprintProvider(name, provider) {
  const key = String(name || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(key)) {
    throw new TypeError("Fingerprint provider names must be 2–32 characters and start with a letter.");
  }
  if (!provider || typeof provider.compute !== "function") {
    throw new TypeError("A fingerprint provider must expose an async compute(filePath) function.");
  }
  if (providers.has(key)) {
    throw new Error("Fingerprint provider is already registered: " + key);
  }
  providers.set(key, provider);
  return () => providers.delete(key);
}

export function listFingerprintProviders() {
  return [...providers.keys()];
}

async function computeSha256(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

// Fingerprint providers return opaque strings. The persistent/API field remains
// sha256 for compatibility; secondary algorithms can be added without changing
// callers or existing duplicate-review endpoints.
registerFingerprintProvider("sha256", { compute: computeSha256 });

export async function getFileFingerprints(filePath, algorithms = ["sha256"]) {
  if (!Array.isArray(algorithms) || !algorithms.length) {
    throw new TypeError("Choose at least one fingerprint algorithm.");
  }
  const result = {};
  for (const rawAlgorithm of algorithms) {
    const algorithm = String(rawAlgorithm || "").trim().toLowerCase();
    const provider = providers.get(algorithm);
    if (!provider) {
      throw new Error("Fingerprint algorithm is not installed: " + algorithm);
    }
    const value = await provider.compute(filePath);
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("Fingerprint provider returned an empty or invalid value: " + algorithm);
    }
    result[algorithm] = value.trim();
  }
  return result;
}

export async function sha256File(filePath) {
  const fingerprints = await getFileFingerprints(filePath, ["sha256"]);
  return fingerprints.sha256;
}
