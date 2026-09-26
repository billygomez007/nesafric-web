import { NextResponse } from "next/server";

import { authenticateUser } from "@/modules/identity/service";
import { assertLoginNotRateLimited, recordLoginAttempt } from "@/platform/auth/rate-limit";
import { createSessionRecord } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";

export const maxDuration = 30;

/**
 * Mobile sign-in. Same credential check and per-email lockout as `POST /api/auth/login`, and the
 * same `Session` record (hashed at rest, 14-day expiry, revoked by `POST /api/auth/logout` or a
 * password change) — but the opaque token is returned once in this response body for the app's
 * secure storage instead of being set as a cookie. The token is never logged.
 */
export async function POST(request: Request) {
  let email: unknown;
  try {
    const body = await request.json().catch(() => null);
    email = body?.email;
    await assertLoginNotRateLimited(email);
    const user = await authenticateUser(body);
    await recordLoginAttempt(email, true);
    const { session, token } = await createSessionRecord(user.id);
    return NextResponse.json(
      {
        token,
        tokenType: "Bearer",
        expiresAt: session.expiresAt,
        user: { id: user.id, email: user.email, displayName: user.displayName },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Count wrong credentials towards the lockout, exactly like the web login route.
    if (!(error instanceof AppError) || error.code !== "LOGIN_RATE_LIMITED") {
      await recordLoginAttempt(email, false).catch(() => undefined);
    }
    return errorResponse(error);
  }
}
