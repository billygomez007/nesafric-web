import { NextResponse } from "next/server";
import { createSession } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";
import { authenticateUser } from "@/modules/identity/service";
import { assertLoginNotRateLimited, recordLoginAttempt } from "@/platform/auth/rate-limit";

export async function POST(request: Request) {
  const body = await request.json();
  try {
    await assertLoginNotRateLimited(body?.email);
    const user = await authenticateUser(body);
    await recordLoginAttempt(body?.email, true);
    await createSession(user.id);
    return NextResponse.json({ id: user.id, email: user.email, displayName: user.displayName });
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "LOGIN_RATE_LIMITED") {
      await recordLoginAttempt(body?.email, false);
    }
    return errorResponse(error);
  }
}
