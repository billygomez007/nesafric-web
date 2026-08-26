import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
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

export async function getOptionalUser() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await db.session.findFirst({
    where: { tokenHash: hashSessionToken(token), expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getOptionalUser();
  if (!user) throw unauthenticated();
  return user;
}
