import { NextResponse } from "next/server";

import { createSessionRecord, type PasswordSessionGuard } from "./session";

/**
 * The one mobile sign-in response (`MobileSessionResponse` in the app), shared by password, Google
 * and one-time-code sign-in: an ordinary `Session` (hashed at rest, 14-day expiry, revoked by
 * `POST /api/auth/logout`) whose opaque token is returned once, in this body, for the app's secure
 * storage. Never cached, never logged. `email` is null for a phone-only account.
 */
type MobileUser = { id: string; email: string | null; phoneE164?: string | null; displayName: string };

export async function mobileSessionResponse(user: MobileUser, guard?: PasswordSessionGuard) {
  const { session, token } = await createSessionRecord(user.id, undefined, guard);
  return mobileSessionJson(user, session, token);
}

/** The same response for a session already created by the caller (e.g. inside its own transaction). */
export function mobileSessionJson(user: MobileUser, session: { expiresAt: Date }, token: string) {
  return NextResponse.json(
    {
      token,
      tokenType: "Bearer",
      expiresAt: session.expiresAt,
      user: { id: user.id, email: user.email, phone: user.phoneE164 ?? null, displayName: user.displayName },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
