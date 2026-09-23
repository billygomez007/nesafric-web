import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { createSession } from "@/platform/auth/session";
import { hashPassword } from "@/platform/auth/passwords";
import { db } from "@/platform/database/client";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

function clearGoogleOAuthCookies(store: Awaited<ReturnType<typeof cookies>>) {
  store.delete("nesafric_google_oauth_state");
  store.delete("nesafric_google_oauth_nonce");
  store.delete("nesafric_google_oauth_code_verifier");
}

function errorRedirect(origin: string, message: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("google_error", message);
  return NextResponse.redirect(url);
}

function safeDisplayName(value: unknown, email: string) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return email.split("@")[0] || "NesAfric user";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  const providerError = url.searchParams.get("error");

  if (providerError) {
    return errorRedirect(origin, "Google sign-in was cancelled.");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return errorRedirect(origin, "Google sign-in is not configured.");
  }

  const store = await cookies();

  const expectedState = store.get("nesafric_google_oauth_state")?.value;

  const nonce = store.get("nesafric_google_oauth_nonce")?.value;

  const codeVerifier = store.get("nesafric_google_oauth_code_verifier")?.value;

  if (
    !code ||
    !state ||
    !expectedState ||
    !nonce ||
    !codeVerifier ||
    state !== expectedState
  ) {
    clearGoogleOAuthCookies(store);

    return errorRedirect(
      origin,
      "Google sign-in session expired. Please try again.",
    );
  }

  const redirectUri = `${origin}/api/auth/google/callback`;

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      clearGoogleOAuthCookies(store);

      return errorRedirect(origin, "Google sign-in could not be completed.");
    }

    const tokenBody = (await tokenResponse.json()) as {
      id_token?: string;
    };

    if (!tokenBody.id_token) {
      clearGoogleOAuthCookies(store);

      return errorRedirect(origin, "Google did not return an identity token.");
    }

    const { payload } = await jwtVerify(tokenBody.id_token, GOOGLE_JWKS, {
      audience: clientId,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    });

    if (payload.nonce !== nonce) {
      clearGoogleOAuthCookies(store);

      return errorRedirect(origin, "Google sign-in verification failed.");
    }

    if (payload.email_verified !== true || typeof payload.email !== "string") {
      clearGoogleOAuthCookies(store);

      return errorRedirect(
        origin,
        "A verified Google email address is required.",
      );
    }

    const email = payload.email.trim().toLowerCase();

    let user = await db.user.findUnique({
      where: { email },
    });

    if (!user) {
      const randomUnavailablePassword = randomBytes(64).toString("base64url");

      user = await db.user.create({
        data: {
          email,
          displayName: safeDisplayName(payload.name, email),
          passwordHash: await hashPassword(randomUnavailablePassword),
          emailVerifiedAt: new Date(),
        },
      });
    } else if (!user.emailVerifiedAt) {
      user = await db.user.update({
        where: { id: user.id },
        data: {
          emailVerifiedAt: new Date(),
        },
      });
    }

    clearGoogleOAuthCookies(store);

    await createSession(user.id);

    return NextResponse.redirect(new URL("/auth/google/complete", origin));
  } catch {
    clearGoogleOAuthCookies(store);

    return errorRedirect(
      origin,
      "Google sign-in could not be completed. Please try again.",
    );
  }
}
