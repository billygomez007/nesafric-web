import { accountState } from "@/platform/auth/account-lock";
import { authenticateUser } from "@/modules/identity/service";
import { mobileSessionResponse } from "@/platform/auth/mobile-session";
import { assertLoginNotRateLimited, recordLoginAttempt } from "@/platform/auth/rate-limit";
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
    // Bound to the account state just authenticated (see PasswordSessionGuard).
    return await mobileSessionResponse(user, { account: accountState(user) });
  } catch (error) {
    // Count wrong credentials towards the lockout, exactly like the web login route.
    if (!(error instanceof AppError) || error.code !== "LOGIN_RATE_LIMITED") {
      await recordLoginAttempt(email, false).catch(() => undefined);
    }
    return errorResponse(error);
  }
}
