import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Provider boundaries: no real SMS or email ever leaves a test. SMS codes come from a fake Arkesel
// OTP authority that generates, "texts" and checks codes the way Arkesel's documented API does.
const sms = vi.hoisted(() => ({
  configured: true,
  generateError: null as null | string,
  verifyDown: false,
  expired: false,
  /** Arkesel's re-use behaviour is undocumented: this fake keeps accepting a code, so any
   * single-use guarantee a test sees is NesAfric's own. */
  codes: new Map<string, string>(),
  sent: [] as Array<{ toE164: string; message: string; template: string }>,
  verifyCalls: 0,
}));
vi.mock("@/modules/messaging/otp-provider", async () => {
  const { MessagingError } = await import("@/modules/messaging/errors");
  return {
    getSmsOtpProvider: () => ({
      configured: sms.configured,
      expiryMinutes: 5,
      generate: async (numberE164: string, template: string) => {
        if (sms.generateError) throw new MessagingError(sms.generateError as never, "provider refused", { provider: "arkesel", retryable: false });
        const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
        sms.codes.set(numberE164, code);
        sms.sent.push({ toE164: numberE164, template, message: template.replace("%otp_code%", code) });
      },
      verify: async (numberE164: string, code: string) => {
        sms.verifyCalls += 1;
        if (sms.verifyDown) throw new MessagingError("PROVIDER_UNAVAILABLE", "down", { provider: "arkesel", retryable: true });
        if (sms.codes.get(numberE164) !== code) return { ok: false, provider: "arkesel", reason: "invalid", providerCode: "1104" };
        if (sms.expired) return { ok: false, provider: "arkesel", reason: "expired", providerCode: "1105" };
        return { ok: true, provider: "arkesel", providerCode: "1100" };
      },
    }),
  };
});
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; text: string; html: string }> }));
vi.mock("@/modules/conversations/channels/email-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/conversations/channels/email-providers")>();
  return {
    ...actual,
    getEmailProvider: () => ({
      mode: "TEST" as const,
      send: async (input: { to: string; subject: string; text: string; html: string }) => {
        mail.sent.push(input);
        return { status: "SENT" as const, providerReference: `test-email:${mail.sent.length}` };
      },
    }),
  };
});

import { PATCH as changePassword } from "@/app/api/account/password/route";
import { GET as profile } from "@/app/api/account/profile/route";
import { POST as verifyLink } from "@/app/api/account/identifiers/verify/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as mobileVerify } from "@/app/api/auth/mobile/otp/verify/route";
import { POST as mobilePasswordSignIn } from "@/app/api/auth/mobile/session/route";
import { POST as requestRoute } from "@/app/api/auth/otp/request/route";
import { POST as webVerify } from "@/app/api/auth/otp/verify/route";
import { findOrCreateGoogleUser, registerUser } from "@/modules/identity/service";
import { OTP_MAX_ATTEMPTS, OTP_MAX_SENDS_PER_HOUR, OTP_MAX_SENDS_PER_REQUESTER_PER_HOUR } from "@/modules/identity/otp";
import { createSessionRecord, hashSessionToken } from "@/platform/auth/session";
import { db } from "@/platform/database/client";

const ORIGIN = "https://www.nesafric.test";
const PASSWORD = "correct-horse-battery-1";
let ipCounter = 0;

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "LoginAttempt", "AuthOtpChallenge", "BackgroundJob" CASCADE');
}

function as(auth: { bearer?: string; cookie?: string; ip?: string } = {}) {
  request.cookies = new Map(auth.cookie ? [["propertyos_session", auth.cookie]] : []);
  request.headers = new Headers();
  if (auth.bearer) request.headers.set("authorization", `Bearer ${auth.bearer}`);
}

const post = (path: string, body: unknown, ip = `198.51.100.${(ipCounter = (ipCounter % 250) + 1)}`) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-test-client-ip": ip }, body: JSON.stringify(body) });

async function send(body: { mode: string; channel: "email" | "sms"; identifier: string }, ip?: string) {
  const response = await requestRoute(post("/api/auth/otp/request", body, ip));
  return { status: response.status, body: await response.json() };
}

/** The code the fake provider "delivered" most recently. */
function lastCode(channel: "email" | "sms") {
  const text = channel === "sms" ? sms.sent.at(-1)?.message : mail.sent.at(-1)?.text;
  const match = /\b(\d{6})\b/.exec(text ?? "");
  if (!match) throw new Error("no code delivered");
  return match[1];
}

async function verifyWeb(body: Record<string, unknown>) {
  const response = await webVerify(post("/api/auth/otp/verify", body));
  return { status: response.status, body: await response.json() };
}

async function verifyMobile(body: Record<string, unknown>) {
  const response = await mobileVerify(post("/api/auth/mobile/otp/verify", body));
  return { status: response.status, body: await response.json() };
}

/** Moves a destination's challenges back in time (skips the resend cooldown without sleeping). */
const age = (ms: number) => db.$executeRawUnsafe(`UPDATE "AuthOtpChallenge" SET "createdAt" = "createdAt" - interval '${Math.round(ms / 1000)} seconds'`);

describe("passwordless sign-in with one-time codes", () => {
  const env = { ...process.env };
  beforeEach(async () => {
    await cleanDatabase();
    process.env.OTP_HASH_SECRET = "test-otp-secret-that-is-long-enough-0123456789";
    process.env.TRUSTED_CLIENT_IP_HEADER = "x-test-client-ip";
    delete process.env.OTP_SMS_GLOBAL_HOURLY_LIMIT;
    sms.configured = true;
    sms.generateError = null;
    sms.verifyDown = false;
    sms.expired = false;
    sms.codes = new Map();
    sms.sent = [];
    sms.verifyCalls = 0;
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

  describe("email codes", () => {
    it("sends a branded code and stores only keyed hashes — never the code or the address", async () => {
      const sent = await send({ mode: "login", channel: "email", identifier: "Ama@Example.com" });
      expect(sent.status).toBe(200);
      expect(sent.body).toMatchObject({ channel: "email", destination: "ama@example.com", resendAfterSeconds: 60 });
      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0].to).toBe("ama@example.com");
      const code = lastCode("email");
      expect(mail.sent[0].text).toContain("expires in 10 minutes");
      expect(mail.sent[0].text).toMatch(/If you did not request this/);
      const row = await db.authOtpChallenge.findUniqueOrThrow({ where: { id: sent.body.challengeId } });
      const stored = JSON.stringify(row);
      expect(stored).not.toContain(code);
      expect(stored).not.toContain("ama@example.com");
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.supersededAt).toBeNull();
      expect(row.providerReference).toMatch(/^test-email:/);
    });

    it("answers the same way whether or not an account exists (no enumeration)", async () => {
      await registerUser({ displayName: "Ama", email: "ama@example.com", password: PASSWORD });
      const existing = await send({ mode: "login", channel: "email", identifier: "ama@example.com" });
      const unknown = await send({ mode: "login", channel: "email", identifier: "nobody@example.com" });
      const shape = (body: Record<string, unknown>) => ({ ...body, challengeId: "x", expiresAt: "x", destination: "x" });
      expect(existing.status).toBe(unknown.status);
      expect(shape(existing.body)).toEqual(shape(unknown.body));
      expect(mail.sent).toHaveLength(2);
    });

    it("signs an existing verified password account in with a web session cookie, leaving its password intact", async () => {
      const user = await registerUser({ displayName: "Ama", email: "ama@example.com", password: PASSWORD });
      // Verified: its owner already proved this address. (An unverified one is claimed afresh by the
      // first proof and loses the claimant's password: tests/postgres-account-ownership.)
      await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      const before = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash;
      const sent = await send({ mode: "login", channel: "email", identifier: "AMA@example.com" });
      const verified = await verifyWeb({ challengeId: sent.body.challengeId, channel: "email", identifier: "ama@example.com", code: lastCode("email") });
      expect(verified.status).toBe(200);
      expect(verified.body).toMatchObject({ id: user.id, email: "ama@example.com", created: false, existingAccount: false });
      expect(verified.body).toHaveProperty("workspaces");
      expect(JSON.stringify(verified.body)).not.toMatch(/passwordHash|argon/);
      const cookie = request.cookies.get("propertyos_session");
      expect(cookie).toBeTruthy();
      expect(await db.session.count({ where: { userId: user.id, tokenHash: hashSessionToken(cookie!) } })).toBe(1);
      const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.passwordHash).toBe(before);
      expect(after.emailVerifiedAt).not.toBeNull();
      // The legacy password route still works for this account.
      as();
      expect((await mobilePasswordSignIn(post("/api/auth/mobile/session", { email: "ama@example.com", password: PASSWORD }))).status).toBe(200);
    });

    it("rejects a wrong code, and locks the code after too many wrong guesses", async () => {
      await registerUser({ displayName: "Ama", email: "ama@example.com", password: PASSWORD });
      const sent = await send({ mode: "login", channel: "email", identifier: "ama@example.com" });
      const code = lastCode("email");
      const wrong = code === "000000" ? "111111" : "000000";
      const attempt = (value: string) => verifyWeb({ challengeId: sent.body.challengeId, channel: "email", identifier: "ama@example.com", code: value });
      const first = await attempt(wrong);
      expect(first.status).toBe(400);
      expect(first.body.error.code).toBe("OTP_INVALID");
      for (let index = 1; index < OTP_MAX_ATTEMPTS; index += 1) expect((await attempt(wrong)).status).toBe(400);
      // Even the right code no longer works: the challenge is burnt.
      const locked = await attempt(code);
      expect(locked.status).toBe(400);
      expect((await db.authOtpChallenge.findUniqueOrThrow({ where: { id: sent.body.challengeId } })).failedAttempts).toBe(OTP_MAX_ATTEMPTS);
      expect(await db.session.count()).toBe(0);
    });

    it("rejects an expired code and a replayed code", async () => {
      await registerUser({ displayName: "Ama", email: "ama@example.com", password: PASSWORD });
      const sent = await send({ mode: "login", channel: "email", identifier: "ama@example.com" });
      const body = { challengeId: sent.body.challengeId, channel: "email", identifier: "ama@example.com", code: lastCode("email") };
      expect((await verifyWeb(body)).status).toBe(200);
      const replay = await verifyWeb(body);
      expect(replay.status).toBe(400);
      expect(replay.body.error.code).toBe("OTP_INVALID");

      await age(120_000);
      const second = await send({ mode: "login", channel: "email", identifier: "ama@example.com" });
      await db.authOtpChallenge.update({ where: { id: second.body.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await verifyWeb({ ...body, challengeId: second.body.challengeId, code: lastCode("email") })).status).toBe(400);
    });

    it("lets exactly one of several concurrent verifications win", async () => {
      await registerUser({ displayName: "Ama", email: "ama@example.com", password: PASSWORD });
      const sent = await send({ mode: "login", channel: "email", identifier: "ama@example.com" });
      const body = { challengeId: sent.body.challengeId, channel: "email", identifier: "ama@example.com", code: lastCode("email") };
      const results = await Promise.all([verifyMobile(body), verifyMobile(body), verifyMobile(body), verifyMobile(body)]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 400, 400, 400]);
      expect(await db.session.count()).toBe(1);
    });

    it("enforces the resend cooldown, and a new code supersedes the old one", async () => {
      const first = await send({ mode: "login", channel: "email", identifier: "ama@example.com" });
      const firstCode = lastCode("email");
      const tooSoon = await send({ mode: "login", channel: "email", identifier: "ama@example.com" });
      expect(tooSoon.status).toBe(429);
      expect(tooSoon.body.error).toMatchObject({ code: "OTP_RATE_LIMITED" });
      expect(tooSoon.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
      await age(61_000);
      const second = await send({ mode: "login", channel: "email", identifier: "ama@example.com" });
      expect(second.status).toBe(200);
      expect((await db.authOtpChallenge.findUniqueOrThrow({ where: { id: first.body.challengeId } })).supersededAt).not.toBeNull();
      await registerUser({ displayName: "Ama", email: "ama@example.com", password: PASSWORD });
      expect((await verifyWeb({ challengeId: first.body.challengeId, channel: "email", identifier: "ama@example.com", code: firstCode })).status).toBe(400);
      expect((await verifyWeb({ challengeId: second.body.challengeId, channel: "email", identifier: "ama@example.com", code: lastCode("email") })).status).toBe(200);
    });

    it(`limits sends to ${OTP_MAX_SENDS_PER_HOUR} per hour per address and ${OTP_MAX_SENDS_PER_REQUESTER_PER_HOUR} per hour per network`, async () => {
      for (let index = 0; index < OTP_MAX_SENDS_PER_HOUR; index += 1) {
        expect((await send({ mode: "login", channel: "email", identifier: "busy@example.com" })).status).toBe(200);
        await age(61_000);
      }
      const blocked = await send({ mode: "login", channel: "email", identifier: "busy@example.com" });
      expect(blocked.status).toBe(429);
      expect(mail.sent).toHaveLength(OTP_MAX_SENDS_PER_HOUR);

      await cleanDatabase();
      for (let index = 0; index < OTP_MAX_SENDS_PER_REQUESTER_PER_HOUR; index += 1) {
        expect((await send({ mode: "login", channel: "email", identifier: `person${index}@example.com` }, "203.0.113.9")).status).toBe(200);
      }
      expect((await send({ mode: "login", channel: "email", identifier: "one-more@example.com" }, "203.0.113.9")).status).toBe(429);
      expect((await send({ mode: "login", channel: "email", identifier: "one-more@example.com" }, "203.0.113.10")).status).toBe(200);
    }, 60_000);

    it("sign in with no account: says so only after the code is verified, then creates it with the same code", async () => {
      const sent = await send({ mode: "login", channel: "email", identifier: "new@example.com" });
      const body = { challengeId: sent.body.challengeId, channel: "email", identifier: "new@example.com", code: lastCode("email") };
      const noAccount = await verifyWeb(body);
      expect(noAccount.status).toBe(409);
      expect(noAccount.body.error.code).toBe("OTP_NO_ACCOUNT");
      expect(await db.user.count()).toBe(0);
      expect(request.cookies.has("propertyos_session")).toBe(false);
      const created = await verifyWeb({ ...body, displayName: "New Person" });
      expect(created.status).toBe(200);
      expect(created.body).toMatchObject({ email: "new@example.com", phone: null, displayName: "New Person", created: true });
      const user = await db.user.findUniqueOrThrow({ where: { email: "new@example.com" } });
      expect(user.passwordHash).toBeNull();
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(await db.backgroundJob.count({ where: { idempotencyKey: `account-email:welcome:${user.id}` } })).toBe(1);
    });

    it("sign up with an address that already has an account signs into it — never a duplicate", async () => {
      const existing = await registerUser({ displayName: "Ama", email: "ama@example.com", password: PASSWORD });
      const sent = await send({ mode: "register", channel: "email", identifier: "AMA@example.com" });
      const result = await verifyWeb({ challengeId: sent.body.challengeId, channel: "email", identifier: "ama@example.com", code: lastCode("email"), displayName: "Someone Else" });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ id: existing.id, displayName: "Ama", created: false, existingAccount: true });
      expect(await db.user.count()).toBe(1);
    });

    it("ends any session already on the browser before signing in (no session fixation)", async () => {
      const other = await registerUser({ displayName: "Previous", email: "previous@example.com", password: PASSWORD });
      const { token } = await createSessionRecord(other.id);
      await registerUser({ displayName: "Ama", email: "ama@example.com", password: PASSWORD });
      const sent = await send({ mode: "login", channel: "email", identifier: "ama@example.com" });
      as({ cookie: token });
      const response = await webVerify(post("/api/auth/otp/verify", { challengeId: sent.body.challengeId, channel: "email", identifier: "ama@example.com", code: lastCode("email") }));
      expect(response.status).toBe(200);
      expect(await db.session.count({ where: { tokenHash: hashSessionToken(token) } })).toBe(0);
      expect(request.cookies.get("propertyos_session")).not.toBe(token);
    });
  });

  describe("SMS codes", () => {
    it("normalises Ghana numbers to one E.164 identity and texts that number", async () => {
      const sent = await send({ mode: "register", channel: "sms", identifier: "024 123 4567" });
      expect(sent.status).toBe(200);
      expect(sent.body.destination).toBe("+233 24 *** 4567");
      expect(sms.sent[0].toE164).toBe("+233241234567");
      // Arkesel fills in the code: NesAfric only sends the template, never a code of its own.
      expect(sms.sent[0].template).toBe("Your NesAfric verification code is %otp_code%. It expires in 5 minutes. Do not share this code.");
      const row = await db.authOtpChallenge.findUniqueOrThrow({ where: { id: sent.body.challengeId } });
      expect(row).toMatchObject({ verifier: "ARKESEL", codeHash: null });
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(5 * 60_000 + 1000);
      // Verifying with another way of writing the same number matches the same challenge.
      const verified = await verifyMobile({ challengeId: sent.body.challengeId, channel: "sms", identifier: "233241234567", code: lastCode("sms"), displayName: "Kofi Mensah" });
      expect(verified.status).toBe(200);
      expect(Object.keys(verified.body).sort()).toEqual(["expiresAt", "token", "tokenType", "user"]);
      expect(verified.body.user).toMatchObject({ email: null, phone: "+233241234567", displayName: "Kofi Mensah" });
      const user = await db.user.findUniqueOrThrow({ where: { phoneE164: "+233241234567" } });
      expect(user.email).toBeNull();
      expect(user.passwordHash).toBeNull();
      expect(user.phoneVerifiedAt).not.toBeNull();

      // The bearer session works on account routes and shows the phone; logout revokes it.
      as({ bearer: verified.body.token });
      const me = await (await profile()).json();
      expect(me).toMatchObject({ email: null, phone: "+233241234567", phoneVerified: true });
      as({ bearer: verified.body.token });
      expect((await logout()).status).toBe(204);
      as({ bearer: verified.body.token });
      expect((await profile()).status).toBe(401);
    });

    it("a phone-only account signs in again with any written form of its number, and is never duplicated", async () => {
      for (const [index, form] of ["0241234567", "+233 24 123 4567", "00233241234567"].entries()) {
        if (index) await age(61_000);
        const sent = await send({ mode: index === 0 ? "register" : "login", channel: "sms", identifier: form });
        const result = await verifyMobile({ challengeId: sent.body.challengeId, channel: "sms", identifier: form, code: lastCode("sms"), displayName: "Kofi" });
        expect(result.status).toBe(200);
      }
      expect(await db.user.count()).toBe(1);
      // No synthetic email was ever invented for it.
      expect(await db.user.count({ where: { email: { not: null } } })).toBe(0);
    });

    it("rejects impossible or non-mobile numbers before sending anything", async () => {
      for (const identifier of ["12345", "024 123", "+233 30 212 3456", "not-a-number", "+999 1234567"]) {
        const result = await send({ mode: "login", channel: "sms", identifier });
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe("INVALID_PHONE");
      }
      expect(sms.sent).toHaveLength(0);
      expect(await db.authOtpChallenge.count()).toBe(0);
    });

    it("reports an SMS provider failure honestly and leaves no usable challenge behind", async () => {
      for (const [index, providerCode] of ["INSUFFICIENT_BALANCE", "SENDER_ID", "CONFIGURATION", "PROVIDER_UNAVAILABLE"].entries()) {
        if (index) await age(61_000);
        sms.generateError = providerCode;
        const failed = await send({ mode: "login", channel: "sms", identifier: "0241234567" });
        expect(failed.status).toBe(503);
        expect(failed.body.error.code).toBe("OTP_SMS_UNAVAILABLE");
        // Generic public message: nothing about balances or sender IDs.
        expect(failed.body.error.message).toBe("Text-message codes are temporarily unavailable. Please use email or try again later.");
      }
      expect(await db.authOtpChallenge.count({ where: { supersededAt: null } })).toBe(0);

      await age(61_000);
      sms.generateError = "INVALID_PHONE";
      const rejected = await send({ mode: "login", channel: "sms", identifier: "0241234567" });
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.code).toBe("INVALID_PHONE");

      sms.generateError = null;
      sms.configured = false;
      const before = await db.authOtpChallenge.count();
      await age(61_000);
      const unconfigured = await send({ mode: "login", channel: "sms", identifier: "0241234567" });
      expect(unconfigured.status).toBe(503);
      expect(await db.authOtpChallenge.count()).toBe(before);
      expect(sms.sent).toHaveLength(0);
    });

    it("Arkesel decides wrong and expired codes; NesAfric counts attempts and stops asking once locked", async () => {
      const sent = await send({ mode: "register", channel: "sms", identifier: "0241234567" });
      const code = lastCode("sms");
      const wrong = code === "000000" ? "111111" : "000000";
      const attempt = (value: string) => verifyMobile({ challengeId: sent.body.challengeId, channel: "sms", identifier: "0241234567", code: value, displayName: "Kofi" });
      for (let index = 0; index < OTP_MAX_ATTEMPTS; index += 1) expect((await attempt(wrong)).body.error.code).toBe("OTP_INVALID");
      expect(sms.verifyCalls).toBe(OTP_MAX_ATTEMPTS);
      // Locked: the right code no longer reaches Arkesel, and nothing is created.
      expect((await attempt(code)).status).toBe(400);
      expect(sms.verifyCalls).toBe(OTP_MAX_ATTEMPTS);
      expect(await db.user.count()).toBe(0);
    });

    it("an expired Arkesel code gets its own message and kills the challenge", async () => {
      const sent = await send({ mode: "register", channel: "sms", identifier: "0241234567" });
      sms.expired = true;
      const expired = await verifyMobile({ challengeId: sent.body.challengeId, channel: "sms", identifier: "0241234567", code: lastCode("sms"), displayName: "Kofi" });
      expect(expired.status).toBe(400);
      expect(expired.body.error).toMatchObject({ code: "OTP_EXPIRED", message: "That code has expired. Send a new code to try again." });
      sms.expired = false;
      expect((await verifyMobile({ challengeId: sent.body.challengeId, channel: "sms", identifier: "0241234567", code: lastCode("sms"), displayName: "Kofi" })).status).toBe(400);
      expect(await db.user.count()).toBe(0);
    });

    it("an Arkesel outage while checking is a 503 that costs no attempt and changes nothing", async () => {
      const user = await registerUser({ displayName: "Ama", email: "ama@example.com", password: PASSWORD });
      await db.user.update({ where: { id: user.id }, data: { phoneE164: "+233241234567" } });
      const sent = await send({ mode: "login", channel: "sms", identifier: "0241234567" });
      sms.verifyDown = true;
      const down = await verifyMobile({ challengeId: sent.body.challengeId, channel: "sms", identifier: "0241234567", code: lastCode("sms") });
      expect(down.status).toBe(503);
      expect(down.body.error.code).toBe("OTP_VERIFY_UNAVAILABLE");
      const row = await db.authOtpChallenge.findUniqueOrThrow({ where: { id: sent.body.challengeId } });
      expect(row).toMatchObject({ failedAttempts: 0, consumedAt: null, codeHash: null });
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).phoneVerifiedAt).toBeNull();
      expect(await db.session.count()).toBe(0);
      // Back up: the same code works.
      sms.verifyDown = false;
      expect((await verifyMobile({ challengeId: sent.body.challengeId, channel: "sms", identifier: "0241234567", code: lastCode("sms") })).status).toBe(200);
    });

    it("a successful check marks the phone verified exactly once, and is single use even if Arkesel would accept the code again", async () => {
      const user = await registerUser({ displayName: "Ama", email: "ama@example.com", password: PASSWORD });
      await db.user.update({ where: { id: user.id }, data: { phoneE164: "+233241234567" } });
      const sent = await send({ mode: "login", channel: "sms", identifier: "0241234567" });
      const body = { challengeId: sent.body.challengeId, channel: "sms", identifier: "0241234567", code: lastCode("sms") };
      const results = await Promise.all([verifyMobile(body), verifyMobile(body), verifyMobile(body)]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 400, 400]);
      const verifiedAt = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).phoneVerifiedAt;
      expect(verifiedAt).not.toBeNull();
      expect(await db.session.count()).toBe(1);
      // A replay is refused by NesAfric (the fake Arkesel would still say yes).
      expect((await verifyMobile(body)).status).toBe(400);
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).phoneVerifiedAt).toEqual(verifiedAt);
      // After Arkesel confirmed it, only the code's HMAC is stored.
      const row = await db.authOtpChallenge.findUniqueOrThrow({ where: { id: sent.body.challengeId } });
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(body.code);
    });

    it("sign-in with a number that has no account asks Arkesel once, then creates the account locally with the same code", async () => {
      const sent = await send({ mode: "login", channel: "sms", identifier: "0241234567" });
      const body = { challengeId: sent.body.challengeId, channel: "sms", identifier: "0241234567", code: lastCode("sms") };
      expect((await verifyMobile(body)).body.error.code).toBe("OTP_NO_ACCOUNT");
      expect((await verifyMobile({ ...body, displayName: "Kofi" })).status).toBe(200);
      expect(sms.verifyCalls).toBe(1);
      expect(await db.user.count({ where: { phoneE164: "+233241234567", phoneVerifiedAt: { not: null } } })).toBe(1);
    });

    it("caps total SMS per hour to protect against SMS bombing", async () => {
      process.env.OTP_SMS_GLOBAL_HOURLY_LIMIT = "2";
      expect((await send({ mode: "login", channel: "sms", identifier: "0241234567" })).status).toBe(200);
      expect((await send({ mode: "login", channel: "sms", identifier: "0551234567" })).status).toBe(200);
      const capped = await send({ mode: "login", channel: "sms", identifier: "0201234567" });
      expect(capped.status).toBe(503);
      expect(sms.sent).toHaveLength(2);
      // Email still works.
      expect((await send({ mode: "login", channel: "email", identifier: "ama@example.com" })).status).toBe(200);
    });

    it("never writes a code, a full number or the key to the logs", async () => {
      process.env.ARKESEL_API_KEY = "ak_test_secret_key_value_never_logged";
      const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
      sms.generateError = "INSUFFICIENT_BALANCE";
      await send({ mode: "login", channel: "sms", identifier: "0241234567" });
      sms.generateError = null;
      await age(61_000);
      const sent = await send({ mode: "register", channel: "sms", identifier: "0241234567" });
      const code = lastCode("sms");
      await verifyMobile({ challengeId: sent.body.challengeId, channel: "sms", identifier: "0241234567", code: code === "000000" ? "111111" : "000000" });
      sms.verifyDown = true;
      await verifyMobile({ challengeId: sent.body.challengeId, channel: "sms", identifier: "0241234567", code });
      sms.verifyDown = false;
      await verifyMobile({ challengeId: sent.body.challengeId, channel: "sms", identifier: "0241234567", code, displayName: "Kofi" });
      const logged = spies.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(" "))).join("\n");
      expect(logged).not.toContain(code);
      expect(logged).not.toContain("241234567");
      expect(logged).not.toContain("ak_test_secret_key_value_never_logged");
      spies.forEach((spy) => spy.mockRestore());
    });
  });

  describe("linking a verified email or phone to an existing account", () => {
    it("an email account adds a phone; the phone then signs into the same account", async () => {
      const user = await registerUser({ displayName: "Ama", email: "ama@example.com", password: PASSWORD });
      const { token } = await createSessionRecord(user.id);
      as({ bearer: token });
      const sent = await send({ mode: "link", channel: "sms", identifier: "0241234567" });
      expect(sent.status).toBe(200);
      as({ bearer: token });
      const linked = await verifyLink(post("/api/account/identifiers/verify", { challengeId: sent.body.challengeId, channel: "sms", identifier: "0241234567", code: lastCode("sms") }));
      expect(linked.status).toBe(200);
      expect(await linked.json()).toMatchObject({ id: user.id, email: "ama@example.com", phone: "+233241234567" });

      as();
      await age(61_000);
      const again = await send({ mode: "login", channel: "sms", identifier: "+233241234567" });
      const signedIn = await verifyMobile({ challengeId: again.body.challengeId, channel: "sms", identifier: "+233241234567", code: lastCode("sms") });
      expect(signedIn.body.user.id).toBe(user.id);
      expect(await db.user.count()).toBe(1);
    });

    it("a Google account verifies a phone onto the same row", async () => {
      const google = await findOrCreateGoogleUser({ email: "kofi@gmail.com", name: "Kofi" });
      expect(google.passwordHash).toBeNull();
      const { token } = await createSessionRecord(google.id);
      as({ bearer: token });
      const sent = await send({ mode: "link", channel: "sms", identifier: "0551234567" });
      as({ bearer: token });
      const linked = await verifyLink(post("/api/account/identifiers/verify", { challengeId: sent.body.challengeId, channel: "sms", identifier: "0551234567", code: lastCode("sms") }));
      expect((await linked.json()).id).toBe(google.id);
    });

    it("a phone-only account adds an email; Google with that email then reaches the same account", async () => {
      const sent = await send({ mode: "register", channel: "sms", identifier: "0241234567" });
      const phoneUser = (await verifyMobile({ challengeId: sent.body.challengeId, channel: "sms", identifier: "0241234567", code: lastCode("sms"), displayName: "Kofi" })).body;
      as({ bearer: phoneUser.token });
      const linkSent = await send({ mode: "link", channel: "email", identifier: "Kofi@Example.com" });
      as({ bearer: phoneUser.token });
      const linked = await verifyLink(post("/api/account/identifiers/verify", { challengeId: linkSent.body.challengeId, channel: "email", identifier: "kofi@example.com", code: lastCode("email") }));
      expect(await linked.json()).toMatchObject({ id: phoneUser.user.id, email: "kofi@example.com", phone: "+233241234567" });
      expect((await findOrCreateGoogleUser({ email: "KOFI@example.com" })).id).toBe(phoneUser.user.id);
      expect(await db.user.count()).toBe(1);
    });

    it("refuses an address that belongs to another account — accounts are never merged", async () => {
      const other = await registerUser({ displayName: "Other", email: "other@example.com", password: PASSWORD });
      const me = await registerUser({ displayName: "Me", email: "me@example.com", password: PASSWORD });
      const { token } = await createSessionRecord(me.id);
      as({ bearer: token });
      const sent = await send({ mode: "link", channel: "email", identifier: "other@example.com" });
      as({ bearer: token });
      const refused = await verifyLink(post("/api/account/identifiers/verify", { challengeId: sent.body.challengeId, channel: "email", identifier: "other@example.com", code: lastCode("email") }));
      expect(refused.status).toBe(409);
      expect((await refused.json()).error.code).toBe("IDENTIFIER_IN_USE");
      expect((await db.user.findUniqueOrThrow({ where: { id: other.id } })).email).toBe("other@example.com");
      expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).email).toBe("me@example.com");
    });

    it("needs a signed-in session, and a link code can't be used to sign in", async () => {
      expect((await send({ mode: "link", channel: "email", identifier: "a@example.com" })).status).toBe(401);
      const user = await registerUser({ displayName: "Ama", email: "ama@example.com", password: PASSWORD });
      const { token } = await createSessionRecord(user.id);
      as({ bearer: token });
      const sent = await send({ mode: "link", channel: "email", identifier: "new@example.com" });
      as();
      expect((await verifyMobile({ challengeId: sent.body.challengeId, channel: "email", identifier: "new@example.com", code: lastCode("email"), displayName: "X" })).status).toBe(400);
    });
  });

  describe("password compatibility", () => {
    it("accounts without a password can't use the legacy password routes", async () => {
      const sent = await send({ mode: "register", channel: "email", identifier: "otp@example.com" });
      const session = (await verifyMobile({ challengeId: sent.body.challengeId, channel: "email", identifier: "otp@example.com", code: lastCode("email"), displayName: "Otp User" })).body;
      as();
      const legacy = await mobilePasswordSignIn(post("/api/auth/mobile/session", { email: "otp@example.com", password: "anything-at-all" }));
      expect(legacy.status).toBe(401);
      expect((await legacy.json()).error.code).toBe("INVALID_CREDENTIALS");
      as({ bearer: session.token });
      const change = await changePassword(new Request(`${ORIGIN}/api/account/password`, { method: "PATCH", body: JSON.stringify({ currentPassword: "x", newPassword: "a-brand-new-password" }) }));
      expect(change.status).toBe(400);
      expect((await change.json()).error.code).toBe("PASSWORD_NOT_SET");
    });
  });
});
