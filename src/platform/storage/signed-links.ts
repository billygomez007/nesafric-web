import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signing/verification for the local & in-memory adapters' "signed temporary access URL"
 * implementation. This gives local/dev/test environments a real, working signed-URL contract
 * (HMAC + expiry) with the same shape as an S3 presigned URL, rather than a stub string.
 */
function secret() {
  const configured = process.env.STORAGE_LOCAL_SIGNING_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (configured) return configured;
  // A hardcoded fallback here would make locally-stored signed URLs forgeable using a secret
  // published in this very repository. Only acceptable outside production, where a fixed
  // deterministic secret keeps local/dev/test signed URLs reproducible without any env setup.
  if (process.env.NODE_ENV === "production") throw new Error("STORAGE_LOCAL_SIGNING_SECRET or SESSION_SECRET must be configured in production.");
  return "propertyos-local-storage-signing-secret";
}

function safeEqual(expected: string, actual: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signLocalObjectToken(key: string, expiresAtEpochMs: number) {
  return createHmac("sha256", secret()).update(`${key}:${expiresAtEpochMs}`).digest("hex");
}

export function verifyLocalObjectToken(key: string, token: string, expiresAtEpochMs: number) {
  if (!Number.isFinite(expiresAtEpochMs) || Date.now() > expiresAtEpochMs) return { verified: false as const, reason: "expired" as const };
  const expected = signLocalObjectToken(key, expiresAtEpochMs);
  if (!safeEqual(expected, token)) return { verified: false as const, reason: "invalid-signature" as const };
  return { verified: true as const };
}

/** Builds the relative signed-URL path served by `/api/storage/local/[...key]`. */
export function buildLocalSignedUrl(key: string, expiresInSeconds: number) {
  const expiresAtEpochMs = Date.now() + expiresInSeconds * 1000;
  const token = signLocalObjectToken(key, expiresAtEpochMs);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `/api/storage/local/${encodedKey}?expires=${expiresAtEpochMs}&token=${token}`;
}

/** Builds the unauthenticated public-media path served by `/api/public/media/[...key]`, used when an adapter cannot produce a durable public URL itself. */
export function buildInternalPublicMediaUrl(key: string) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `/api/public/media/${encodedKey}`;
}
