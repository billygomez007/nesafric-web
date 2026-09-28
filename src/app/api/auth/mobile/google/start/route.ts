import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  beginGoogleAuthorization,
  GOOGLE_OAUTH_MOBILE_COOKIE,
  googleOAuthCookieOptions,
} from "@/platform/auth/google-oauth";
import { isAppState, isCodeChallenge } from "@/platform/auth/mobile-handoff";

/**
 * Native-app Google sign-in, opened in the system browser auth session
 * (`WebBrowser.openAuthSessionAsync`). The app sends its own random `state` and a PKCE
 * `code_challenge`; Google OAuth itself then runs exactly as on the web (same client, same
 * registered callback). The callback sees the mobile marker and returns a one-time code to
 * `nesafric://auth/google`, which only the app holding the matching verifier can redeem.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const appState = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge");
  const method = url.searchParams.get("code_challenge_method") ?? "S256";

  if (!isAppState(appState) || !isCodeChallenge(codeChallenge) || method !== "S256") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid mobile sign-in request." } },
      { status: 400 },
    );
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: { code: "GOOGLE_NOT_CONFIGURED", message: "Google sign-in is not configured yet." } },
      { status: 503 },
    );
  }

  const store = await cookies();
  const authorizationUrl = beginGoogleAuthorization(store, clientId, url.origin);
  store.set(GOOGLE_OAUTH_MOBILE_COOKIE, JSON.stringify({ appState, codeChallenge }), googleOAuthCookieOptions());

  return NextResponse.redirect(authorizationUrl);
}
