import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import type { MobileSessionResponse } from "@/api/account";
import type { ApiClient } from "@/api/client";
import { websiteUrl } from "@/config";

/**
 * "Continue with Google" for the native app, on top of the website's own Google sign-in:
 *
 * 1. The app makes a random `state` and a PKCE verifier, and keeps them in secure storage.
 * 2. It opens `/api/auth/mobile/google/start` in the system auth session (ASWebAuthenticationSession
 *    on iOS, Custom Tabs on Android). Google OAuth runs on nesafric.com exactly as for the website.
 * 3. NesAfric returns to `nesafric://auth/google?code=…&state=…` with a one-time code (never a
 *    session token). The app checks `state`, then redeems the code with its verifier at
 *    `/api/auth/mobile/google/exchange` for the same session response as password sign-in.
 *
 * The pending flow is kept in secure storage (not memory) so the sign-in can still finish if
 * Android restarts the app while the browser is open. It is single use and expires in 10 minutes.
 */
export const GOOGLE_REDIRECT_URL = "nesafric://auth/google";

const PENDING_KEY = "nesafric.google-pending.v1";
const PENDING_TTL_MS = 10 * 60 * 1000;
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

type PendingGoogleSignIn = { state: string; verifier: string; createdAt: number };

export type GoogleSignInFailure = "cancelled" | "stateMismatch" | "expired" | "failed";

export class GoogleSignInError extends Error {
  constructor(
    readonly reason: GoogleSignInFailure,
    message: string,
  ) {
    super(message);
    this.name = "GoogleSignInError";
  }
}

const MESSAGES: Record<GoogleSignInFailure, string> = {
  cancelled: "Google sign-in was cancelled.",
  stateMismatch: "That Google sign-in didn’t come from this app. Please try again.",
  expired: "That Google sign-in expired. Please try again.",
  failed: "Google sign-in couldn’t be completed. Please try again.",
};

const fail = (reason: GoogleSignInFailure, message = MESSAGES[reason]) => new GoogleSignInError(reason, message);

// Hex is a subset of the base64url alphabet the server accepts for state and verifier.
function randomHex(bytes: number) {
  return Array.from(Crypto.getRandomBytes(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** RFC 7636 S256: base64url(SHA-256(verifier)), without padding. */
export async function codeChallengeFor(verifier: string) {
  const base64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The web preview build has no secure store; there the flow lives in memory only.
let memoryPending: string | null = null;
const inMemoryOnly = Platform.OS === "web";

async function savePending(pending: PendingGoogleSignIn) {
  const raw = JSON.stringify(pending);
  if (inMemoryOnly) memoryPending = raw;
  else await SecureStore.setItemAsync(PENDING_KEY, raw, OPTIONS);
}

/** Reads and deletes the pending flow: it can be used for at most one completion. */
async function takePending(now = Date.now()): Promise<PendingGoogleSignIn | null> {
  let raw: string | null;
  if (inMemoryOnly) {
    raw = memoryPending;
    memoryPending = null;
  } else {
    raw = await SecureStore.getItemAsync(PENDING_KEY, OPTIONS).catch(() => null);
    await SecureStore.deleteItemAsync(PENDING_KEY, OPTIONS).catch(() => undefined);
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingGoogleSignIn;
    if (typeof parsed.state !== "string" || typeof parsed.verifier !== "string" || typeof parsed.createdAt !== "number") return null;
    return now - parsed.createdAt <= PENDING_TTL_MS ? parsed : null;
  } catch {
    return null;
  }
}

export function isGoogleRedirect(url: string) {
  return url.startsWith(GOOGLE_REDIRECT_URL);
}

/** Only this app's redirect (`nesafric://auth/google`) is accepted; query values are read as-is. */
function redirectParams(url: string) {
  const query = url.slice(GOOGLE_REDIRECT_URL.length).replace(/^\/?\?/, "").split("#")[0];
  const params = new Map<string, string>();
  for (const part of query.split("&")) {
    if (!part) continue;
    const [key, value = ""] = part.split("=");
    try {
      params.set(decodeURIComponent(key), decodeURIComponent(value.replace(/\+/g, " ")));
    } catch {
      // A malformed value is treated as absent.
    }
  }
  return params;
}

export const exchangeGoogleHandoff = (api: ApiClient, input: { code: string; codeVerifier: string }) =>
  api.request<MobileSessionResponse>("/api/auth/mobile/google/exchange", { method: "POST", body: input });

// Android delivers the redirect twice (to the auth session and to the router): both callers share
// one completion instead of racing to redeem the code.
const inFlight = new Map<string, Promise<MobileSessionResponse | null>>();

/**
 * Finishes a Google sign-in from its redirect URL. Resolves `null` when there is no pending flow
 * for it (already completed by the other delivery of the same redirect, or never started here).
 */
export function completeGoogleRedirect(api: ApiClient, url: string): Promise<MobileSessionResponse | null> {
  const params = redirectParams(url);
  const key = params.get("state") ?? "";
  const running = inFlight.get(key);
  if (running) return running;
  const completion = (async () => {
    const pending = await takePending();
    if (!pending) return null;
    if (!key || params.get("state") !== pending.state) throw fail("stateMismatch");
    const error = params.get("error");
    if (error) throw fail(error === "cancelled" ? "cancelled" : error === "expired" ? "expired" : "failed", error === "cancelled" ? MESSAGES.cancelled : params.get("message") || MESSAGES.failed);
    const code = params.get("code");
    if (!code) throw fail("failed");
    return exchangeGoogleHandoff(api, { code, codeVerifier: pending.verifier });
  })();
  inFlight.set(key, completion);
  void completion.catch(() => undefined).finally(() => setTimeout(() => inFlight.delete(key), 1000));
  return completion;
}

/**
 * Runs the whole flow. Resolves with the new session, or throws `GoogleSignInError` (`cancelled`
 * when the person closed the browser — callers should stay quiet about that).
 */
export async function signInWithGoogle(api: ApiClient, apiUrl: string): Promise<MobileSessionResponse> {
  const state = randomHex(32);
  const verifier = randomHex(64);
  const challenge = await codeChallengeFor(verifier);
  await savePending({ state, verifier, createdAt: Date.now() });

  const start = websiteUrl(apiUrl, `/api/auth/mobile/google/start?state=${state}&code_challenge=${challenge}&code_challenge_method=S256`);
  const result = await WebBrowser.openAuthSessionAsync(start, GOOGLE_REDIRECT_URL);

  if (result.type !== "success") {
    // Closed without a redirect. The router copy of the redirect (Android) may still complete it.
    const pendingLeft = await takePending();
    if (!pendingLeft && inFlight.has(state)) {
      const session = await inFlight.get(state);
      if (session) return session;
    }
    throw fail("cancelled");
  }
  const session = await completeGoogleRedirect(api, result.url);
  if (session) return session;
  // Completed by the router copy of the same redirect: reuse that result.
  const other = inFlight.get(state);
  const shared = other ? await other : null;
  if (shared) return shared;
  throw fail("expired");
}
