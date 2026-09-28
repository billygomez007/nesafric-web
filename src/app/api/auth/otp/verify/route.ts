import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { verifyOtp } from "@/modules/identity/otp";
import { publicUser } from "@/modules/identity/service";
import { listUserWorkspaces } from "@/modules/marketplace-professionals/service";
import { AUTH_RETURN_TO_COOKIE, safeReturnTo } from "@/platform/auth/return-to";
import { createSession, destroySession } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

export const maxDuration = 30;

/**
 * Web: verifies a one-time code and signs in with the same httpOnly session cookie as every other
 * web sign-in. Any session already on this browser is ended first (no session fixation).
 * `{ challengeId, channel, identifier, code, displayName? }` — `displayName` creates the account.
 */
export async function POST(request: Request) {
  try {
    const { user, created, existingAccount } = await verifyOtp(await request.json().catch(() => null));
    await destroySession();
    await createSession(user.id);
    const store = await cookies();
    const returnTo = safeReturnTo(store.get(AUTH_RETURN_TO_COOKIE)?.value);
    if (returnTo) store.delete(AUTH_RETURN_TO_COOKIE);
    return NextResponse.json(
      { ...publicUser(user), workspaces: await listUserWorkspaces(user.id), returnTo, created, existingAccount },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
