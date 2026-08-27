import { db } from "@/platform/database/client";
import type { Prisma } from "@/platform/database/generated/client";
import { AppError } from "@/platform/errors";
import { resolveEntitlement } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import { resolveMarketplaceEntitlement } from "@/modules/marketplace-professionals/entitlements";
import { MARKETPLACE_ENTITLEMENTS } from "@/modules/marketplace-professionals/catalog";

/**
 * Phase 22C item 10/11 — call-concurrency readiness, race-safe. Every limit is read from either
 * the capability-based entitlement engine (the organisation-wide ceiling, which differs by plan)
 * or from `VoiceProviderConfig` (operational, organisation-configurable ceilings) — never a
 * hard-coded plan name anywhere in this module.
 */

const LIVE_STATUSES = ["QUEUED", "RINGING", "IN_PROGRESS"] as const;

export type EffectiveLimit = { isUnlimited: boolean; limitValue: number | null };

/** Resolves the org-wide concurrent-call ceiling from the correct entitlement engine — PropertyOS
 * or Marketplace — for the organisation a given call belongs to. */
export async function resolveConcurrentCallLimit(organisationId: string, marketplaceProfessionalId: string | null): Promise<EffectiveLimit> {
  if (marketplaceProfessionalId) {
    const effective = await resolveMarketplaceEntitlement(marketplaceProfessionalId, MARKETPLACE_ENTITLEMENTS.voiceConcurrentCallsMax.key);
    return { isUnlimited: effective.isUnlimited, limitValue: effective.limitValue };
  }
  const effective = await resolveEntitlement(organisationId, ENTITLEMENTS.voiceConcurrentCallsMax.key);
  return { isUnlimited: effective.isUnlimited, limitValue: effective.limitValue };
}

export type ConcurrencyGuardOptions = {
  organisationLimit: EffectiveLimit;
  direction: "INBOUND" | "OUTBOUND";
  maxConcurrentOutbound?: number;
  aiEmployeeId?: string | null;
  maxPerEmployee?: number;
  concurrencyNumber?: string;
  maxPerNumber?: number;
};

/**
 * Races two simultaneous call-creation attempts for the same organisation against each other by
 * serializing them on a `FOR UPDATE` lock over that organisation's own `VoiceProviderConfig` row
 * (guaranteed to already exist by the time any call is placed — every call-creation path calls
 * `ensureProviderConfig` first), counting live calls, and creating the new `VoiceCall` row in the
 * SAME transaction as that count. A plain "count, then insert" outside a lock leaves exactly the
 * race window item 10 warns about; this closes it — two concurrent attempts against the same
 * near-exhausted limit can never both succeed, because the second transaction blocks on the row
 * lock until the first commits (or rolls back), and re-counts after that.
 */
export async function reserveVoiceCallSlot<T>(organisationId: string, limits: ConcurrencyGuardOptions, create: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "VoiceProviderConfig" WHERE "organisationId" = ${organisationId}::uuid FOR UPDATE`;

    if (!limits.organisationLimit.isUnlimited) {
      const orgCount = await tx.voiceCall.count({ where: { organisationId, status: { in: [...LIVE_STATUSES] } } });
      if (orgCount >= (limits.organisationLimit.limitValue ?? 0)) {
        throw new AppError("VOICE_CONCURRENCY_LIMIT_REACHED", 429, "This organisation has reached its concurrent AI voice call limit.");
      }
    }
    if (limits.direction === "OUTBOUND" && limits.maxConcurrentOutbound !== undefined) {
      const outboundCount = await tx.voiceCall.count({ where: { organisationId, direction: "OUTBOUND", status: { in: [...LIVE_STATUSES] } } });
      if (outboundCount >= limits.maxConcurrentOutbound) {
        throw new AppError("VOICE_OUTBOUND_CONCURRENCY_LIMIT_REACHED", 429, "The maximum number of concurrent outbound calls is already in progress.");
      }
    }
    if (limits.aiEmployeeId && limits.maxPerEmployee !== undefined) {
      const employeeCount = await tx.voiceCall.count({ where: { aiEmployeeId: limits.aiEmployeeId, status: { in: [...LIVE_STATUSES] } } });
      if (employeeCount >= limits.maxPerEmployee) {
        throw new AppError("VOICE_EMPLOYEE_CONCURRENCY_LIMIT_REACHED", 429, "This AI employee has reached its concurrent call limit.");
      }
    }
    if (limits.concurrencyNumber && limits.maxPerNumber !== undefined) {
      const numberCount = await tx.voiceCall.count({ where: { organisationId, OR: [{ fromNumber: limits.concurrencyNumber }, { toNumber: limits.concurrencyNumber }], status: { in: [...LIVE_STATUSES] } } });
      if (numberCount >= limits.maxPerNumber) {
        throw new AppError("VOICE_NUMBER_CONCURRENCY_LIMIT_REACHED", 429, "This phone number has reached its concurrent call limit.");
      }
    }
    return create(tx);
  });
}
