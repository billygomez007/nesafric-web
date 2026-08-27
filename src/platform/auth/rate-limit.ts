import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 8;

function normalizeKey(email: unknown) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/**
 * DB-backed (not in-memory — a serverless/multi-instance deployment shares no process memory)
 * per-email login rate limit. Only failed attempts count against the window; a correct password
 * never gets rate-limited by prior unrelated failures once it succeeds. Opportunistically prunes
 * this email's own old attempt rows on every call, keeping the table bounded without a separate
 * cleanup job.
 */
export async function assertLoginNotRateLimited(email: unknown) {
  const emailKey = normalizeKey(email);
  const since = new Date(Date.now() - WINDOW_MS);
  await db.loginAttempt.deleteMany({ where: { emailKey, createdAt: { lt: since } } });
  const failedCount = await db.loginAttempt.count({ where: { emailKey, succeeded: false, createdAt: { gte: since } } });
  if (failedCount >= MAX_FAILED_ATTEMPTS) {
    throw new AppError("LOGIN_RATE_LIMITED", 429, "Too many failed login attempts. Try again in a few minutes.");
  }
}

export async function recordLoginAttempt(email: unknown, succeeded: boolean) {
  await db.loginAttempt.create({ data: { emailKey: normalizeKey(email), succeeded } });
}
