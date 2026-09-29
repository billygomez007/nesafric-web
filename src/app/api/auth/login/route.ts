import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { authenticateUser } from "@/modules/identity/service";
import { listUserWorkspaces } from "@/modules/marketplace-professionals/service";
import { createSession } from "@/platform/auth/session";
import {
  AUTH_RETURN_TO_COOKIE,
  safeReturnTo,
} from "@/platform/auth/return-to";
import {
  assertLoginNotRateLimited,
  recordLoginAttempt,
} from "@/platform/auth/rate-limit";
import {
  AppError,
  errorResponse,
} from "@/platform/errors";

export async function POST(request: Request) {
  const body = await request.json();

  try {
    await assertLoginNotRateLimited(
      body?.email,
    );

    const user =
      await authenticateUser(body);

    await recordLoginAttempt(
      body?.email,
      true,
    );

    // Bound to the password just checked (see PasswordSessionGuard).
    await createSession(user.id, { passwordHash: user.passwordHash! });

    const store = await cookies();

    const returnTo = safeReturnTo(
      store.get(
        AUTH_RETURN_TO_COOKIE,
      )?.value,
    );

    if (returnTo) {
      store.delete(
        AUTH_RETURN_TO_COOKIE,
      );
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      workspaces:
        await listUserWorkspaces(
          user.id,
        ),
      returnTo,
    });
  } catch (error) {
    if (
      !(error instanceof AppError) ||
      error.code !==
        "LOGIN_RATE_LIMITED"
    ) {
      await recordLoginAttempt(
        body?.email,
        false,
      );
    }

    return errorResponse(error);
  }
}
