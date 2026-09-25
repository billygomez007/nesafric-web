import { createHmac } from "crypto";

import { db } from "@/platform/database/client";
import { AppError, errorResponse } from "@/platform/errors";
import { ipRateLimitKey, resolveClientIdentity } from "./client-ip";

/**
 * Enforced rate limits for unauthenticated public writes (guest enquiries, viewing requests, and
 * the web-chat paths that create them).
 *
 * Each rule is a fixed-window counter incremented with one atomic
 * `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`. Postgres serialises
 * concurrent upserts of the same row, so every request observes a distinct count and exactly
 * `limit` requests per window can pass — no separate "count then record" race.
 *
 * Rules are evaluated narrowest identity first and stop at the first rejection, so a request
 * blocked for its own IP/contact never consumes the shared per-listing budget.
 *
 * IP limits are deliberately loose (many Ghanaian mobile subscribers share carrier-NAT addresses);
 * the tighter controls are per contact, per IP+listing and per lead. All limits are adjustable
 * without a deploy via `PUBLIC_WRITE_LIMITS`, e.g. `{"enquiry.ip.10m":40,"enquiry.ip.day":300}`.
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

export function publicWriteRules(kind: PublicWriteKind, env: Env = process.env): Rule[] {
  let overrides: Record<string, unknown> = {};
  if (env.PUBLIC_WRITE_LIMITS) {
    try {
      const parsed = JSON.parse(env.PUBLIC_WRITE_LIMITS);
      if (parsed && typeof parsed === "object") overrides = parsed;
    } catch {
      console.warn("PUBLIC_WRITE_LIMITS is not valid JSON; using default public write limits.");
    }
  }
  return DEFAULT_PUBLIC_WRITE_RULES[kind].map((rule) => {
    const value = overrides[rule.id];
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? { ...rule, limit: value } : rule;
  });
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

/** Atomically increments one fixed-window counter and returns the count including this request. */
async function increment(rule: Rule, key: string, now: Date) {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const expiresAt = new Date(windowStart.getTime() + windowMs);
  const [row] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "PublicWriteCounter" ("bucket", "keyHash", "windowStart", "count", "expiresAt")
    VALUES (${rule.id}, ${hashKey(key)}, ${windowStart}, 1, ${expiresAt})
    ON CONFLICT ("bucket", "keyHash", "windowStart")
    DO UPDATE SET "count" = "PublicWriteCounter"."count" + 1
    RETURNING "count"`;
  return { count: Number(row.count), retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)) };
}

export class PublicWriteRateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("PUBLIC_WRITE_RATE_LIMITED", 429, "Too many requests. Please wait a little and try again.", { retryAfterSeconds });
  }
}

/**
 * Throws `PublicWriteRateLimitError` (429, with `retryAfterSeconds`) when any rule is exceeded.
 * `headers` must be the incoming request headers; the IP identity comes only from trusted
 * infrastructure headers (see `client-ip.ts`).
 */
export async function assertPublicWriteAllowed(headers: Headers, subject: PublicWriteSubject, options: { env?: Env; now?: Date } = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const ipKey = ipRateLimitKey(resolveClientIdentity(headers, env).ip);
  for (const rule of publicWriteRules(subject.kind, env)) {
    const key = keyFor(rule, subject, ipKey);
    if (!key) continue;
    const { count, retryAfterSeconds } = await increment(rule, key, now);
    if (count > rule.limit) throw new PublicWriteRateLimitError(retryAfterSeconds);
  }
  // Keep the table bounded without a separate job (cheap: indexed, small batches).
  if (Math.random() < 0.05) {
    await db.$executeRaw`DELETE FROM "PublicWriteCounter" WHERE ctid IN (SELECT ctid FROM "PublicWriteCounter" WHERE "expiresAt" < ${now} LIMIT 500)`.catch(() => undefined);
  }
}

/** `errorResponse` plus `Retry-After` on rate-limit rejections; never cached. */
export function publicWriteErrorResponse(error: unknown) {
  const response = errorResponse(error);
  if (error instanceof PublicWriteRateLimitError) response.headers.set("Retry-After", String(error.retryAfterSeconds));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
