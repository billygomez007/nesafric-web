import { createHash, randomBytes } from "crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Route handlers read cookies and headers through next/headers: a controllable jar stands in for
// the browser (web + Custom Tab / ASWebAuthenticationSession) and for the app's bearer header.
const request = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void request.cookies.set(name, value),
    delete: (name: string) => void request.cookies.delete(name),
  }),
  headers: async () => request.headers,
}));

// The provider boundary: no live Google calls. Each test decides what Google "verified".
const google = vi.hoisted(() => ({ identity: null as null | { email: string; name?: string } | Error }));
vi.mock("@/platform/auth/google-oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform/auth/google-oauth")>();
  return {
    ...actual,
    resolveGoogleIdentity: vi.fn(async () => {
      if (google.identity instanceof Error) throw google.identity;
      if (!google.identity) throw new actual.GoogleOAuthError("A verified Google email address is required.");
      return google.identity;
    }),
  };
});

import { GET as profile } from "@/app/api/account/profile/route";
import { GET as googleCallback } from "@/app/api/auth/google/callback/route";
import { GET as webGoogleStart } from "@/app/api/auth/google/start/route";
import { POST as webLogin } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as exchange } from "@/app/api/auth/mobile/google/exchange/route";
import { GET as mobileGoogleStart } from "@/app/api/auth/mobile/google/start/route";
import { POST as mobileSignIn } from "@/app/api/auth/mobile/session/route";
import { GET as workspaces } from "@/app/api/workspaces/route";
import { findOrCreateGoogleUser, registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { GoogleOAuthError, GOOGLE_OAUTH_MOBILE_COOKIE, GOOGLE_OAUTH_STATE_COOKIE } from "@/platform/auth/google-oauth";
import { MOBILE_HANDOFF_TTL_MS } from "@/platform/auth/mobile-handoff";
import { db } from "@/platform/database/client";

const ORIGIN = "https://www.nesafric.test";
const PASSWORD = "correct-horse-battery-1";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "LoginAttempt" CASCADE');
}

function resetRequest(bearer?: string) {
  request.cookies = new Map();
  request.headers = new Headers(bearer ? { authorization: `Bearer ${bearer}` } : {});
}

const jsonRequest = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** What the app generates: a random state and a PKCE verifier + S256 challenge. */
function appFlow() {
  const verifier = randomBytes(64).toString("hex");
  return { state: randomBytes(32).toString("hex"), verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** Runs start → (Google) → callback in one browser cookie jar and returns the app redirect. */
async function mobileGoogle(flow = appFlow(), identity: typeof google.identity = { email: "kofi@example.com", name: "Kofi Mensah" }) {
  resetRequest();
  const start = await mobileGoogleStart(new Request(`${ORIGIN}/api/auth/mobile/google/start?state=${flow.state}&code_challenge=${flow.challenge}&code_challenge_method=S256`));
  expect(start.status).toBe(307);
  const googleUrl = new URL(start.headers.get("location")!);
  google.identity = identity;
  const callback = await googleCallback(new Request(`${ORIGIN}/api/auth/google/callback?code=google-code&state=${googleUrl.searchParams.get("state")}`));
  const html = await callback.text();
  const href = /content="0;url=([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&");
  return { flow, googleUrl, callback, html, redirect: href ? new URL(href) : null };
}

const redeem = (code: string | null | undefined, codeVerifier: string) => exchange(jsonRequest(`${ORIGIN}/api/auth/mobile/google/exchange`, { code, codeVerifier }));

describe("mobile Google sign-in", () => {
  beforeEach(async () => {
    await cleanDatabase();
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    google.identity = null;
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("uses the same Google client and registered callback as the website", async () => {
    const { googleUrl } = await mobileGoogle();
    expect(googleUrl.origin).toBe("https://accounts.google.com");
    expect(googleUrl.searchParams.get("client_id")).toBe("test-client.apps.googleusercontent.com");
    expect(googleUrl.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/google/callback`);
    expect(googleUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("rejects a start request without a valid app state and S256 challenge", async () => {
    resetRequest();
    expect((await mobileGoogleStart(new Request(`${ORIGIN}/api/auth/mobile/google/start?state=short&code_challenge=x`))).status).toBe(400);
    const flow = appFlow();
    expect((await mobileGoogleStart(new Request(`${ORIGIN}/api/auth/mobile/google/start?state=${flow.state}&code_challenge=${flow.challenge}&code_challenge_method=plain`))).status).toBe(400);
    expect(request.cookies.size).toBe(0);
  });

  it("returns a one-time code (never a session token) to the app, which redeems it for the same session shape as password sign-in", async () => {
    const { flow, redirect, callback, html } = await mobileGoogle();
    expect(callback.headers.get("cache-control")).toBe("no-store");
    expect(redirect?.protocol).toBe("nesafric:");
    expect(redirect?.host + redirect!.pathname).toBe("auth/google");
    expect(redirect?.searchParams.get("state")).toBe(flow.state);
    // No web session was created in the browser, and the OAuth cookies are gone.
    expect(request.cookies.has("propertyos_session")).toBe(false);
    expect(request.cookies.has(GOOGLE_OAUTH_MOBILE_COOKIE)).toBe(false);
    expect(await db.session.count()).toBe(0);
    // Stored only as a hash.
    const code = redirect!.searchParams.get("code")!;
    const stored = await db.mobileAuthHandoff.findFirstOrThrow();
    expect(stored.codeHash).toBe(createHash("sha256").update(code).digest("hex"));
    expect(html).not.toContain(stored.codeHash);

    resetRequest();
    const response = await redeem(code, flow.verifier);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "token", "tokenType", "user"]);
    expect(body).toMatchObject({ tokenType: "Bearer", user: { email: "kofi@example.com", displayName: "Kofi Mensah" } });
    expect(html).not.toContain(body.token);

    // The bearer token works on account routes, and logout revokes it.
    resetRequest(body.token);
    expect((await profile()).status).toBe(200);
    resetRequest(body.token);
    expect((await logout()).status).toBe(204);
    resetRequest(body.token);
    expect((await profile()).status).toBe(401);
  });

  it("refuses a replayed code", async () => {
    const { flow, redirect } = await mobileGoogle();
    const code = redirect!.searchParams.get("code");
    expect((await redeem(code, flow.verifier)).status).toBe(200);
    const replay = await redeem(code, flow.verifier);
    expect(replay.status).toBe(400);
    expect((await replay.json()).error.code).toBe("INVALID_HANDOFF");
    expect(await db.session.count()).toBe(1);
  });

  it("refuses the code with any verifier but the app's own, and burns it", async () => {
    const { flow, redirect } = await mobileGoogle();
    const code = redirect!.searchParams.get("code");
    expect((await redeem(code, appFlow().verifier)).status).toBe(400);
    expect((await redeem(code, flow.verifier)).status).toBe(400);
    expect(await db.session.count()).toBe(0);
  });

  it("refuses an expired code", async () => {
    const { flow, redirect } = await mobileGoogle();
    await db.mobileAuthHandoff.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(MOBILE_HANDOFF_TTL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
    expect((await redeem(redirect!.searchParams.get("code"), flow.verifier)).status).toBe(400);
  });

  it("concurrent redemptions of one code create exactly one session", async () => {
    const { flow, redirect } = await mobileGoogle();
    const code = redirect!.searchParams.get("code");
    const statuses = (await Promise.all([redeem(code, flow.verifier), redeem(code, flow.verifier), redeem(code, flow.verifier)])).map((response) => response.status).sort();
    expect(statuses).toEqual([200, 400, 400]);
    expect(await db.session.count()).toBe(1);
  });

  it("links an existing password account with the same email (any case) to the same User row", async () => {
    const existing = await registerUser({ displayName: "Ama Mensah", email: "ama@example.com", password: PASSWORD });
    const { flow, redirect } = await mobileGoogle(appFlow(), { email: "AMA@Example.com ", name: "Ama from Google" });
    const body = await (await redeem(redirect!.searchParams.get("code"), flow.verifier)).json();
    expect(body.user.id).toBe(existing.id);
    expect(await db.user.count()).toBe(1);
    // Their password still works on web and mobile.
    resetRequest();
    expect((await mobileSignIn(jsonRequest(`${ORIGIN}/api/auth/mobile/session`, { email: "ama@example.com", password: PASSWORD }))).status).toBe(200);
  });

  it("creates exactly one User row for a new Google user, and the same row on the next sign-in", async () => {
    const first = await mobileGoogle(appFlow(), { email: "new@example.com", name: "New Person" });
    const a = await (await redeem(first.redirect!.searchParams.get("code"), first.flow.verifier)).json();
    const second = await mobileGoogle(appFlow(), { email: "new@example.com", name: "New Person" });
    const b = await (await redeem(second.redirect!.searchParams.get("code"), second.flow.verifier)).json();
    expect(a.user.id).toBe(b.user.id);
    expect(await db.user.count({ where: { email: "new@example.com" } })).toBe(1);
    // Web and mobile share the one rule.
    expect((await findOrCreateGoogleUser({ email: "NEW@example.com" })).id).toBe(a.user.id);
  });

  it("sends an unverified Google email back to the app as an error, creating nothing", async () => {
    const { redirect } = await mobileGoogle(appFlow(), null);
    expect(redirect?.searchParams.get("error")).toBe("failed");
    expect(redirect?.searchParams.get("message")).toBe("A verified Google email address is required.");
    expect(redirect?.searchParams.get("code")).toBeNull();
    expect(await db.user.count()).toBe(0);
    expect(await db.mobileAuthHandoff.count()).toBe(0);
  });

  it("returns a Google cancellation to the app as 'cancelled'", async () => {
    const flow = appFlow();
    resetRequest();
    await mobileGoogleStart(new Request(`${ORIGIN}/api/auth/mobile/google/start?state=${flow.state}&code_challenge=${flow.challenge}`));
    const response = await googleCallback(new Request(`${ORIGIN}/api/auth/google/callback?error=access_denied`));
    const href = /content="0;url=([^"]+)"/.exec(await response.text())![1].replace(/&amp;/g, "&");
    const url = new URL(href);
    expect(url.searchParams.get("error")).toBe("cancelled");
    expect(url.searchParams.get("state")).toBe(flow.state);
  });

  it("returns other Google errors to the app as 'failed', not as a cancellation", async () => {
    const flow = appFlow();
    resetRequest();
    await mobileGoogleStart(new Request(`${ORIGIN}/api/auth/mobile/google/start?state=${flow.state}&code_challenge=${flow.challenge}`));
    const response = await googleCallback(new Request(`${ORIGIN}/api/auth/google/callback?error=server_error`));
    const url = new URL(/content="0;url=([^"]+)"/.exec(await response.text())![1].replace(/&amp;/g, "&"));
    expect(url.searchParams.get("error")).toBe("failed");
    expect(url.searchParams.get("state")).toBe(flow.state);
  });

  it.each(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"])("without %s, start returns to the app as not_configured instead of showing a web page", async (name) => {
    delete process.env[name];
    const flow = appFlow();
    resetRequest();
    const response = await mobileGoogleStart(new Request(`${ORIGIN}/api/auth/mobile/google/start?state=${flow.state}&code_challenge=${flow.challenge}&code_challenge_method=S256`));
    expect(response.status).toBe(200);
    const url = new URL(/content="0;url=([^"]+)"/.exec(await response.text())![1].replace(/&amp;/g, "&"));
    expect(url.protocol + "//" + url.host + url.pathname).toBe("nesafric://auth/google");
    expect(url.searchParams.get("error")).toBe("not_configured");
    expect(url.searchParams.get("state")).toBe(flow.state);
    expect(request.cookies.size).toBe(0);
  });

  it("rejects a callback whose OAuth state doesn't match the browser's", async () => {
    const flow = appFlow();
    resetRequest();
    await mobileGoogleStart(new Request(`${ORIGIN}/api/auth/mobile/google/start?state=${flow.state}&code_challenge=${flow.challenge}`));
    google.identity = { email: "kofi@example.com" };
    const response = await googleCallback(new Request(`${ORIGIN}/api/auth/google/callback?code=google-code&state=forged-state`));
    const url = new URL(/content="0;url=([^"]+)"/.exec(await response.text())![1].replace(/&amp;/g, "&"));
    expect(url.searchParams.get("error")).toBe("expired");
    expect(await db.mobileAuthHandoff.count()).toBe(0);
  });

  it("an abandoned app sign-in never turns a later website Google sign-in into an app handoff", async () => {
    const flow = appFlow();
    resetRequest();
    await mobileGoogleStart(new Request(`${ORIGIN}/api/auth/mobile/google/start?state=${flow.state}&code_challenge=${flow.challenge}`));
    expect(request.cookies.has(GOOGLE_OAUTH_MOBILE_COOKIE)).toBe(true);
    // Same browser, now signing in on the website.
    const start = await webGoogleStart(new Request(`${ORIGIN}/api/auth/google/start`));
    expect(request.cookies.has(GOOGLE_OAUTH_MOBILE_COOKIE)).toBe(false);
    google.identity = { email: "kofi@example.com" };
    const state = new URL(start.headers.get("location")!).searchParams.get("state");
    const callback = await googleCallback(new Request(`${ORIGIN}/api/auth/google/callback?code=google-code&state=${state}`));
    expect(callback.status).toBe(307);
    expect(callback.headers.get("location")).toBe(`${ORIGIN}/auth/google/complete`);
    expect(request.cookies.has("propertyos_session")).toBe(true);
    expect(await db.mobileAuthHandoff.count()).toBe(0);
  });

  it("keeps the website's Google sign-in unchanged, including its error redirect", async () => {
    resetRequest();
    const start = await webGoogleStart(new Request(`${ORIGIN}/api/auth/google/start`));
    expect(request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)).toBeTruthy();
    google.identity = new GoogleOAuthError("Google sign-in verification failed.");
    const state = new URL(start.headers.get("location")!).searchParams.get("state");
    const failed = await googleCallback(new Request(`${ORIGIN}/api/auth/google/callback?code=google-code&state=${state}`));
    const location = new URL(failed.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("google_error")).toBe("Google sign-in verification failed.");
  });

  it("after Google sign-in the app sees only the workspaces the server grants", async () => {
    const owner = await registerUser({ displayName: "Owner", email: "owner@example.com", password: PASSWORD });
    const organisation = await createOrganisation(owner.id, { name: "Owner Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const { flow, redirect } = await mobileGoogle(appFlow(), { email: "owner@example.com" });
    const body = await (await redeem(redirect!.searchParams.get("code"), flow.verifier)).json();
    resetRequest(body.token);
    const spaces = await (await workspaces()).json();
    expect(spaces.propertyOsOrganisations.map((item: { id: string }) => item.id)).toEqual([organisation.id]);
  });
});

describe("password sign-in parity between web and mobile", () => {
  beforeEach(cleanDatabase);

  const variants = ["ama@example.com", "AMA@EXAMPLE.COM", "  Ama@Example.com  "];

  it.each(variants)("accepts the same credentials on both routes (email typed as %j)", async (typed) => {
    await registerUser({ displayName: "Ama Mensah", email: "ama@example.com", password: PASSWORD });
    resetRequest();
    const web = await webLogin(jsonRequest(`${ORIGIN}/api/auth/login`, { email: typed, password: PASSWORD }));
    resetRequest();
    const mobile = await mobileSignIn(jsonRequest(`${ORIGIN}/api/auth/mobile/session`, { email: typed, password: PASSWORD }));
    expect([web.status, mobile.status]).toEqual([200, 200]);
  });

  it("rejects a wrong password identically on both routes", async () => {
    await registerUser({ displayName: "Ama Mensah", email: "ama@example.com", password: PASSWORD });
    resetRequest();
    const web = await webLogin(jsonRequest(`${ORIGIN}/api/auth/login`, { email: "ama@example.com", password: "wrong-password" }));
    resetRequest();
    const mobile = await mobileSignIn(jsonRequest(`${ORIGIN}/api/auth/mobile/session`, { email: "ama@example.com", password: "wrong-password" }));
    expect([web.status, mobile.status]).toEqual([401, 401]);
    expect((await web.json()).error).toEqual((await mobile.json()).error);
  });

  it("gives a Google-created account (no chosen password) the same generic answer on both routes", async () => {
    await findOrCreateGoogleUser({ email: "google-only@example.com", name: "Google Only" });
    for (const route of [webLogin, mobileSignIn]) {
      resetRequest();
      const response = await route(jsonRequest(`${ORIGIN}/api/auth/x`, { email: "google-only@example.com", password: "anything-at-all" }));
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("INVALID_CREDENTIALS");
    }
  });

  it("shares one rate limit across web and mobile", async () => {
    await registerUser({ displayName: "Ama Mensah", email: "ama@example.com", password: PASSWORD });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      resetRequest();
      const route = attempt % 2 ? webLogin : mobileSignIn;
      await route(jsonRequest(`${ORIGIN}/api/auth/x`, { email: "ama@example.com", password: "wrong-password" }));
    }
    resetRequest();
    const blocked = await mobileSignIn(jsonRequest(`${ORIGIN}/api/auth/mobile/session`, { email: "ama@example.com", password: PASSWORD }));
    expect(blocked.status).toBe(429);
  });
});
