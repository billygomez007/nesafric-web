import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60;

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function secureCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
  };
}

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json(
      {
        error: {
          message: "Google sign-in is not configured yet.",
        },
      },
      { status: 503 },
    );
  }

  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken(64);

  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/auth/google/callback`;

  const store = await cookies();

  const options = secureCookieOptions();

  store.set("nesafric_google_oauth_state", state, options);
  store.set("nesafric_google_oauth_nonce", nonce, options);
  store.set("nesafric_google_oauth_code_verifier", codeVerifier, options);

  const authorizationUrl = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );

  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("prompt", "select_account");

  return NextResponse.redirect(authorizationUrl);
}
