import { createHmac, randomInt, randomUUID, timingSafeEqual } from "crypto";
import { z } from "zod";

import { enqueueWelcomeEmail } from "@/modules/account-emails/service";
import { getEmailProvider, getEmailProviderStatus } from "@/modules/conversations/channels/email-providers";
import { renderEmail } from "@/modules/notifications/email-templates/render";
import { BRAND } from "@/platform/brand";
import { db } from "@/platform/database/client";
import { Prisma, type User } from "@/platform/database/generated/client";
import { AppError } from "@/platform/errors";
import { maskPhone, normalizePhone } from "@/platform/identity/phone";
import { ipRateLimitKey, resolveClientIdentity } from "@/platform/security/client-ip";
import { isMessagingError, type MessagingError } from "@/modules/messaging/errors";
import { getSmsOtpProvider } from "@/modules/messaging/otp-provider";

/**
 * Passwordless sign-in / sign-up with a one-time code sent by email or SMS.
 *
 * Who owns the code:
 * - Email: NesAfric generates it (`crypto.randomInt`, 6 digits, 10 minutes) and stores its HMAC.
 * - SMS: Arkesel is the code authority (`src/modules/messaging`): it generates, texts, expires
 *   (5 minutes) and checks the code; NesAfric never sees it before the person types it. Once Arkesel
 *   confirms a code, its HMAC is stored so a repeat check (e.g. "create the account") is local.
 * NesAfric owns everything around the code for both channels, below.
 *
 * Security model:
 * - Single use, 5 wrong guesses per code, 10 per destination per hour.
 * - At rest: only HMAC-SHA256 digests (keyed by `OTP_HASH_SECRET`, else `SESSION_SECRET`) of the
 *   code and of the destination. No plaintext code or destination is stored, logged or returned.
 * - Sending never reveals whether an account exists: every valid request gets the same answer and a
 *   code. Only after the code is verified (possession proven) is "no account yet" disclosed.
 * - Send limits: 1 per 60 s and 5 per hour per destination, 20 per hour per client IP, and a global
 *   hourly SMS ceiling (cost protection). Verify limits: 5 guesses per code, 10 per destination per
 *   hour. Sends to one destination are serialised by a transaction-scoped advisory lock.
 * - A new code supersedes earlier live codes for the same destination — but only once it has been
 *   handed to the provider, so a failed send never invalidates a code the person already has.
 * - Consumption is one conditional UPDATE, so concurrent verifications have exactly one winner.
 *
 * Verification proves identity only; the caller then creates an ordinary `Session` (cookie on the
 * web, bearer token on mobile). There is no OTP-specific long-lived credential.
 */
export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_SENDS_PER_HOUR = 5;
export const OTP_MAX_SENDS_PER_REQUESTER_PER_HOUR = 20;
export const OTP_MAX_FAILURES_PER_IDENTIFIER_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

export type OtpChannel = "email" | "sms";
export type OtpMode = "login" | "register" | "link";

const CHANNEL_DB = { email: "EMAIL", sms: "SMS" } as const;
const PURPOSE_DB = { login: "LOGIN", register: "REGISTER", link: "LINK" } as const;

export const OTP_INVALID_MESSAGE = "That code is incorrect or has expired. Check it, or send a new code.";
export const OTP_EXPIRED_MESSAGE = "That code has expired. Send a new code to try again.";

const invalidCode = () => new AppError("OTP_INVALID", 400, OTP_INVALID_MESSAGE);
const expiredCode = () => new AppError("OTP_EXPIRED", 400, OTP_EXPIRED_MESSAGE);
const smsUnavailable = () =>
  new AppError("OTP_SMS_UNAVAILABLE", 503, "Text-message codes are temporarily unavailable. Please use email or try again later.");

/** Provider failures become generic public errors; the details stay in the server log line. */
function publicSmsError(error: MessagingError, stage: "send" | "verify") {
  if (error.code === "INVALID_PHONE") return new AppError("INVALID_PHONE", 400, "We can’t send a text message to this number. Check it, or use email.");
  if (error.code === "RATE_LIMITED") return new AppError("OTP_RATE_LIMITED", 429, "Too many requests. Please wait a minute and try again.");
  return stage === "verify"
    ? new AppError("OTP_VERIFY_UNAVAILABLE", 503, "We couldn’t check your code right now. Please try again in a moment.")
    : smsUnavailable();
}

type Env = Record<string, string | undefined>;

function otpSecret(env: Env = process.env) {
  const secret = env.OTP_HASH_SECRET || env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new AppError("OTP_UNAVAILABLE", 503, "Sign-in codes are temporarily unavailable. Please try again later.");
  return secret;
}

const hmac = (value: string) => createHmac("sha256", otpSecret()).update(value).digest("hex");

function safeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The canonical destination for a channel, or a validation error (format only — never existence). */
export function normalizeIdentifier(channel: OtpChannel, raw: unknown): string {
  if (channel === "email") {
    const parsed = z.string().trim().toLowerCase().email().max(254).safeParse(raw);
    if (!parsed.success) throw new AppError("INVALID_EMAIL", 400, "Enter a valid email address.");
    return parsed.data;
  }
  const phone = normalizePhone(raw);
  if (!phone) throw new AppError("INVALID_PHONE", 400, "Enter a valid mobile number, for example 024 123 4567 or +233 24 123 4567.");
  return phone;
}

const identifierHashFor = (channel: OtpChannel, normalized: string) => hmac(`identifier:${channel}:${normalized}`);
const codeHashFor = (challengeId: string, code: string) => hmac(`code:${challengeId}:${code}`);

function requesterHashFor(headers: Headers | undefined) {
  if (!headers) return null;
  const { ip } = resolveClientIdentity(headers);
  return ip ? hmac(`requester:${ipRateLimitKey(ip)}`) : null;
}

function rateLimited(message: string, retryAfterSeconds?: number) {
  return new AppError("OTP_RATE_LIMITED", 429, message, retryAfterSeconds ? { retryAfterSeconds } : undefined);
}

function smsHourlyCeiling(env: Env = process.env) {
  const value = Number(env.OTP_SMS_GLOBAL_HOURLY_LIMIT);
  return Number.isInteger(value) && value > 0 ? value : 1000;
}

const requestSchema = z.object({
  mode: z.enum(["login", "register", "link"]),
  channel: z.enum(["email", "sms"]),
  identifier: z.string().max(254),
});

export type OtpRequestResult = {
  challengeId: string;
  channel: OtpChannel;
  /** Where the code went, partly masked (the person typed it, so this reveals nothing new). */
  destination: string;
  expiresAt: Date;
  resendAfterSeconds: number;
};

function assertDeliveryAvailable(channel: OtpChannel) {
  if (channel === "sms") {
    // Fails closed: no key or no (valid) sender ID means no SMS codes, never a pretend send.
    if (!getSmsOtpProvider().configured) throw smsUnavailable();
    return;
  }
  // The deterministic test email transport is fine for development and tests, never for production.
  if (process.env.NODE_ENV === "production" && !getEmailProviderStatus().configured) {
    throw new AppError("OTP_EMAIL_UNAVAILABLE", 503, "Email codes are temporarily unavailable. Please try again later.");
  }
}

function otpEmail(code: string, mode: OtpMode) {
  const action = mode === "register" ? "finish creating your NesAfric account" : mode === "link" ? "add this email to your NesAfric account" : "sign in to NesAfric";
  const rendered = renderEmail({
    preheader: `Your NesAfric code is ${code}`,
    heading: "Your verification code",
    paragraphs: [
      `Use this code to ${action}:`,
      code,
      `It expires in ${OTP_TTL_MS / 60_000} minutes and can be used once.`,
      "If you did not request this, you can ignore this email. Never share this code — NesAfric staff will never ask for it.",
    ],
  });
  return { subject: `${code} is your NesAfric code`, ...rendered };
}

/** Arkesel substitutes the code for `%otp_code%`. */
export const otpSmsTemplate = (expiryMinutes: number) =>
  `Your NesAfric verification code is %otp_code%. It expires in ${expiryMinutes} minutes. Do not share this code.`;

async function deliverEmail(destination: string, code: string, mode: OtpMode, challengeId: string) {
  const email = otpEmail(code, mode);
  return getEmailProvider().send({
    from: BRAND.sender.hello,
    to: destination,
    subject: email.subject,
    html: email.html,
    text: email.text,
    replyTo: BRAND.contact.support,
    idempotencyKey: `auth-otp:${challengeId}`,
  });
}

/**
 * Sends a code. The same answer for every valid request, whether or not an account exists.
 * `link` requires `userId` (the signed-in account the identifier will be added to).
 */
export async function requestOtp(input: unknown, context: { headers?: Headers; userId?: string; now?: Date } = {}): Promise<OtpRequestResult> {
  const { mode, channel, identifier } = requestSchema.parse(input);
  if (mode === "link" && !context.userId) throw new AppError("UNAUTHENTICATED", 401, "Authentication is required.");
  const normalized = normalizeIdentifier(channel, identifier);
  const identifierHash = identifierHashFor(channel, normalized);
  const requesterHash = requesterHashFor(context.headers);
  const now = context.now ?? new Date();
  assertDeliveryAvailable(channel);

  const sms = channel === "sms" ? getSmsOtpProvider() : null;
  // Email codes are made here; SMS codes are made (and later checked) by Arkesel.
  const code = sms ? null : randomInt(0, 10 ** OTP_CODE_LENGTH).toString().padStart(OTP_CODE_LENGTH, "0");
  const challengeId = randomUUID();
  const expiresAt = new Date(now.getTime() + (sms ? sms.expiryMinutes * 60_000 : OTP_TTL_MS));
  const hourAgo = new Date(now.getTime() - HOUR_MS);

  await db.$transaction(async (tx) => {
    // Serialise concurrent sends to one destination so the limits below can't be raced.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identifierHash}, 0))`;
    const latest = await tx.authOtpChallenge.findFirst({ where: { identifierHash }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (latest && now.getTime() - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now.getTime() - latest.createdAt.getTime())) / 1000);
      throw rateLimited(`Please wait ${wait} seconds before requesting another code.`, wait);
    }
    if ((await tx.authOtpChallenge.count({ where: { identifierHash, createdAt: { gte: hourAgo } } })) >= OTP_MAX_SENDS_PER_HOUR) {
      throw rateLimited("Too many codes have been requested for this address. Please try again in an hour.");
    }
    if (requesterHash && (await tx.authOtpChallenge.count({ where: { requesterHash, createdAt: { gte: hourAgo } } })) >= OTP_MAX_SENDS_PER_REQUESTER_PER_HOUR) {
      throw rateLimited("Too many codes have been requested from this network. Please try again later.");
    }
    if (channel === "sms" && (await tx.authOtpChallenge.count({ where: { channel: "SMS", createdAt: { gte: hourAgo } } })) >= smsHourlyCeiling()) {
      throw smsUnavailable();
    }
    // Created inactive (`supersededAt` set): it only becomes usable once the provider accepts it.
    await tx.authOtpChallenge.create({
      data: {
        id: challengeId,
        purpose: PURPOSE_DB[mode],
        channel: CHANNEL_DB[channel],
        identifierHash,
        verifier: sms ? "ARKESEL" : "NESAFRIC",
        codeHash: code ? codeHashFor(challengeId, code) : null,
        userId: mode === "link" ? context.userId : null,
        requesterHash,
        expiresAt,
        supersededAt: now,
      },
    });
  });

  let providerReference: string | null = null;
  if (sms) {
    try {
      await sms.generate(normalized, otpSmsTemplate(sms.expiryMinutes));
    } catch (error) {
      console.warn(JSON.stringify({ event: "auth-otp.delivery-failed", channel, challengeId, reason: isMessagingError(error) ? error.code : "UNKNOWN" }));
      throw isMessagingError(error) ? publicSmsError(error, "send") : smsUnavailable();
    }
  } else {
    const result = await deliverEmail(normalized, code!, mode, challengeId);
    if (result.status !== "SENT") {
      console.warn(JSON.stringify({ event: "auth-otp.delivery-failed", channel, challengeId }));
      throw new AppError("OTP_EMAIL_UNAVAILABLE", 503, "We couldn’t send an email right now. Please try again later.");
    }
    providerReference = result.providerReference.slice(0, 200);
  }

  await db.$transaction([
    db.authOtpChallenge.updateMany({ where: { identifierHash, id: { not: challengeId }, consumedAt: null, supersededAt: null }, data: { supersededAt: new Date() } }),
    db.authOtpChallenge.update({ where: { id: challengeId }, data: { supersededAt: null, providerReference } }),
  ]);

  await sweepExpiredOtpChallenges(now).catch(() => undefined);

  return {
    challengeId,
    channel,
    destination: channel === "sms" ? maskPhone(normalized) : normalized,
    expiresAt,
    resendAfterSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
  };
}

const verifySchema = z.object({
  challengeId: z.string().uuid(),
  channel: z.enum(["email", "sms"]),
  identifier: z.string().max(254),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."),
  /** Present when the person is creating an account. */
  displayName: z.string().trim().min(2).max(100).optional(),
});

export type OtpVerification = { user: User; created: boolean; existingAccount: boolean };

/**
 * Checks the code for a sign-in / sign-up challenge and resolves the account:
 * - an account with this verified email/phone → that account (sign-up with an existing identifier
 *   signs into it rather than creating a duplicate; `existingAccount` tells the UI);
 * - none, with `displayName` → a new account with this identifier already verified;
 * - none, without `displayName` → `OTP_NO_ACCOUNT` (409). The code is left unused so the verified
 *   person can go straight on to create an account with it.
 */
export async function verifyOtp(input: unknown, context: { now?: Date } = {}): Promise<OtpVerification> {
  const data = verifySchema.parse(input);
  const normalized = normalizeIdentifier(data.channel, data.identifier);
  const identifierHash = identifierHashFor(data.channel, normalized);
  const challenge = await checkCode(data.challengeId, data.channel, normalized, identifierHash, data.code, ["LOGIN", "REGISTER"], context.now);

  const where = data.channel === "email" ? { email: normalized } : { phoneE164: normalized };
  const existing = await db.user.findUnique({ where });
  if (!existing && !data.displayName) {
    throw new AppError("OTP_NO_ACCOUNT", 409, data.channel === "email" ? "No NesAfric account uses this email yet. Create one to continue." : "No NesAfric account uses this phone number yet. Create one to continue.");
  }
  await consume(challenge.id, context.now);

  if (existing) return { user: await markVerified(existing, data.channel), created: false, existingAccount: challenge.purpose === "REGISTER" };

  const verifiedAt = new Date();
  try {
    const user = await db.user.create({
      data: data.channel === "email"
        ? { email: normalized, emailVerifiedAt: verifiedAt, displayName: data.displayName! }
        : { phoneE164: normalized, phoneVerifiedAt: verifiedAt, displayName: data.displayName! },
    });
    if (user.email) await enqueueWelcomeEmail(user.id);
    return { user, created: true, existingAccount: false };
  } catch (error) {
    // The same identifier was registered concurrently: use that account, never a duplicate.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const user = await db.user.findUnique({ where });
      if (user) return { user, created: false, existingAccount: true };
    }
    throw error;
  }
}

/**
 * Adds a verified email or phone to the signed-in account. An identifier that already belongs to a
 * different account is refused (`IDENTIFIER_IN_USE`) — accounts are never merged implicitly.
 */
export async function verifyOtpLink(userId: string, input: unknown, context: { now?: Date } = {}) {
  const data = verifySchema.omit({ displayName: true }).parse(input);
  const normalized = normalizeIdentifier(data.channel, data.identifier);
  const identifierHash = identifierHashFor(data.channel, normalized);
  const challenge = await checkCode(data.challengeId, data.channel, normalized, identifierHash, data.code, ["LINK"], context.now);
  if (challenge.userId !== userId) throw invalidCode();
  const where = data.channel === "email" ? { email: normalized } : { phoneE164: normalized };
  const owner = await db.user.findUnique({ where, select: { id: true } });
  if (owner && owner.id !== userId) {
    throw new AppError("IDENTIFIER_IN_USE", 409, data.channel === "email" ? "This email is already used by another NesAfric account." : "This phone number is already used by another NesAfric account.");
  }
  await consume(challenge.id, context.now);
  const verifiedAt = new Date();
  try {
    return await db.user.update({
      where: { id: userId },
      data: data.channel === "email" ? { email: normalized, emailVerifiedAt: verifiedAt } : { phoneE164: normalized, phoneVerifiedAt: verifiedAt },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("IDENTIFIER_IN_USE", 409, "This address is already used by another NesAfric account.");
    }
    throw error;
  }
}

async function recordWrongGuess(challengeId: string) {
  await db.authOtpChallenge.updateMany({
    where: { id: challengeId, consumedAt: null, failedAttempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { failedAttempts: { increment: 1 } },
  });
}

/**
 * Checks a code against a live challenge. NesAfric's own limits run first, so a locked, used,
 * superseded or expired challenge never reaches Arkesel. For an Arkesel challenge whose code hasn't
 * been confirmed yet, Arkesel decides; a confirmed code's HMAC is then kept, so any repeat check is
 * local (Arkesel's behaviour on re-verifying the same code isn't documented).
 */
async function checkCode(challengeId: string, channel: OtpChannel, normalized: string, identifierHash: string, code: string, purposes: Array<"LOGIN" | "REGISTER" | "LINK">, now = new Date()) {
  const challenge = await db.authOtpChallenge.findUnique({ where: { id: challengeId } });
  // Every failure below is the same generic answer: no hint about which check failed.
  if (
    !challenge ||
    challenge.identifierHash !== identifierHash ||
    challenge.channel !== CHANNEL_DB[channel] ||
    !purposes.includes(challenge.purpose) ||
    challenge.consumedAt ||
    challenge.supersededAt ||
    challenge.expiresAt <= now ||
    challenge.failedAttempts >= OTP_MAX_ATTEMPTS
  ) {
    throw invalidCode();
  }
  const recentFailures = await db.authOtpChallenge.aggregate({
    where: { identifierHash, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
    _sum: { failedAttempts: true },
  });
  if ((recentFailures._sum.failedAttempts ?? 0) >= OTP_MAX_FAILURES_PER_IDENTIFIER_PER_HOUR) {
    throw rateLimited("Too many incorrect codes. Please wait an hour and request a new code.");
  }
  const submittedHash = codeHashFor(challenge.id, code);
  if (challenge.codeHash) {
    if (!safeEqualHex(challenge.codeHash, submittedHash)) {
      await recordWrongGuess(challenge.id);
      throw invalidCode();
    }
    return challenge;
  }
  if (challenge.verifier !== "ARKESEL") throw invalidCode();

  let result;
  try {
    result = await getSmsOtpProvider().verify(normalized, code);
  } catch (error) {
    // Provider trouble is not the person's fault: no attempt is counted.
    console.warn(JSON.stringify({ event: "auth-otp.verify-unavailable", challengeId: challenge.id, reason: isMessagingError(error) ? error.code : "UNKNOWN" }));
    throw isMessagingError(error) ? publicSmsError(error, "verify") : new AppError("OTP_VERIFY_UNAVAILABLE", 503, "We couldn’t check your code right now. Please try again in a moment.");
  }
  if (!result.ok) {
    if (result.reason === "expired") {
      await db.authOtpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { expiresAt: now } });
      throw expiredCode();
    }
    await recordWrongGuess(challenge.id);
    throw invalidCode();
  }
  // Arkesel confirmed it: keep only its HMAC so the challenge can be finished locally.
  await db.authOtpChallenge.updateMany({ where: { id: challenge.id, codeHash: null }, data: { codeHash: submittedHash } });
  return challenge;
}

/** Exactly one caller can consume a live challenge. */
async function consume(challengeId: string, now = new Date()) {
  const consumed = await db.authOtpChallenge.updateMany({
    where: { id: challengeId, consumedAt: null, supersededAt: null, expiresAt: { gt: now }, failedAttempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) throw invalidCode();
}

async function markVerified(user: User, channel: OtpChannel) {
  if (channel === "email" && !user.emailVerifiedAt) return db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  if (channel === "sms" && !user.phoneVerifiedAt) return db.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
  return user;
}

/** Opportunistic cleanup of old challenges (kept 24 h for rate limiting and support). */
export async function sweepExpiredOtpChallenges(now = new Date()) {
  return db.authOtpChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * HOUR_MS) } } });
}
