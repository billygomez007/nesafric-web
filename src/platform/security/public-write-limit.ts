import { createHmac } from "crypto";

import { db } from "@/platform/database/client";
import { AppError, errorResponse } from "@/platform/errors";
import { ipRateLimitKey, resolveClientIdentity } from "./client-ip";

/**
 * Enforced rate limits for unauthenticated public writes (guest enquiries, viewing requests, and
 * the web-chat paths that create them).
 *
 * - Each rule is a fixed-window counter updated with a conditional atomic upsert
 *   (`… ON CONFLICT DO UPDATE SET count = count + 1 WHERE count < limit RETURNING count`), so
 *   simultaneous requests can never take more than `limit` slots.
 * - All rules for one request run in one transaction: if any rule is full the transaction rolls
 *   back, so a rejected request charges NO counter (all-or-nothing).
 * - `reservePublicWrite` returns `release()`, which refunds the slots when the protected work then
 *   fails (listing not found, viewing time in the past, …), so failed submissions cost nothing.
 *
 * IP limits are deliberately loose (many Ghanaian mobile subscribers share carrier-NAT addresses);
 * the tighter controls are per contact, per IP+listing and per lead. Limits can be overridden with
 * `PUBLIC_WRITE_LIMITS` (JSON of rule id -> integer 1..10000). It's an environment variable, so on
 * Vercel a change takes effect on the next deployment (redeploy; no code change needed).
 */

export type PublicWriteKind = "enquiry" | "viewing";

type Rule = { id: string; scope: "ip" | "contact" | "ip-listing" | "listing" | "lead"; windowSeconds: number; limit: number };

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEFAULT_PUBLIC_WRITE_RULES: Record<PublicWriteKind, Rule[]> = {
  enquiry: [
    { id: "enquiry.ip.10m", scope: "ip", windowSeconds: 10 * MINUTE, limit: 30 },
    { id: "enquiry.ip.day", scope: "ip", windowSeconds: DAY, limit: 200 },
    { id: "enquiry.contact.hour", scope: "contact", windowSeconds: HOUR, limit: 5 },
    { id: "enquiry.contact.day", scope: "contact", windowSeconds: DAY, limit: 20 },
    { id: "enquiry.ip-listing.hour", scope: "ip-listing", windowSeconds: HOUR, limit: 5 },
    { id: "enquiry.listing.hour", scope: "listing", windowSeconds: HOUR, limit: 60 },
  ],
  viewing: [
    { id: "viewing.ip.10m", scope: "ip", windowSeconds: 10 * MINUTE, limit: 30 },
    { id: "viewing.lead.day", scope: "lead", windowSeconds: DAY, limit: 3 },
    { id: "viewing.listing.hour", scope: "listing", windowSeconds: HOUR, limit: 60 },
  ],
};

type Env = Record<string, string | undefined>;

export const MAX_PUBLIC_WRITE_LIMIT = 10_000;

const KNOWN_RULE_IDS = new Set(Object.values(DEFAULT_PUBLIC_WRITE_RULES).flat().map((rule) => rule.id));

/**
 * Parses `PUBLIC_WRITE_LIMITS` strictly: a JSON object whose keys are known rule ids and whose
 * values are integers in 1..MAX_PUBLIC_WRITE_LIMIT. Anything else is ignored (the default applies)
 * and reported once per distinct setting value, so a typo can't silently disable a limit.
 */
export function parsePublicWriteLimitOverrides(raw: string | undefined): { overrides: Record<string, number>; problems: string[] } {
  if (!raw?.trim()) return { overrides: {}, problems: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { overrides: {}, problems: ["PUBLIC_WRITE_LIMITS is not valid JSON; all defaults apply."] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { overrides: {}, problems: ["PUBLIC_WRITE_LIMITS must be a JSON object of rule id -> limit; all defaults apply."] };
  }
  const overrides: Record<string, number> = {};
  const problems: string[] = [];
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!KNOWN_RULE_IDS.has(id)) problems.push(`PUBLIC_WRITE_LIMITS: unknown rule id "${id}" ignored.`);
    else if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_PUBLIC_WRITE_LIMIT) {
      problems.push(`PUBLIC_WRITE_LIMITS: "${id}" must be an integer from 1 to ${MAX_PUBLIC_WRITE_LIMIT}; default kept.`);
    } else overrides[id] = value;
  }
  return { overrides, problems };
}

let parsedLimits: { raw: string | undefined; overrides: Record<string, number> } | null = null;

function limitOverrides(raw: string | undefined) {
  if (!parsedLimits || parsedLimits.raw !== raw) {
    const { overrides, problems } = parsePublicWriteLimitOverrides(raw);
    for (const problem of problems) console.warn(problem);
    parsedLimits = { raw, overrides };
  }
  return parsedLimits.overrides;
}

export function publicWriteRules(kind: PublicWriteKind, env: Env = process.env): Rule[] {
  const overrides = limitOverrides(env.PUBLIC_WRITE_LIMITS);
  return DEFAULT_PUBLIC_WRITE_RULES[kind].map((rule) => (overrides[rule.id] ? { ...rule, limit: overrides[rule.id] } : rule));
}

/** Digits-only phone / lowercased email, so formatting variations share one budget. */
export function normaliseContact(contact: { email?: string | null; phone?: string | null }) {
  const email = contact.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const digits = contact.phone?.replace(/\D/g, "") ?? "";
  if (digits.length >= 7) return `phone:${digits.length > 9 ? digits.slice(-9) : digits}`;
  const raw = contact.phone?.trim().toLowerCase();
  return raw ? `phone-raw:${raw}` : null;
}

function hashKey(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to hash rate-limit keys.");
  return createHmac("sha256", secret).update(value).digest("hex");
}

export type PublicWriteSubject = {
  kind: PublicWriteKind;
  listingId: string;
  contact?: { email?: string | null; phone?: string | null };
  leadId?: string;
};

function keyFor(rule: Rule, subject: PublicWriteSubject, ipKey: string) {
  switch (rule.scope) {
    case "ip":
      return ipKey;
    case "ip-listing":
      return `${ipKey}|${subject.listingId}`;
    case "listing":
      return subject.listingId;
    case "contact":
      return subject.contact ? normaliseContact(subject.contact) : null;
    case "lead":
      return subject.leadId ?? null;
  }
}

function windowFor(rule: Rule, now: Date) {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  return { windowStart, expiresAt: new Date(windowStart.getTime() + windowMs) };
}

export class PublicWriteRateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("PUBLIC_WRITE_RATE_LIMITED", 429, "Too many requests. Please wait a little and try again.", { retryAfterSeconds });
  }
}

type Charged = { bucket: string; keyHash: string; windowStart: Date };

export type PublicWriteReservation = {
  /** Refunds this request's slots. Call when the protected work fails; safe to call more than once. */
  release: () => Promise<void>;
};

/**
 * Charges one slot in every applicable rule, all-or-nothing. Throws `PublicWriteRateLimitError`
 * (429 with `retryAfterSeconds`) when any rule is full, in which case nothing is charged.
 * `headers` must be the incoming request headers; the IP identity comes only from trusted
 * infrastructure headers (see `client-ip.ts`).
 */
export async function reservePublicWrite(headers: Headers, subject: PublicWriteSubject, options: { env?: Env; now?: Date } = {}): Promise<PublicWriteReservation> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const ipKey = ipRateLimitKey(resolveClientIdentity(headers, env).ip);
  const plan = publicWriteRules(subject.kind, env).flatMap((rule) => {
    const key = keyFor(rule, subject, ipKey);
    return key ? [{ rule, keyHash: hashKey(key), ...windowFor(rule, now) }] : [];
  });

  const charged: Charged[] = await db.$transaction(
    async (tx) => {
      const done: Charged[] = [];
      // Fixed rule order => consistent row-lock order across requests (no deadlocks).
      for (const { rule, keyHash, windowStart, expiresAt } of plan) {
        const rows = await tx.$queryRaw<{ count: number }[]>`
          INSERT INTO "PublicWriteCounter" ("bucket", "keyHash", "windowStart", "count", "expiresAt")
          VALUES (${rule.id}, ${keyHash}, ${windowStart}, 1, ${expiresAt})
          ON CONFLICT ("bucket", "keyHash", "windowStart")
          DO UPDATE SET "count" = "PublicWriteCounter"."count" + 1
          WHERE "PublicWriteCounter"."count" < ${rule.limit}
          RETURNING "count"`;
        if (rows.length === 0) {
          // Throwing rolls back every increment made above for this request.
          throw new PublicWriteRateLimitError(Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)));
        }
        done.push({ bucket: rule.id, keyHash, windowStart });
      }
      return done;
    },
    { maxWait: 10_000, timeout: 10_000 },
  );

  // Opportunistic pruning keeps both tables bounded even if the scheduled sweep isn't running.
  if (Math.random() < 0.02) await sweepExpiredPublicWriteRecords(now, 500).catch(() => undefined);

  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      for (const { bucket, keyHash, windowStart } of charged) {
        await db.$executeRaw`
          UPDATE "PublicWriteCounter" SET "count" = GREATEST("count" - 1, 0)
          WHERE "bucket" = ${bucket} AND "keyHash" = ${keyHash} AND "windowStart" = ${windowStart}`.catch(() => undefined);
      }
    },
  };
}

/** Reserves slots, runs `work`, and refunds the slots if `work` fails. */
export async function withPublicWriteReservation<T>(headers: Headers, subject: PublicWriteSubject, work: () => Promise<T>): Promise<T> {
  const reservation = await reservePublicWrite(headers, subject);
  try {
    return await work();
  } catch (error) {
    await reservation.release();
    throw error;
  }
}

/**
 * Deletes expired rate-limit counters and idempotency records in bounded batches. Run from the
 * scheduled jobs endpoint and opportunistically from `reservePublicWrite`.
 */
export async function sweepExpiredPublicWriteRecords(now = new Date(), batchSize = 5_000) {
  const counters = await db.$executeRaw`
    DELETE FROM "PublicWriteCounter" WHERE ctid IN (
      SELECT ctid FROM "PublicWriteCounter" WHERE "expiresAt" < ${now} LIMIT ${batchSize})`;
  const idempotency = await db.$executeRaw`
    DELETE FROM "PublicIdempotencyRecord" WHERE "id" IN (
      SELECT "id" FROM "PublicIdempotencyRecord" WHERE "expiresAt" < ${now} LIMIT ${batchSize})`;
  return { counters, idempotency };
}

/** `errorResponse` plus `Retry-After` on rate-limit rejections; never cached. */
export function publicWriteErrorResponse(error: unknown) {
  const response = errorResponse(error);
  if (error instanceof PublicWriteRateLimitError) response.headers.set("Retry-After", String(error.retryAfterSeconds));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
