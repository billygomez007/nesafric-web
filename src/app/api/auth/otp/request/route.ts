import { NextResponse } from "next/server";

import { requestOtp } from "@/modules/identity/otp";
import { getOptionalUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

export const maxDuration = 30;

/**
 * Sends a one-time sign-in / sign-up code by email or SMS (web and mobile).
 * `{ mode: "login" | "register" | "link", channel: "email" | "sms", identifier }`.
 * The answer is the same whether or not an account exists; `link` needs a signed-in session.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const user = body?.mode === "link" ? await getOptionalUser() : null;
    const result = await requestOtp(body, { headers: request.headers, userId: user?.id });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
