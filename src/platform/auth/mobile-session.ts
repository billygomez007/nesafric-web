import { NextResponse } from "next/server";

import { createSessionRecord, type PasswordSessionGuard } from "./session";

/**
 * The one mobile sign-in response (`MobileSessionResponse` in the app), shared by password, Google
 * and one-time-code sign-in: an ordinary `Session` (hashed at rest, 14-day expiry, revoked by
 * `POST /api/auth/logout`) whose opaque token is returned once, in this body, for the app's secure
 * storage. Never cached, never logged. `email` is null for a phone-only account.
 */
export async function mobileSessionResponse(user: { id: string; email: string | null; phoneE164?: string | null; displayName: string }, guard?: PasswordSessionGuard) {
  const { session, token } = await createSessionRecord(user.id, undefined, guard);
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
