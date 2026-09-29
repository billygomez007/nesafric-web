import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security Batch 1 (H-1, H-4, M-2): whoever never proved control of an email address must not keep
 * credentials, sessions, sign-in methods or platform privileges once the real owner proves it.
 */

// Route handlers read cookies and headers through next/headers: a controllable jar stands in for
// the browser (cookie) and for the app (Authorization: Bearer).
const request = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void request.cookies.set(name, value),
    delete: (name: string) => void request.cookies.delete(name),
  }),
  headers: async () => request.headers,
}));

// No real SMS or email leaves a test: fake Arkesel OTP authority and email provider.
const sms = vi.hoisted(() => ({ codes: new Map<string, string>(), sent: [] as Array<{ toE164: string; message: string }> }));
vi.mock("@/modules/messaging/otp-provider", () => ({
  getSmsOtpProvider: () => ({
    configured: true,
    expiryMinutes: 5,
    generate: async (numberE164: string, template: string) => {
      const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
      sms.codes.set(numberE164, code);
      sms.sent.push({ toE164: numberE164, message: template.replace("%otp_code%", code) });
    },
    verify: async (numberE164: string, code: string) =>
      sms.codes.get(numberE164) === code ? { ok: true, provider: "arkesel", providerCode: "1100" } : { ok: false, provider: "arkesel", reason: "invalid", providerCode: "1104" },
  }),
}));
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; text: string }> }));
vi.mock("@/modules/conversations/channels/email-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/conversations/channels/email-providers")>();
  return {
    ...actual,
    getEmailProvider: () => ({
      mode: "TEST" as const,
      send: async (input: { to: string; text: string }) => {
        mail.sent.push(input);
        return { status: "SENT" as const, providerReference: `test-email:${mail.sent.length}` };
      },
    }),
  };
});

import { PATCH as changeEmail } from "@/app/api/account/email/route";
import { POST as verifyLink } from "@/app/api/account/identifiers/verify/route";
import { GET as profile } from "@/app/api/account/profile/route";
import { POST as webLogin } from "@/app/api/auth/login/route";
import { POST as mobilePasswordSignIn } from "@/app/api/auth/mobile/session/route";
import { POST as mobileVerify } from "@/app/api/auth/mobile/otp/verify/route";
import { POST as requestRoute } from "@/app/api/auth/otp/request/route";
import { POST as webVerify } from "@/app/api/auth/otp/verify/route";
import { POST as legacyRegister } from "@/app/api/auth/register/route";
import { findOrCreateGoogleUser, registerUser } from "@/modules/identity/service";
import { createSessionRecord } from "@/platform/auth/session";
import { db } from "@/platform/database/client";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

const ORIGIN = "https://www.nesafric.test";
const ATTACKER_PASSWORD = "attacker-chosen-password-1";
const OWNER_PASSWORD = "owner-real-password-123";
let ipCounter = 0;

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "LoginAttempt", "AuthOtpChallenge", "BackgroundJob", "PlatformPrincipal" CASCADE');
}

function as(auth: { bearer?: string; cookie?: string } = {}) {
  request.cookies = new Map(auth.cookie ? [["propertyos_session", auth.cookie]] : []);
  request.headers = new Headers();
  if (auth.bearer) request.headers.set("authorization", `Bearer ${auth.bearer}`);
}

const json = (path: string, body: unknown, method = "POST") =>
  new Request(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", "x-test-client-ip": `198.51.100.${(ipCounter = (ipCounter % 250) + 1)}` }, body: JSON.stringify(body) });

function lastCode(channel: "email" | "sms") {
  const text = channel === "sms" ? sms.sent.at(-1)?.message : mail.sent.at(-1)?.text;
  const match = /\b(\d{6})\b/.exec(text ?? "");
  if (!match) throw new Error("no code delivered");
  return match[1];
}

/** Moves every challenge back past the resend cooldown. */
const age = () => db.$executeRawUnsafe(`UPDATE "AuthOtpChallenge" SET "createdAt" = "createdAt" - interval '61 seconds'`);

/** The attacker: a password account for the victim's address, never verified, with a live app session. */
async function attackerPreRegisters(email: string) {
  const account = await registerUser({ displayName: "Not The Owner", email, password: ATTACKER_PASSWORD });
  as();
  const signIn = await mobilePasswordSignIn(json("/api/auth/mobile/session", { email, password: ATTACKER_PASSWORD }));
  expect(signIn.status).toBe(200);
  const { token } = (await signIn.json()) as { token: string };
  return { account, token };
}

async function passwordWorks(email: string, password: string) {
  as();
  return (await mobilePasswordSignIn(json("/api/auth/mobile/session", { email, password }))).status === 200;
}

async function sessionWorks(token: string) {
  as({ bearer: token });
  return (await profile()).status === 200;
}

/** The real owner signs in with an email code on the web. */
async function ownerProvesEmailWithCode(email: string) {
  as();
  const sent = await requestRoute(json("/api/auth/otp/request", { mode: "login", channel: "email", identifier: email }));
  const { challengeId } = (await sent.json()) as { challengeId: string };
  const verified = await webVerify(json("/api/auth/otp/verify", { challengeId, channel: "email", identifier: email, code: lastCode("email") }));
  return { status: verified.status, cookie: request.cookies.get("propertyos_session") };
}

describe("account ownership verification (security batch 1)", () => {
  const env = { ...process.env };
  beforeEach(async () => {
    await cleanDatabase();
    process.env.OTP_HASH_SECRET = "test-otp-secret-that-is-long-enough-0123456789";
    process.env.TRUSTED_CLIENT_IP_HEADER = "x-test-client-ip";
    sms.codes = new Map();
    sms.sent = [];
    mail.sent = [];
    as();
  });
  afterEach(() => {
    process.env = { ...env };
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  describe("H-1: first proof of an address ends everything the unproven account holder set up", () => {
    it("TEST 1+2: owner proves the email with a code → attacker's password and session stop working", async () => {
      const { account, token } = await attackerPreRegisters("victim@example.com");
      expect(await sessionWorks(token)).toBe(true);

      const owner = await ownerProvesEmailWithCode("victim@example.com");
      expect(owner.status).toBe(200);
      const after = await db.user.findUniqueOrThrow({ where: { id: account.id } });
      expect(after.emailVerifiedAt).not.toBeNull();
      expect(after.passwordHash).toBeNull();

      expect(await passwordWorks("victim@example.com", ATTACKER_PASSWORD)).toBe(false);
      expect(await sessionWorks(token)).toBe(false);
      // The owner's own new session, issued after the proof, works.
      as({ cookie: owner.cookie });
      expect((await profile()).status).toBe(200);
      expect(await db.session.count({ where: { userId: account.id } })).toBe(1);
    });

    it("TEST 2 (mobile): owner proves the email with a code in the app → attacker's session is revoked, owner's new token works", async () => {
      const { token } = await attackerPreRegisters("victim@example.com");
      as();
      const sent = await requestRoute(json("/api/auth/otp/request", { mode: "login", channel: "email", identifier: "victim@example.com" }));
      const { challengeId } = (await sent.json()) as { challengeId: string };
      const verified = await mobileVerify(json("/api/auth/mobile/otp/verify", { challengeId, channel: "email", identifier: "victim@example.com", code: lastCode("email") }));
      expect(verified.status).toBe(200);
      const ownerToken = ((await verified.json()) as { token: string }).token;
      expect(await sessionWorks(token)).toBe(false);
      expect(await sessionWorks(ownerToken)).toBe(true);
    });

    it("TEST 3: owner signs in with Google → attacker's password and session stop working", async () => {
      const { account, token } = await attackerPreRegisters("victim@example.com");
      const google = await findOrCreateGoogleUser({ email: "Victim@Example.com", name: "Real Owner" });
      expect(google.id).toBe(account.id);
      expect(google.emailVerifiedAt).not.toBeNull();
      expect(google.passwordHash).toBeNull();
      expect(await passwordWorks("victim@example.com", ATTACKER_PASSWORD)).toBe(false);
      expect(await sessionWorks(token)).toBe(false);
      // The Google flow then issues the owner's session as usual.
      const { token: ownerToken } = await createSessionRecord(google.id);
      expect(await sessionWorks(ownerToken)).toBe(true);
      expect(await db.user.count()).toBe(1);
    });

    it("a phone the attacker linked before the owner proved the email no longer signs into the account", async () => {
      const { account, token } = await attackerPreRegisters("victim@example.com");
      as({ bearer: token });
      const linkSent = await requestRoute(json("/api/auth/otp/request", { mode: "link", channel: "sms", identifier: "0241234567" }));
      const { challengeId } = (await linkSent.json()) as { challengeId: string };
      as({ bearer: token });
      expect((await verifyLink(json("/api/account/identifiers/verify", { challengeId, channel: "sms", identifier: "0241234567", code: lastCode("sms") }))).status).toBe(200);

      await ownerProvesEmailWithCode("victim@example.com");
      const after = await db.user.findUniqueOrThrow({ where: { id: account.id } });
      expect(after.phoneE164).toBeNull();
      expect(after.phoneVerifiedAt).toBeNull();

      // The attacker's phone now leads nowhere near the owner's account.
      await age();
      as();
      const again = await requestRoute(json("/api/auth/otp/request", { mode: "login", channel: "sms", identifier: "0241234567" }));
      const challenge = ((await again.json()) as { challengeId: string }).challengeId;
      const attempt = await mobileVerify(json("/api/auth/mobile/otp/verify", { challengeId: challenge, channel: "sms", identifier: "0241234567", code: lastCode("sms") }));
      expect(attempt.status).toBe(409);
      expect(((await attempt.json()) as { error: { code: string } }).error.code).toBe("OTP_NO_ACCOUNT");
    });

    it("a password sign-in racing the owner's proof can't leave the attacker a session", async () => {
      const { account } = await attackerPreRegisters("victim@example.com");
      // The attacker's password was checked just before the owner's proof landed…
      const checked = await db.user.findUniqueOrThrow({ where: { id: account.id } });
      await ownerProvesEmailWithCode("victim@example.com");
      // …so issuing the session afterwards, against the old password, is refused.
      await expect(createSessionRecord(account.id, undefined, { passwordHash: checked.passwordHash! })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", status: 401 });
      expect(await db.session.count({ where: { userId: account.id } })).toBe(1);
    });

    it("TEST 4: an already-verified password account keeps its password and sessions when it signs in again", async () => {
      const user = await registerUser({ displayName: "Ama", email: "ama@example.com", password: OWNER_PASSWORD });
      await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date("2026-01-01T00:00:00Z") } });
      as();
      const web = await webLogin(json("/api/auth/login", { email: "ama@example.com", password: OWNER_PASSWORD }));
      expect(web.status).toBe(200);
      const { token: otherDevice } = await createSessionRecord(user.id);

      expect((await ownerProvesEmailWithCode("ama@example.com")).status).toBe(200);
      await findOrCreateGoogleUser({ email: "ama@example.com" });

      const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.passwordHash).toBe(user.passwordHash);
      expect(after.emailVerifiedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(await passwordWorks("ama@example.com", OWNER_PASSWORD)).toBe(true);
      expect(await sessionWorks(otherDevice)).toBe(true);
    });
  });

  describe("M-2: the legacy registration route is retired", () => {
    it("TEST 5: creates no account and no session", async () => {
      as();
      const response = await legacyRegister(json("/api/auth/register", { displayName: "New", email: "new@example.com", password: ATTACKER_PASSWORD }));
      expect(response.status).toBe(410);
      expect(await db.user.count()).toBe(0);
      expect(await db.session.count()).toBe(0);
      expect(request.cookies.get("propertyos_session")).toBeUndefined();
    });

    it("TEST 6: answers identically whether or not the email has an account", async () => {
      await registerUser({ displayName: "Existing", email: "existing@example.com", password: OWNER_PASSWORD });
      as();
      const existing = await legacyRegister(json("/api/auth/register", { displayName: "X", email: "existing@example.com", password: ATTACKER_PASSWORD }));
      const unknown = await legacyRegister(json("/api/auth/register", { displayName: "X", email: "unknown@example.com", password: ATTACKER_PASSWORD }));
      const garbage = await legacyRegister(new Request(`${ORIGIN}/api/auth/register`, { method: "POST", body: "not json" }));
      expect(existing.status).toBe(unknown.status);
      expect(garbage.status).toBe(unknown.status);
      const [a, b, c] = await Promise.all([existing.json(), unknown.json(), garbage.json()]);
      expect(a).toEqual(b);
      expect(c).toEqual(b);
      expect(JSON.stringify(a)).not.toMatch(/EMAIL_EXISTS|already/i);
    });
  });

  describe("H-4: platform admin bootstrap needs a verified email", () => {
    it("TEST 7: a matching but unverified account gets no platform principal", async () => {
      const squatter = await registerUser({ displayName: "Squatter", email: "founder@example.com", password: ATTACKER_PASSWORD });
      process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAILS = "founder@example.com";
      await expect(requirePlatformPrincipal(squatter)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(await db.platformPrincipal.count()).toBe(0);
    });

    it("TEST 8: a matching verified account is bootstrapped (case-insensitively); an unrelated verified one is not", async () => {
      const founder = await findOrCreateGoogleUser({ email: "founder@example.com", name: "Founder" });
      const other = await findOrCreateGoogleUser({ email: "other@example.com", name: "Other" });
      process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAILS = " someone@example.com, FOUNDER@Example.com ";
      await expect(requirePlatformPrincipal(founder)).resolves.toMatchObject({ role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "ENV_BOOTSTRAP" });
      await expect(requirePlatformPrincipal(other)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await db.platformPrincipal.count()).toBe(1);
    });

    it("the squatter's account, once its real owner proves the email, is bootstrapped for the owner only", async () => {
      const { account, token } = await attackerPreRegisters("founder@example.com");
      process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAILS = "founder@example.com";
      await expect(requirePlatformPrincipal(account)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await ownerProvesEmailWithCode("founder@example.com");
      expect(await sessionWorks(token)).toBe(false);
      const owner = await db.user.findUniqueOrThrow({ where: { id: account.id } });
      await expect(requirePlatformPrincipal(owner)).resolves.toMatchObject({ role: "SUPER_ADMIN" });
    });
  });

  describe("changing the account email needs proof of the new address", () => {
    async function verifiedPasswordUser() {
      const user = await registerUser({ displayName: "Ama", email: "ama@example.com", password: OWNER_PASSWORD });
      await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      const { token } = await createSessionRecord(user.id);
      return { user, token };
    }

    it("TEST 9: PATCH alone never makes the new email the account's email", async () => {
      const { user, token } = await verifiedPasswordUser();
      as({ bearer: token });
      const response = await changeEmail(json("/api/account/email", { email: "new@example.com", currentPassword: OWNER_PASSWORD }, "PATCH"));
      expect(response.status).toBe(202);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ channel: "email", destination: "new@example.com" });
      expect(body).toHaveProperty("challengeId");
      const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.email).toBe("ama@example.com");
      expect(after.emailVerifiedAt).not.toBeNull();
      // The code went to the NEW address.
      expect(mail.sent.at(-1)?.to).toBe("new@example.com");
    });

    it("still needs the current password, and doesn't reveal whether the new email is taken", async () => {
      const { token } = await verifiedPasswordUser();
      await findOrCreateGoogleUser({ email: "taken@example.com" });
      as({ bearer: token });
      const wrong = await changeEmail(json("/api/account/email", { email: "new@example.com", currentPassword: "not-my-password" }, "PATCH"));
      expect(wrong.status).toBe(401);
      await age();
      as({ bearer: token });
      const taken = await changeEmail(json("/api/account/email", { email: "taken@example.com", currentPassword: OWNER_PASSWORD }, "PATCH"));
      await age();
      as({ bearer: token });
      const free = await changeEmail(json("/api/account/email", { email: "free@example.com", currentPassword: OWNER_PASSWORD }, "PATCH"));
      expect(taken.status).toBe(free.status);
      const shape = (value: Record<string, unknown>) => Object.keys(value).sort();
      expect(shape((await taken.json()) as Record<string, unknown>)).toEqual(shape((await free.json()) as Record<string, unknown>));
    });

    it("TEST 10: the code sent to the new address completes the change, verified, and signs out other devices", async () => {
      const { user, token } = await verifiedPasswordUser();
      const { token: otherDevice } = await createSessionRecord(user.id);
      as({ bearer: token });
      const started = await changeEmail(json("/api/account/email", { email: "New@Example.com", currentPassword: OWNER_PASSWORD }, "PATCH"));
      const { challengeId } = (await started.json()) as { challengeId: string };
      as({ bearer: token });
      const done = await verifyLink(json("/api/account/identifiers/verify", { challengeId, channel: "email", identifier: "new@example.com", code: lastCode("email") }));
      expect(done.status).toBe(200);
      const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.email).toBe("new@example.com");
      expect(after.emailVerifiedAt).not.toBeNull();
      expect(await sessionWorks(token)).toBe(true);
      expect(await sessionWorks(otherDevice)).toBe(false);
    });
  });
});
