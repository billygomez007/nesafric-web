import type { Prisma } from "@/platform/database/generated/client";
import { JobDeadlineExceededError, remainingJobTimeMs } from "@/platform/jobs/deadline";
import { baseClient, db } from "@/platform/database/client";
import { runGuarded } from "@/platform/database/guarded";

type Client = Prisma.TransactionClient | typeof db;

/**
 * WhatsApp channel config keys that name a number. Every number sends with one Meta system-user
 * token, so a value here never grants anything: only an active `WhatsAppNumberAssignment`, which
 * NesAfric platform admins create, lets an organisation send or receive as a number. Values an
 * organisation saved before assignment became platform-only stay in its config as an unreviewed
 * claim for the platform's review list.
 */
export const PLATFORM_ASSIGNED_WHATSAPP_KEYS = ["phoneNumberId", "businessAccountId"] as const;

/*
 * Lock order (advisory, transaction-scoped):
 *   1. `whatsapp-number-assignments` — every platform assignment, move and release, one at a time;
 *   2. `whatsapp-processing:<organisationId>` — exclusive for an assignment change (sorted
 *      organisation order); shared for the whole time an inbound message is being decided and
 *      acted on, so its side effects never straddle a move;
 *   3. `whatsapp-channel:<organisationId>` — exclusive for anything that changes a channel or its
 *      assignment (sorted organisation order); shared for short work that reads the assignment and
 *      must not overlap a change: inbound receipt, queueing and sending.
 * Outside the platform path a transaction takes at most one channel lock, and nothing waits for a
 * processing lock while holding a channel lock, so shared holders never wait in a cycle with an
 * assignment.
 */
const channelKey = (organisationId: string) => `whatsapp-channel:${organisationId}`;
const processingKey = (organisationId: string) => `whatsapp-processing:${organisationId}`;

export async function lockWhatsAppAssignments(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"whatsapp-number-assignments"}, 0))`;
}

export async function lockWhatsAppProcessing(tx: Prisma.TransactionClient, organisationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${processingKey(organisationId)}, 0))`;
}

export async function lockWhatsAppChannel(tx: Prisma.TransactionClient, organisationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${channelKey(organisationId)}, 0))`;
}

export async function lockWhatsAppChannelShared(tx: Prisma.TransactionClient, organisationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${channelKey(organisationId)}, 0))`;
}

/**
 * Runs inbound processing (deciding, its side effects, and the reply) while the organisation's
 * number assignment cannot change. The work runs as guarded work (`runGuarded`): all of its
 * database calls go through the transaction that holds the shared processing lock, so its writes
 * commit together with the lock or not at all. If the guard's deadline passes or its connection
 * is lost, the lock is released, the writes are rolled back, and anything the work still tries
 * afterwards fails; external sends check `assertGuardedWorkActive()` first.
 */
export async function withWhatsAppProcessingGuard<T>(organisationId: string, work: () => Promise<T>): Promise<T> {
  const timeout = guardTimeoutMs();
  return runGuarded(baseClient, async (guard) => {
    await guard.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${processingKey(organisationId)}, 0))`;
  }, work, { timeout, maxWait: Math.min(10_000, timeout) });
}

/**
 * The guard's own limit, never longer than the running job's deadline (the post-response fast
 * path shares a serverless function's lifetime): the transaction then ends, and rolls back, by
 * itself before the host stops. Too little time left means the job fails now and is retried.
 */
function guardTimeoutMs() {
  const configured = whatsappProcessingTimeoutMs();
  const remaining = remainingJobTimeMs();
  if (remaining === null) return configured;
  const available = remaining - GUARD_DEADLINE_MARGIN_MS;
  if (available < MIN_GUARD_TIMEOUT_MS) throw new JobDeadlineExceededError(Math.max(0, remaining));
  return Math.min(configured, available);
}
const GUARD_DEADLINE_MARGIN_MS = 250;
const MIN_GUARD_TIMEOUT_MS = 100;

/** How long one processing pass may hold the guard (`WHATSAPP_PROCESSING_TIMEOUT_MS`, default 120s). */
export function whatsappProcessingTimeoutMs(env: Record<string, string | undefined> = process.env) {
  const value = Number(env.WHATSAPP_PROCESSING_TIMEOUT_MS);
  return Number.isInteger(value) && value >= 100 && value <= 600_000 ? value : 120_000;
}

/** The number NesAfric approved for this organisation, or null. */
export function activeWhatsAppAssignment(client: Client, organisationId: string) {
  return client.whatsAppNumberAssignment.findUnique({ where: { activeOrganisationId: organisationId } });
}

export const channelSettings = (config: unknown) => (config && typeof config === "object" && !Array.isArray(config) ? config : {}) as Record<string, unknown>;

/** Channel settings without any number the organisation stored itself. */
export function withoutWhatsAppNumber(config: unknown) {
  const settings = { ...channelSettings(config) };
  for (const key of PLATFORM_ASSIGNED_WHATSAPP_KEYS) delete settings[key];
  return settings;
}

/** Channel settings with the number taken from the assignment, never from the stored config. */
export function trustedWhatsAppConfig(config: unknown, assignment: { phoneNumberId: string; businessAccountId: string | null }) {
  return { ...withoutWhatsAppNumber(config), phoneNumberId: assignment.phoneNumberId, ...(assignment.businessAccountId ? { businessAccountId: assignment.businessAccountId } : {}) };
}

/** Reasons recorded when a reply is refused because of where its conversation came from. */
export const WHATSAPP_OLD_CONVERSATION_REASON = "This conversation was received under a WhatsApp number assignment the organisation no longer has.";
export const WHATSAPP_UNVERIFIED_CONVERSATION_REASON = "The WhatsApp number this conversation was received on cannot be verified, so no reply is sent until the customer writes again.";

/** Reason recorded when work queued under one assignment meets a different one. */
export const WHATSAPP_REASSIGNED_REASON = "The WhatsApp number assignment changed after this was queued, so it was not sent.";
