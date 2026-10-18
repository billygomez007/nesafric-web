import { db } from "@/platform/database/client";
import { errorLabel } from "./log";

/**
 * Retention for data the WhatsApp assistant itself stores. Business records the assistant created
 * through the platform's services (listings, registrations, leads, viewings, service requests,
 * uploaded documents) are out of scope: they follow the platform's own retention.
 *
 * Off unless `WHATSAPP_RETENTION_ENABLED=true`. Each run is bounded (`batchSize` rows per batch,
 * `maxBatches` batches per category) so it never holds long locks or runs past a request timeout;
 * a backlog is worked through over successive runs.
 *
 * Guarantees kept while purging:
 * - Messages still waiting to be processed (RECEIVED/PROCESSING) or sent (QUEUED) are never
 *   touched, so retention can't lose or re-send anything.
 * - Redaction keeps `waMessageId` and `idempotencyKey`, so deduplication of webhook redeliveries
 *   and of replies keeps working until a row is deleted — long after Meta stops redelivering.
 * - Workflows are cleared only when inactive for `abandonedWorkflowDays`, unleased and with no
 *   pending message, so an active conversation is never reset.
 * - An action binding is deleted only once the inbound message that could repeat the action is
 *   gone (and `actionDays` ≥ `deleteDays`), so retention can never let an action run twice.
 */
export type WhatsAppRetentionPolicy = {
  enabled: boolean;
  /** Redact inbound text/content and outbound payloads after this many days. */
  contentDays: number;
  /** Delete processed inbound and finished outbound rows after this many days. */
  deleteDays: number;
  /** Clear the state of workflows inactive for this many days. */
  abandonedWorkflowDays: number;
  /** Delete analytics events after this many days. */
  eventDays: number;
  /** Delete RESOLVED support requests this many days after resolution. */
  supportDays: number;
  /** Delete action bindings after this many days (only once their message is gone). */
  actionDays: number;
  batchSize: number;
  maxBatches: number;
};

export const RETENTION_DEFAULTS = {
  contentDays: 30,
  deleteDays: 180,
  abandonedWorkflowDays: 60,
  eventDays: 400,
  supportDays: 365,
  actionDays: 400,
  batchSize: 500,
  maxBatches: 10,
} as const;

/** Meta redelivers an unacknowledged webhook for up to 7 days; content must outlive that. */
const MIN_CONTENT_DAYS = 8;

export class RetentionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetentionConfigError";
  }
}

type Env = Record<string, string | undefined>;

function days(env: Env, name: string, fallback: number) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new RetentionConfigError(`${name} must be a positive whole number of days.`);
  return value;
}

/** Reads and validates the policy. An invalid policy throws, so nothing is purged with it. */
export function whatsAppRetentionPolicy(env: Env = process.env): WhatsAppRetentionPolicy {
  const policy: WhatsAppRetentionPolicy = {
    enabled: env.WHATSAPP_RETENTION_ENABLED === "true",
    contentDays: days(env, "WHATSAPP_RETENTION_CONTENT_DAYS", RETENTION_DEFAULTS.contentDays),
    deleteDays: days(env, "WHATSAPP_RETENTION_DELETE_DAYS", RETENTION_DEFAULTS.deleteDays),
    abandonedWorkflowDays: days(env, "WHATSAPP_RETENTION_ABANDONED_WORKFLOW_DAYS", RETENTION_DEFAULTS.abandonedWorkflowDays),
    eventDays: days(env, "WHATSAPP_RETENTION_EVENT_DAYS", RETENTION_DEFAULTS.eventDays),
    supportDays: days(env, "WHATSAPP_RETENTION_SUPPORT_DAYS", RETENTION_DEFAULTS.supportDays),
    actionDays: days(env, "WHATSAPP_RETENTION_ACTION_DAYS", RETENTION_DEFAULTS.actionDays),
    batchSize: Math.min(days(env, "WHATSAPP_RETENTION_BATCH_SIZE", RETENTION_DEFAULTS.batchSize), 5_000),
    maxBatches: Math.min(days(env, "WHATSAPP_RETENTION_MAX_BATCHES", RETENTION_DEFAULTS.maxBatches), 100),
  };
  if (policy.contentDays < MIN_CONTENT_DAYS) {
    throw new RetentionConfigError(`WHATSAPP_RETENTION_CONTENT_DAYS must be at least ${MIN_CONTENT_DAYS} (webhook redelivery window).`);
  }
  if (policy.deleteDays < policy.contentDays) throw new RetentionConfigError("WHATSAPP_RETENTION_DELETE_DAYS must be at least WHATSAPP_RETENTION_CONTENT_DAYS.");
  if (policy.actionDays < policy.deleteDays) throw new RetentionConfigError("WHATSAPP_RETENTION_ACTION_DAYS must be at least WHATSAPP_RETENTION_DELETE_DAYS.");
  return policy;
}

export type RetentionReport = Record<
  "inboundRedacted" | "outboundRedacted" | "inboundDeleted" | "outboundDeleted" | "workflowsCleared" | "eventsDeleted" | "supportDeleted" | "actionsDeleted",
  number
>;

const TERMINAL_INBOUND = ["PROCESSED", "FAILED", "IGNORED"] as const;
const TERMINAL_OUTBOUND = ["SENT", "DELIVERED", "READ", "FAILED", "SKIPPED"] as const;
const ago = (now: Date, count: number) => new Date(now.getTime() - count * 86_400_000);

/** Runs `step` (one bounded batch, returning rows affected) until it runs dry or the cap is hit. */
async function inBatches(policy: WhatsAppRetentionPolicy, step: () => Promise<number>) {
  let total = 0;
  for (let batch = 0; batch < policy.maxBatches; batch += 1) {
    const affected = await step();
    total += affected;
    if (affected < policy.batchSize) break;
  }
  return total;
}

const ids = (rows: Array<{ id: string }>) => rows.map(({ id }) => id);

export async function purgeExpiredWhatsAppData(now = new Date(), policy = whatsAppRetentionPolicy()): Promise<RetentionReport | null> {
  if (!policy.enabled) return null;
  const take = policy.batchSize;
  const contentCutoff = ago(now, policy.contentDays);
  const deleteCutoff = ago(now, policy.deleteDays);
  const report: RetentionReport = {
    inboundRedacted: 0, outboundRedacted: 0, inboundDeleted: 0, outboundDeleted: 0, workflowsCleared: 0, eventsDeleted: 0, supportDeleted: 0, actionsDeleted: 0,
  };

  report.inboundRedacted = await inBatches(policy, async () => {
    const where = { status: { in: [...TERMINAL_INBOUND] }, receivedAt: { lt: contentCutoff }, redactedAt: null };
    const rows = await db.whatsAppInboundMessage.findMany({ where, select: { id: true }, orderBy: { receivedAt: "asc" }, take });
    if (!rows.length) return 0;
    // The status condition is re-checked in the update itself.
    return (await db.whatsAppInboundMessage.updateMany({ where: { id: { in: ids(rows) }, ...where }, data: { text: null, content: {}, redactedAt: now } })).count;
  });

  report.outboundRedacted = await inBatches(policy, async () => {
    const where = { status: { in: [...TERMINAL_OUTBOUND] }, createdAt: { lt: contentCutoff }, redactedAt: null };
    const rows = await db.whatsAppOutboundMessage.findMany({ where, select: { id: true }, orderBy: { createdAt: "asc" }, take });
    if (!rows.length) return 0;
    return (await db.whatsAppOutboundMessage.updateMany({ where: { id: { in: ids(rows) }, ...where }, data: { payload: { redacted: true }, redactedAt: now } })).count;
  });

  report.inboundDeleted = await inBatches(policy, async () => {
    const where = { status: { in: [...TERMINAL_INBOUND] }, receivedAt: { lt: deleteCutoff } };
    const rows = await db.whatsAppInboundMessage.findMany({ where, select: { id: true }, orderBy: { receivedAt: "asc" }, take });
    if (!rows.length) return 0;
    return (await db.whatsAppInboundMessage.deleteMany({ where: { id: { in: ids(rows) }, ...where } })).count;
  });

  report.outboundDeleted = await inBatches(policy, async () => {
    const where = { status: { in: [...TERMINAL_OUTBOUND] }, createdAt: { lt: deleteCutoff } };
    const rows = await db.whatsAppOutboundMessage.findMany({ where, select: { id: true }, orderBy: { createdAt: "asc" }, take });
    if (!rows.length) return 0;
    return (await db.whatsAppOutboundMessage.deleteMany({ where: { id: { in: ids(rows) }, ...where } })).count;
  });

  report.workflowsCleared = await inBatches(policy, async () => {
    const where = {
      lastActivityAt: { lt: ago(now, policy.abandonedWorkflowDays) },
      OR: [{ workflow: { not: null } }, { NOT: { data: { equals: {} } } }],
      AND: [{ OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }],
      contact: { inbound: { none: { status: { in: ["RECEIVED" as const, "PROCESSING" as const] } } } },
    };
    const rows = await db.whatsAppAssistantSession.findMany({ where, select: { id: true }, orderBy: { lastActivityAt: "asc" }, take });
    if (!rows.length) return 0;
    // Same conditions in the update: a conversation that became active (or leased) meanwhile is kept.
    return (await db.whatsAppAssistantSession.updateMany({
      where: { id: { in: ids(rows) }, ...where },
      data: { workflow: null, step: null, data: {} },
    })).count;
  });

  report.eventsDeleted = await inBatches(policy, async () => {
    const rows = await db.whatsAppAssistantEvent.findMany({ where: { createdAt: { lt: ago(now, policy.eventDays) } }, select: { id: true }, orderBy: { createdAt: "asc" }, take });
    if (!rows.length) return 0;
    return (await db.whatsAppAssistantEvent.deleteMany({ where: { id: { in: ids(rows) } } })).count;
  });

  report.supportDeleted = await inBatches(policy, async () => {
    const where = { status: "RESOLVED" as const, resolvedAt: { lt: ago(now, policy.supportDays) } };
    const rows = await db.whatsAppSupportRequest.findMany({ where, select: { id: true }, orderBy: { createdAt: "asc" }, take });
    if (!rows.length) return 0;
    return (await db.whatsAppSupportRequest.deleteMany({ where: { id: { in: ids(rows) }, ...where } })).count;
  });

  report.actionsDeleted = await inBatches(policy, async () => (
    // Action keys are `<kind>:<inbound message id>[:<sub-action>]`: keep a binding while its
    // message still exists, since only that message could ever ask for the action again.
    db.$executeRaw`
      DELETE FROM "WhatsAppAction" WHERE "id" IN (
        SELECT a."id" FROM "WhatsAppAction" a
        WHERE a."createdAt" < ${ago(now, policy.actionDays)}
          AND NOT EXISTS (SELECT 1 FROM "WhatsAppInboundMessage" m WHERE m."id"::text = split_part(a."actionKey", ':', 2))
        ORDER BY a."createdAt"
        LIMIT ${take}
      )`
  ));

  return report;
}

/** Scheduled entry point (jobs route and worker): never throws, logs counts only. */
export async function runWhatsAppRetention(now = new Date()) {
  try {
    const report = await purgeExpiredWhatsAppData(now);
    if (report && Object.values(report).some(Boolean)) console.info("[whatsapp-assistant] retention", report);
    return report;
  } catch (error) {
    // A configuration error's message is our own text (which setting is invalid), never data.
    const reason = error instanceof RetentionConfigError ? error.message : undefined;
    console.error("[whatsapp-assistant] retention skipped", { error: errorLabel(error), reason });
    return null;
  }
}
