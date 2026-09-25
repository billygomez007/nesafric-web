import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The routes read the session from next/headers; stand in a controllable cookie jar and request
// headers so each call can be made "from" the web (cookie) or the app (Authorization: Bearer).
const request = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void request.cookies.set(name, value),
    delete: (name: string) => void request.cookies.delete(name),
  }),
  headers: async () => request.headers,
}));

import { PATCH as changePassword } from "@/app/api/account/password/route";
import { GET as profile } from "@/app/api/account/profile/route";
import { POST as webLogin } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as mobileSignIn } from "@/app/api/auth/mobile/session/route";
import { GET as dashboard } from "@/app/api/dashboard/route";
import { GET as properties } from "@/app/api/properties/route";
import { GET as workspaces } from "@/app/api/workspaces/route";
import { createProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { hashSessionToken, parseBearerToken } from "@/platform/auth/session";
import { db } from "@/platform/database/client";

const PASSWORD = "correct-horse-battery-1";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "LoginAttempt" CASCADE');
}

/** Sets up the "incoming request": optional web cookie and optional mobile bearer token. */
function as(auth: { bearer?: string; cookie?: string; authorization?: string } = {}) {
  request.cookies = new Map(auth.cookie ? [["propertyos_session", auth.cookie]] : []);
  request.headers = new Headers();
  if (auth.bearer) request.headers.set("authorization", `Bearer ${auth.bearer}`);
  if (auth.authorization) request.headers.set("authorization", auth.authorization);
}

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

async function signIn(email: string, password = PASSWORD) {
  as();
  return mobileSignIn(jsonRequest("https://nesafric.test/api/auth/mobile/session", { email, password }));
}

const orgRequest = (path: string, organisationId: string) => new Request(`https://nesafric.test${path}`, { headers: { "x-organisation-id": organisationId } });

describe("mobile bearer sessions", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("issues a token once in the body, stores only its hash, and authenticates account calls", async () => {
    const user = await registerUser({ displayName: "Ama Mensah", email: "ama@mobile-auth.test", password: PASSWORD });
    const response = await signIn("AMA@mobile-auth.test");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(request.cookies.size).toBe(0);
    const body = await response.json();
    expect(body).toMatchObject({ tokenType: "Bearer", user: { id: user.id, email: "ama@mobile-auth.test", displayName: "Ama Mensah" } });
    expect(parseBearerToken(`Bearer ${body.token}`)).toBe(body.token);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);

    const stored = await db.session.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).toBe(hashSessionToken(body.token));
    expect(stored[0].tokenHash).not.toBe(body.token);

    as({ bearer: body.token });
    const me = await profile();
    expect(me.status).toBe(200);
    expect((await me.json()).email).toBe("ama@mobile-auth.test");
    const spaces = await workspaces();
    expect(spaces.status).toBe(200);
    expect(await spaces.json()).toEqual({ propertyOsOrganisations: [], marketplaceProfessionals: [] });
  });

  it("gives the same answer for a wrong password and an unknown email, and rejects malformed bodies", async () => {
    await registerUser({ displayName: "Kofi", email: "kofi@mobile-auth.test", password: PASSWORD });
    const wrong = await signIn("kofi@mobile-auth.test", "not-the-password");
    const unknown = await signIn("nobody@mobile-auth.test", "not-the-password");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());

    as();
    const malformed = await mobileSignIn(new Request("https://nesafric.test/api/auth/mobile/session", { method: "POST", body: "{not json" }));
    expect(malformed.status).toBe(400);
    expect(await db.session.count()).toBe(0);
  });

  it("locks the account after repeated failures, even for the correct password", async () => {
    await registerUser({ displayName: "Esi", email: "esi@mobile-auth.test", password: PASSWORD });
    for (let attempt = 0; attempt < 8; attempt++) {
      expect((await signIn("esi@mobile-auth.test", "wrong-password")).status).toBe(401);
    }
    const locked = await signIn("esi@mobile-auth.test");
    expect(locked.status).toBe(429);
    expect((await locked.json()).error.code).toBe("LOGIN_RATE_LIMITED");
    expect(await db.session.count()).toBe(0);
  });

  it("rejects an expired session", async () => {
    const user = await registerUser({ displayName: "Yaw", email: "yaw@mobile-auth.test", password: PASSWORD });
    const { token } = await (await signIn("yaw@mobile-auth.test")).json();
    await db.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    as({ bearer: token });
    expect((await profile()).status).toBe(401);
  });

  it("revokes the token on logout and when the password is changed elsewhere", async () => {
    const user = await registerUser({ displayName: "Adwoa", email: "adwoa@mobile-auth.test", password: PASSWORD });
    const first = (await (await signIn("adwoa@mobile-auth.test")).json()).token;
    const second = (await (await signIn("adwoa@mobile-auth.test")).json()).token;

    as({ bearer: first });
    expect((await logout()).status).toBe(204);
    expect((await profile()).status).toBe(401);
    // The app treats 204 (and 401) as "the server session has ended": repeating the logout for an
    // already-revoked token is still 204 and changes nothing.
    as({ bearer: first });
    expect((await logout()).status).toBe(204);
    expect(await db.session.count({ where: { tokenHash: hashSessionToken(first) } })).toBe(0);
    // Logging out one device leaves the other signed in.
    as({ bearer: second });
    expect((await profile()).status).toBe(200);

    // A password change (e.g. on the web) ends every existing session, including the app's.
    as({ bearer: second });
    const change = await changePassword(new Request("https://nesafric.test/api/account/password", {
      method: "PATCH", body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "an-entirely-new-password-2" }),
    }));
    expect(change.status).toBe(200);
    as({ bearer: second });
    expect((await profile()).status).toBe(401);
    expect(await db.session.count({ where: { tokenHash: { in: [hashSessionToken(first), hashSessionToken(second)] } } })).toBe(0);
    expect(user.id).toBeTruthy();
  });

  it("ignores malformed Authorization headers", async () => {
    await registerUser({ displayName: "Nana", email: "nana@mobile-auth.test", password: PASSWORD });
    const { token } = await (await signIn("nana@mobile-auth.test")).json();
    for (const authorization of ["Bearer", `Basic ${token}`, `Bearer ${token} extra`, `Bearer ${"a".repeat(300)}`, "Bearer not a token", `Token ${token}`]) {
      as({ authorization });
      expect((await profile()).status).toBe(401);
    }
    // The scheme name is case-insensitive (RFC 9110).
    as({ authorization: `bearer ${token}` });
    expect((await profile()).status).toBe(200);
  });

  it("enforces organisation membership and permissions server-side for bearer sessions", async () => {
    const alice = await registerUser({ displayName: "Alice", email: "alice@mobile-auth.test", password: PASSWORD });
    const bob = await registerUser({ displayName: "Bob", email: "bob@mobile-auth.test", password: PASSWORD });
    const aliceOrg = await createOrganisation(alice.id, { name: "Alice Estates", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const bobOrg = await createOrganisation(bob.id, { name: "Bob Homes", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await createProperty(bob.id, bobOrg.id, { name: "Bob's Villa", referenceNumber: "BV-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });

    const { token } = await (await signIn("alice@mobile-auth.test")).json();
    as({ bearer: token });
    const own = await workspaces();
    expect((await own.json()).propertyOsOrganisations).toEqual([{ id: aliceOrg.id, name: "Alice Estates" }]);
    expect((await dashboard(orgRequest("/api/dashboard", aliceOrg.id))).status).toBe(200);

    // Sending another organisation's id doesn't grant access to it.
    expect((await dashboard(orgRequest("/api/dashboard", bobOrg.id))).status).toBe(403);
    expect((await properties(orgRequest("/api/properties", bobOrg.id))).status).toBe(403);
    // No session at all is 401 regardless of the organisation header.
    as();
    expect((await dashboard(orgRequest("/api/dashboard", aliceOrg.id))).status).toBe(401);
  });

  it("keeps web cookie sign-in working, with the cookie taking precedence over a bearer token", async () => {
    await registerUser({ displayName: "Web User", email: "web@mobile-auth.test", password: PASSWORD });
    await registerUser({ displayName: "App User", email: "app@mobile-auth.test", password: PASSWORD });
    as();
    const login = await webLogin(jsonRequest("https://nesafric.test/api/auth/login", { email: "web@mobile-auth.test", password: PASSWORD }));
    expect(login.status).toBe(200);
    const cookie = request.cookies.get("propertyos_session");
    expect(cookie).toBeTruthy();

    as({ cookie });
    expect((await (await profile()).json()).email).toBe("web@mobile-auth.test");

    const { token } = await (await signIn("app@mobile-auth.test")).json();
    as({ cookie, bearer: token });
    expect((await (await profile()).json()).email).toBe("web@mobile-auth.test");

    // Web logout still clears the cookie and revokes its session.
    as({ cookie });
    expect((await logout()).status).toBe(204);
    expect(request.cookies.has("propertyos_session")).toBe(false);
    as({ cookie });
    expect((await profile()).status).toBe(401);
  });
});
