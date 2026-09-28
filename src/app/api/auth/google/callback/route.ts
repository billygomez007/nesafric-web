import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { findOrCreateGoogleUser } from "@/modules/identity/service";
import {
  clearGoogleOAuthCookies,
  GOOGLE_OAUTH_MOBILE_COOKIE,
  GOOGLE_OAUTH_NONCE_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_VERIFIER_COOKIE,
  GoogleOAuthError,
  googleRedirectUri,
  mobileAppRedirect as appRedirect,
  resolveGoogleIdentity,
} from "@/platform/auth/google-oauth";
import { createMobileHandoff, isAppState, isCodeChallenge } from "@/platform/auth/mobile-handoff";
import { createSession } from "@/platform/auth/session";
import {
  AUTH_RETURN_TO_COOKIE,
  safeReturnTo,
} from "@/platform/auth/return-to";

function errorRedirect(
  origin: string,
  message: string,
) {
  const url = new URL("/login", origin);
  url.searchParams.set(
    "google_error",
    message,
  );

  return NextResponse.redirect(url);
}

type MobileFlow = { appState: string; codeChallenge: string };

function readMobileFlow(raw: string | undefined): MobileFlow | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MobileFlow>;
    return isAppState(parsed.appState) && isCodeChallenge(parsed.codeChallenge)
      ? { appState: parsed.appState, codeChallenge: parsed.codeChallenge }
      : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const store = await cookies();
  const mobile = readMobileFlow(store.get(GOOGLE_OAUTH_MOBILE_COOKIE)?.value);

  const fail = (message: string, code = "failed") => {
    clearGoogleOAuthCookies(store);
    return mobile
      ? appRedirect({ error: code, message, state: mobile.appState })
      : errorRedirect(origin, message);
  };

  const providerError = url.searchParams.get("error");

  if (providerError) {
    // `access_denied` is the person closing or refusing the consent screen; anything else is a
    // Google-side failure and must not be reported as a cancellation.
    return providerError === "access_denied"
      ? fail("Google sign-in was cancelled.", "cancelled")
      : fail("We couldn’t complete Google sign-in. Please try again.");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return fail("Google sign-in is not configured correctly.", "not_configured");
  }

  const expectedState = store.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;

  const nonce = store.get(GOOGLE_OAUTH_NONCE_COOKIE)?.value;

  const codeVerifier = store.get(GOOGLE_OAUTH_VERIFIER_COOKIE)?.value;

  if (
    !code ||
    !state ||
    !expectedState ||
    !nonce ||
    !codeVerifier ||
    state !== expectedState
  ) {
    return fail(
      "Google sign-in session expired. Please try again.",
      "expired",
    );
  }

  try {
    const identity = await resolveGoogleIdentity({
      code,
      codeVerifier,
      nonce,
      clientId,
      clientSecret,
      redirectUri: googleRedirectUri(origin),
    });

    const user = await findOrCreateGoogleUser(identity);

    if (mobile) {
      // Native app: no web session in the browser; the app redeems this one-time code instead.
      const handoff = await createMobileHandoff(user.id, mobile.codeChallenge);
      clearGoogleOAuthCookies(store);
      return appRedirect({ code: handoff, state: mobile.appState });
    }

    const returnTo = safeReturnTo(
      store.get(AUTH_RETURN_TO_COOKIE)?.value,
    );

    clearGoogleOAuthCookies(store);

    await createSession(user.id);

    if (returnTo) {
      store.delete(
        AUTH_RETURN_TO_COOKIE,
      );

      return NextResponse.redirect(
        new URL(returnTo, origin),
      );
    }

    return NextResponse.redirect(
      new URL(
        "/auth/google/complete",
        origin,
      ),
    );
  } catch (error) {
    return fail(
      error instanceof GoogleOAuthError
        ? error.message
        : "Google sign-in could not be completed. Please try again.",
    );
  }
}
