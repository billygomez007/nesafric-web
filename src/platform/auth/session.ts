import { createHash, randomBytes } from "crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/platform/database/client";
import { unauthenticated } from "@/platform/errors";

const COOKIE_NAME = "propertyos_session";
const sessionDurationMs = 1000 * 60 * 60 * 24 * 14;
export const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSessionRecord(userId: string, token = randomBytes(32).toString("base64url")) {
  const session = await db.session.create({ data: { userId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + sessionDurationMs) } });
  return { session, token };
}

export async function createSession(userId: string) {
  const { token } = await createSessionRecord(userId);
  const store = await cookies();
  store.set(COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: sessionDurationMs / 1000 });
}

/**
 * Extracts a session token from an `Authorization: Bearer <token>` header value. Native mobile
 * clients authenticate with the same opaque, hashed-at-rest session tokens the web keeps in its
 * httpOnly cookie (issued by `POST /api/auth/mobile/session`). Browsers never attach this header
 * automatically, so accepting it adds no CSRF surface. Anything that isn't a well-formed
 * base64url token is ignored.
 */
export function parseBearerToken(value: string | null | undefined) {
  const match = /^Bearer ([A-Za-z0-9_-]{16,256})$/i.exec(value?.trim() ?? "");
  return match?.[1] ?? null;
}

/** The request's session token: the web cookie when present (web behaviour unchanged), otherwise a mobile bearer token. */
async function readSessionToken() {
  const cookieToken = (await cookies()).get(COOKIE_NAME)?.value;
  if (cookieToken) return cookieToken;
  return parseBearerToken((await headers()).get("authorization"));
}

export async function getOptionalUser() {
  const token = await readSessionToken();
  if (!token) return null;
  const session = await db.session.findFirst({
    where: { tokenHash: hashSessionToken(token), expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  return session?.user ?? null;
}

/** Invalidates the caller's server-side session record (cookie or mobile bearer token), so a
 * captured token can't remain usable after logout. Safe to call with no active session. */
export async function destroySession() {
  const token = await readSessionToken();
  if (token) await db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

export async function requireUser() {
  const user = await getOptionalUser();
  if (!user) throw unauthenticated();
  return user;
}
