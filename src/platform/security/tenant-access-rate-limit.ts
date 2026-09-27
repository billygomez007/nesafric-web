import { createHmac } from "crypto";

import { db } from "@/platform/database/client";
import { AppError, errorResponse } from "@/platform/errors";
import { ipRateLimitKey, resolveClientIdentity } from "./client-ip";

const TEN_MINUTES = 10 * 60;
const DAY = 24 * 60 * 60;

type Rule = {
  id: string;
  windowSeconds: number;
  limit: number;
  key: "user" | "ip";
};

const RULES: Rule[] = [
  { id: "tenant-access.user.10m", windowSeconds: TEN_MINUTES, limit: 10, key: "user" },
  { id: "tenant-access.user.day", windowSeconds: DAY, limit: 40, key: "user" },
  { id: "tenant-access.ip.10m", windowSeconds: TEN_MINUTES, limit: 30, key: "ip" },
  { id: "tenant-access.ip.day", windowSeconds: DAY, limit: 150, key: "ip" },
];

function hashKey(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to hash tenant-access rate-limit keys.");
  return createHmac("sha256", secret).update(value).digest("hex");
}

function windowFor(rule: Rule, now: Date) {
  const ms = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / ms) * ms);
  return { windowStart, expiresAt: new Date(windowStart.getTime() + ms) };
}

export class TenantAccessRateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(
      "TENANT_ACCESS_RATE_LIMITED",
      429,
      "Too many access-code attempts. Please wait and try again.",
      { retryAfterSeconds },
    );
  }
}

export async function reserveTenantAccessAttempt(
  headers: Headers,
  userId: string,
  now = new Date(),
) {
  const ip = resolveClientIdentity(headers).ip;
  const ipKey = ip ? ipRateLimitKey(ip) : null;

  const plan = RULES.flatMap((rule) => {
    const value =
      rule.key === "user"
        ? `user:${userId}`
        : ipKey
          ? `ip:${ipKey}`
          : null;

    if (!value) return [];

    return [
      {
        rule,
        keyHash: hashKey(value),
        ...windowFor(rule, now),
      },
    ];
  });

  await db.$transaction(
    async (tx) => {
      for (const { rule, keyHash, windowStart, expiresAt } of plan) {
        const rows = await tx.$queryRaw<{ count: number }[]>`
          INSERT INTO "PublicWriteCounter"
            ("bucket", "keyHash", "windowStart", "count", "expiresAt")
          VALUES
            (${rule.id}, ${keyHash}, ${windowStart}, 1, ${expiresAt})
          ON CONFLICT ("bucket", "keyHash", "windowStart")
          DO UPDATE
            SET "count" = "PublicWriteCounter"."count" + 1
            WHERE "PublicWriteCounter"."count" < ${rule.limit}
          RETURNING "count"
        `;

        if (!rows.length) {
          throw new TenantAccessRateLimitError(
            Math.max(
              1,
              Math.ceil((expiresAt.getTime() - now.getTime()) / 1000),
            ),
          );
        }
      }
    },
    { maxWait: 10_000, timeout: 10_000 },
  );
}

export function tenantAccessErrorResponse(error: unknown) {
  const response = errorResponse(error);

  if (error instanceof TenantAccessRateLimitError) {
    response.headers.set("Retry-After", String(error.retryAfterSeconds));
  }

  response.headers.set("Cache-Control", "no-store");
  return response;
}
