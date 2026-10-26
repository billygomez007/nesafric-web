import { createHash, randomBytes, timingSafeEqual } from "crypto";

import { lockAccount } from "@/platform/auth/account-lock";
import { newSessionData } from "@/platform/auth/session";
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
  // `createdAt` from the app clock, like `User.updatedAt` (set by the app on every write), so the
  // two can be compared at redemption.
  await db.mobileAuthHandoff.create({
    data: { codeHash: hashCode(code), userId, codeChallenge, createdAt: now, expiresAt: new Date(now.getTime() + MOBILE_HANDOFF_TTL_MS) },
  });
  return code;
}

/**
 * Redeems a handoff code for a mobile session, atomically, under the account lock (see
 * account-lock.ts): the code is consumed exactly once, the PKCE verifier is checked, and the
 * session is created in the same transaction — but only if the account hasn't changed since the
 * Google sign-in that issued the code. Every identity or credential change (a first-proof claim,
 * an email or phone link, a password change) writes the `User` row and so moves `updatedAt` past
 * the handoff's `createdAt`: such a handoff is stale and creates no session. A wrong verifier or a
 * stale handoff still burns the code.
 */
export async function redeemMobileHandoff(code: unknown, codeVerifier: unknown, now = new Date()) {
  if (typeof code !== "string" || code.length < 16 || code.length > 128 || !BASE64URL.test(code) || !isCodeVerifier(codeVerifier)) {
    throw invalidHandoff();
  }
  const codeHash = hashCode(code);
  const pending = await db.mobileAuthHandoff.findUnique({ where: { codeHash }, select: { userId: true } });
  if (!pending) throw invalidHandoff();
  const outcome = await db.$transaction(async (tx) => {
    await lockAccount(tx, pending.userId);
    const consumed = await tx.mobileAuthHandoff.updateMany({
      where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) return null;
    const handoff = await tx.mobileAuthHandoff.findUniqueOrThrow({ where: { codeHash }, include: { user: true } });
    const expected = Buffer.from(handoff.codeChallenge);
    const actual = Buffer.from(pkceChallenge(codeVerifier));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    if (handoff.user.updatedAt.getTime() > handoff.createdAt.getTime()) return null;
    const next = newSessionData(handoff.userId);
    const session = await tx.session.create({ data: next.data });
    return { user: handoff.user, session, token: next.token };
  });
  // Returning (not throwing) above commits the consumption, so a failed attempt still burns the code.
  if (!outcome) throw invalidHandoff();
  return outcome;
}
