import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Google OAuth plumbing shared by the web and mobile sign-in flows. Both flows use the same
 * client, the same registered redirect URI (`/api/auth/google/callback`) and the same cookies for
 * state / nonce / PKCE; the mobile flow only adds `GOOGLE_OAUTH_MOBILE_COOKIE`, which makes the
 * shared callback finish with a one-time app handoff instead of a web session cookie.
 */
export const GOOGLE_OAUTH_STATE_COOKIE = "nesafric_google_oauth_state";
export const GOOGLE_OAUTH_NONCE_COOKIE = "nesafric_google_oauth_nonce";
export const GOOGLE_OAUTH_VERIFIER_COOKIE = "nesafric_google_oauth_code_verifier";
/** `{ appState, codeChallenge }` of an in-progress native-app sign-in. Absent for web sign-in. */
export const GOOGLE_OAUTH_MOBILE_COOKIE = "nesafric_google_oauth_mobile";

export const GOOGLE_OAUTH_COOKIES = [
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_NONCE_COOKIE,
  GOOGLE_OAUTH_VERIFIER_COOKIE,
  GOOGLE_OAUTH_MOBILE_COOKIE,
] as const;

const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60;

/** Where the native app listens for the end of Google sign-in (Expo `scheme` in mobile/app.json). */
export const MOBILE_GOOGLE_REDIRECT = "nesafric://auth/google";

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

type CookieStore = {
  set: (name: string, value: string, options: Record<string, unknown>) => unknown;
  delete: (name: string) => unknown;
};

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

/** RFC 7636 S256 code challenge. */
export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function googleOAuthCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
  };
}

export function clearGoogleOAuthCookies(store: CookieStore) {
  for (const name of GOOGLE_OAUTH_COOKIES) store.delete(name);
}

export function googleRedirectUri(origin: string) {
  return `${origin}/api/auth/google/callback`;
}

/**
 * Sets the state / nonce / PKCE cookies and returns Google's authorization URL. Every new sign-in
 * starts by clearing the mobile marker; only the mobile start route sets it again afterwards, so an
 * abandoned app sign-in can never turn a later web sign-in in the same browser into an app handoff.
 */
export function beginGoogleAuthorization(store: CookieStore, clientId: string, origin: string) {
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken(64);
  const options = googleOAuthCookieOptions();

  store.delete(GOOGLE_OAUTH_MOBILE_COOKIE);
  store.set(GOOGLE_OAUTH_STATE_COOKIE, state, options);
  store.set(GOOGLE_OAUTH_NONCE_COOKIE, nonce, options);
  store.set(GOOGLE_OAUTH_VERIFIER_COOKIE, codeVerifier, options);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", googleRedirectUri(origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", pkceChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url;
}

export type GoogleIdentity = { email: string; name: unknown };

export class GoogleOAuthError extends Error {}

/**
 * Exchanges the authorization code and verifies the ID token (signature, audience, issuer, nonce,
 * verified email). The only place that talks to Google; tests mock this module boundary.
 */
export async function resolveGoogleIdentity(input: {
  code: string;
  codeVerifier: string;
  nonce: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleIdentity> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier,
    }),
  });
  if (!tokenResponse.ok) throw new GoogleOAuthError("Google sign-in could not be completed.");

  const tokenBody = (await tokenResponse.json()) as { id_token?: string };
  if (!tokenBody.id_token) throw new GoogleOAuthError("Google did not return an identity token.");

  const { payload } = await jwtVerify(tokenBody.id_token, GOOGLE_JWKS, {
    audience: input.clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
  });
  if (payload.nonce !== input.nonce) throw new GoogleOAuthError("Google sign-in verification failed.");
  if (payload.email_verified !== true || typeof payload.email !== "string") {
    throw new GoogleOAuthError("A verified Google email address is required.");
  }
  return { email: payload.email, name: payload.name };
}

/**
 * Hands a Google sign-in result back to the native app through its URL scheme. A small page (rather
 * than a bare redirect) so Android Custom Tabs and iOS auth sessions both follow it, with a visible
 * fallback link. It carries only the one-time handoff code or an error, never a session token.
 */
export function mobileAppRedirect(params: Record<string, string>) {
  const target = new URL(MOBILE_GOOGLE_REDIRECT);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  const href = target.toString().replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${href}"><title>Return to NesAfric</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 24px"><p>Returning to the NesAfric app…</p><p><a href="${href}">Open NesAfric</a></p></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
