import { createHash } from "crypto";
import { Prisma } from "@/platform/database/generated/client";

import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";

/**
 * `Idempotency-Key` support for public form submissions (guest enquiries, viewing requests).
 *
 * - A key is claimed atomically (unique `scope` + key hash) before the work runs.
 * - A replay with the SAME key and the SAME submission returns the stored original response — no
 *   second lead, no second notification, no rate-limit charge.
 * - The same key with DIFFERENT contents is rejected (422) instead of silently reusing a result.
 * - A concurrent duplicate while the first is still running gets 409 (retry shortly).
 * - If the original attempt fails, the claim is released so the client can retry with the same key.
 */

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * A PENDING claim older than this is treated as abandoned (crashed or timed-out request) and may be
 * retaken. The public write routes set `maxDuration = 30`, so no live request can still be running.
 */
export const STALE_PENDING_MS = 2 * 60 * 1000;

export type IdempotentResult = { status: number; body: unknown; replayed: boolean };

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** JSON with object keys sorted recursively, so key order never changes the fingerprint. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value instanceof Date ? value.toISOString() : value) ?? "null";
}

export function fingerprintOf(parts: unknown) {
  return sha256(canonicalJson(parts));
}

/** Reads and validates the optional `Idempotency-Key` header. */
export function readIdempotencyKey(headers: Headers) {
  const key = headers.get("idempotency-key")?.trim();
  if (!key) return null;
  if (!KEY_PATTERN.test(key)) {
    throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "Idempotency-Key must be 16–128 letters, digits, '-' or '_'.");
  }
  return key;
}

async function claim(scope: string, keyHash: string, fingerprint: string, now: Date) {
  try {
    await db.publicIdempotencyRecord.create({
      data: { scope, keyHash, fingerprint, status: "PENDING", expiresAt: new Date(now.getTime() + RECORD_TTL_MS) },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

/**
 * Runs `work` at most once per (scope, key) for a given submission fingerprint. Without a key the
 * work simply runs. `work` returns the HTTP status and JSON body to store and send.
 */
export async function runIdempotent(
  input: { scope: string; key: string | null; fingerprint: string; now?: Date },
  work: () => Promise<{ status: number; body: unknown }>,
): Promise<IdempotentResult> {
  if (!input.key) return { ...(await work()), replayed: false };
  const now = input.now ?? new Date();
  const keyHash = sha256(input.key);
  const where = { scope_keyHash: { scope: input.scope, keyHash } };

  if (!(await claim(input.scope, keyHash, input.fingerprint, now))) {
    const existing = await db.publicIdempotencyRecord.findUnique({ where });
    const reclaimable =
      !existing ||
      existing.expiresAt <= now ||
      (existing.status === "PENDING" && now.getTime() - existing.createdAt.getTime() > STALE_PENDING_MS);
    if (reclaimable) {
      // Remove only the exact expired/stale row we inspected, then race for a fresh claim.
      if (existing) await db.publicIdempotencyRecord.deleteMany({ where: { id: existing.id, status: existing.status, createdAt: existing.createdAt } });
      if (!(await claim(input.scope, keyHash, input.fingerprint, now))) {
        throw new AppError("IDEMPOTENCY_REQUEST_IN_PROGRESS", 409, "This submission is already being processed. Please wait a moment.");
      }
    } else if (existing.fingerprint !== input.fingerprint) {
      throw new AppError(
        "IDEMPOTENCY_KEY_REUSED",
        422,
        "This request key was already used for a different submission. Start a new submission instead of reusing the key.",
      );
    } else if (existing.status === "COMPLETED" && existing.responseStatus !== null) {
      return { status: existing.responseStatus, body: existing.responseBody, replayed: true };
    } else {
      throw new AppError("IDEMPOTENCY_REQUEST_IN_PROGRESS", 409, "This submission is already being processed. Please wait a moment.");
    }
  }

  let result: { status: number; body: unknown };
  try {
    result = await work();
  } catch (error) {
    // The work failed, so nothing was created: release the claim so the same submission can be
    // retried (validation, 404, 429, transient database error…).
    await db.publicIdempotencyRecord.deleteMany({ where: { scope: input.scope, keyHash, status: "PENDING" } }).catch(() => undefined);
    throw error;
  }
  try {
    await db.publicIdempotencyRecord.update({
      where,
      data: { status: "COMPLETED", responseStatus: result.status, responseBody: JSON.parse(JSON.stringify(result.body)), completedAt: new Date() },
    });
  } catch {
    // The work DID succeed; keep the PENDING claim rather than releasing it, so an immediate retry
    // gets 409 instead of creating a duplicate. It becomes reclaimable after STALE_PENDING_MS.
    // Logged without the key, scope contents or submission data.
    console.error("Idempotency record could not be marked completed; claim left pending.");
  }
  return { ...result, replayed: false };
}
