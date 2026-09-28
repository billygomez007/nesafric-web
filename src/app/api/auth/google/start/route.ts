import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { beginGoogleAuthorization } from "@/platform/auth/google-oauth";

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json(
      { error: { message: "Google sign-in is not configured yet." } },
      { status: 503 },
    );
  }

  const origin = new URL(request.url).origin;
  const authorizationUrl = beginGoogleAuthorization(await cookies(), clientId, origin);

  return NextResponse.redirect(authorizationUrl);
}
