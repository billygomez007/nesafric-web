import { createHash, randomBytes, timingSafeEqual } from "crypto";

import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { pkceChallenge } from "./google-oauth";

/**
 * One-time handoff from the shared Google callback (running in the system browser) to the native
 * app. The browser only ever carries this short-lived code — never a session token. The app
 * redeems it once, with the PKCE verifier only it holds, for an ordinary mobile `Session`.
 */
export const MOBILE_HANDOFF_TTL_MS = 2 * 60 * 1000;

/** base64url, 43 chars for a 32-byte S256 challenge; 43–128 chars for an RFC 7636 verifier. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;
export const isCodeChallenge = (value: unknown): value is string => typeof value === "string" && value.length === 43 && BASE64URL.test(value);
export const isCodeVerifier = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 43 && value.length <= 128 && BASE64URL.test(value);
/** The app's own anti-injection state: 16–128 base64url chars. */
export const isAppState = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 16 && value.length <= 128 && BASE64URL.test(value);

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

const invalidHandoff = () =>
  new AppError("INVALID_HANDOFF", 400, "This Google sign-in has expired or was already used. Please try again.");

export async function createMobileHandoff(userId: string, codeChallenge: string, now = new Date()) {
  if (!isCodeChallenge(codeChallenge)) throw invalidHandoff();
  const code = randomBytes(32).toString("base64url");
  // Opportunistic cleanup keeps the table to a handful of rows without a separate job.
  await db.mobileAuthHandoff.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - MOBILE_HANDOFF_TTL_MS) } } });
  await db.mobileAuthHandoff.create({
    data: { codeHash: hashCode(code), userId, codeChallenge, expiresAt: new Date(now.getTime() + MOBILE_HANDOFF_TTL_MS) },
  });
  return code;
}

/**
 * Consumes a handoff code exactly once (atomic conditional update, so two concurrent redemptions
 * can't both succeed), then checks the PKCE verifier. A wrong verifier still burns the code.
 */
export async function redeemMobileHandoff(code: unknown, codeVerifier: unknown, now = new Date()) {
  if (typeof code !== "string" || code.length < 16 || code.length > 128 || !BASE64URL.test(code) || !isCodeVerifier(codeVerifier)) {
    throw invalidHandoff();
  }
  const codeHash = hashCode(code);
  const consumed = await db.mobileAuthHandoff.updateMany({
    where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) throw invalidHandoff();
  const handoff = await db.mobileAuthHandoff.findUnique({ where: { codeHash }, include: { user: true } });
  if (!handoff) throw invalidHandoff();
  const expected = Buffer.from(handoff.codeChallenge);
  const actual = Buffer.from(pkceChallenge(codeVerifier));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalidHandoff();
  return handoff.user;
}
