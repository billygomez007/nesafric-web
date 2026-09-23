import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  AUTH_RETURN_TO_COOKIE,
  authReturnToCookieOptions,
  safeReturnTo,
} from "@/platform/auth/return-to";

export async function POST(request: Request) {
  const body = await request.json();

  const returnTo = safeReturnTo(
    typeof body?.returnTo === "string"
      ? body.returnTo
      : null,
  );

  if (!returnTo) {
    return NextResponse.json(
      {
        error: {
          message: "Invalid return path.",
        },
      },
      {
        status: 400,
      },
    );
  }

  const store = await cookies();

  store.set(
    AUTH_RETURN_TO_COOKIE,
    returnTo,
    authReturnToCookieOptions(),
  );

  return NextResponse.json({
    ok: true,
  });
}
