import { randomUUID } from "node:crypto";
import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { enqueueJob } from "@/platform/jobs/runner";
import { normalizePhone } from "@/platform/identity/phone";
import { sendCloudApiMessage, type ParsedInboundMessage } from "./cloud-api";
import { whatsAppAssistantConfig } from "./config";
import { toCloudApiMessage, type Reply } from "./messages";
import { errorLabel } from "./log";

/**
 * Persistence for the WhatsApp assistant transport: contacts, deduplicated inbound messages,
 * per-contact processing leases, and an ordered, idempotent outbound queue.
 */

export const INBOUND_JOB = "whatsapp-assistant-inbound";
export const OUTBOUND_JOB = "whatsapp-assistant-outbound";
export const MAX_INBOUND_ATTEMPTS = 3;
export const MAX_OUTBOUND_ATTEMPTS = 5;
const LEASE_MS = 120_000;
const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ContactRow = Prisma.WhatsAppContactGetPayload<object>;

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export async function upsertContact(message: Pick<ParsedInboundMessage, "waId" | "profileName" | "sentAt">) {
  const phoneE164 = normalizePhone(`+${message.waId}`);
  const data = { phoneE164, ...(message.profileName ? { profileName: message.profileName.slice(0, 160) } : {}) };
  try {
    return await db.whatsAppContact.upsert({
      where: { waId: message.waId },
      update: { ...data, lastInboundAt: message.sentAt },
      create: { waId: message.waId, ...data, lastInboundAt: message.sentAt },
    });
  } catch (error) {
    // Two webhooks for a brand-new contact raced on create; the other one won.
    if (!isUniqueViolation(error)) throw error;
    return db.whatsAppContact.update({ where: { waId: message.waId }, data: { ...data, lastInboundAt: message.sentAt } });
  }
}

/**
 * Stores an inbound message once, together with its safety-net processing job, in one transaction:
 * once this returns, the message cannot be lost even if the process dies before replying. Returns
 * `null` for a duplicate delivery (Meta retries webhooks; one message id is processed once) — but
 * a duplicate of a message that is still pending re-asserts its job, so a delivery whose first
 * attempt died before acknowledging still gets processed.
 */
export async function recordInbound(contactId: string, message: ParsedInboundMessage) {
  try {
    return await db.$transaction(async (tx) => {
      const inbound = await tx.whatsAppInboundMessage.create({
        data: {
          waMessageId: message.waMessageId,
          contactId,
          type: message.type,
          text: message.text?.slice(0, 4096),
          content: JSON.parse(JSON.stringify({
            choiceId: message.choiceId ?? null,
            media: message.media ?? null,
            location: message.location ?? null,
          })),
          sentAt: message.sentAt,
        },
      });
      await tx.backgroundJob.create({ data: inboundJobData(contactId, message.waMessageId) });
      return inbound;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.whatsAppInboundMessage.findUnique({ where: { waMessageId: message.waMessageId }, select: { status: true } });
    if (existing && (existing.status === "RECEIVED" || existing.status === "PROCESSING")) await scheduleInboundProcessing(contactId, message.waMessageId, 0);
    return null;
  }
}

function inboundJobData(contactId: string, key: string, delayMs = 60_000) {
  return { type: INBOUND_JOB, idempotencyKey: `wa-in:${key}`, payload: { contactId }, runAt: new Date(Date.now() + delayMs), maxAttempts: 5 };
}

/**
 * Queues (or re-arms) a job that processes a contact. Re-arming matters: `enqueueJob` alone is a
 * no-op for a key whose job already ran, so a job that finished must be reset to run again.
 */
export async function scheduleInboundProcessing(contactId: string, key: string, delayMs = 60_000) {
  const data = inboundJobData(contactId, key, delayMs);
  await db.backgroundJob.upsert({
    where: { idempotencyKey: data.idempotencyKey },
    update: { status: "PENDING", attempts: 0, runAt: data.runAt, lockedAt: null, lastError: null },
    create: data,
  });
}

/** A processing lease: only the holder of `token` may write session state or extend/release it. */
export type Lease = { sessionId: string; contactId: string; token: string };

export class LeaseLostError extends Error {
  constructor() {
    super("The processing lease was lost to another worker.");
    this.name = "LeaseLostError";
  }
}

/**
 * Claims the contact's processing lease so their messages are handled one at a time, in order.
 * Returns the lease, or `null` while another worker holds an unexpired one. Every later write is
 * fenced by the lease token, so a worker that stalled past its lease can never commit.
 */
export async function acquireSession(contactId: string, now = new Date()): Promise<Lease | null> {
  await db.whatsAppAssistantSession.upsert({ where: { contactId }, update: {}, create: { contactId } }).catch((error) => {
    if (!isUniqueViolation(error)) throw error;
  });
  const token = randomUUID();
  const claimed = await db.whatsAppAssistantSession.updateMany({
    where: { contactId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LEASE_MS), leaseToken: token },
  });
  if (!claimed.count) return null;
  const session = await db.whatsAppAssistantSession.findUniqueOrThrow({ where: { contactId }, select: { id: true } });
  return { sessionId: session.id, contactId, token };
}

/** Extends the lease if (and only if) this worker still holds it; throws `LeaseLostError` otherwise. */
export async function extendSessionLease(lease: Lease, client: Pick<typeof db, "whatsAppAssistantSession"> | Prisma.TransactionClient = db) {
  const now = new Date();
  const extended = await client.whatsAppAssistantSession.updateMany({
    where: { id: lease.sessionId, leaseToken: lease.token, lockedUntil: { gt: now } },
    data: { lockedUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (extended.count !== 1) throw new LeaseLostError();
}

/** Releases the lease only if this worker still holds it (never another worker's newer lease). */
export async function releaseSession(lease: Lease) {
  await db.whatsAppAssistantSession.updateMany({ where: { id: lease.sessionId, leaseToken: lease.token }, data: { lockedUntil: null, leaseToken: null } });
}

/** The oldest message still to process for a contact: new, interrupted mid-processing, or failed with attempts left. */
export async function nextPendingInbound(contactId: string) {
  return db.whatsAppInboundMessage.findFirst({
    where: { contactId, status: { in: ["RECEIVED", "PROCESSING"] }, attempts: { lt: MAX_INBOUND_ATTEMPTS } },
    orderBy: [{ sentAt: "asc" }, { receivedAt: "asc" }],
  });
}

export async function hasPendingInbound(contactId: string) {
  return Boolean(await nextPendingInbound(contactId));
}

/** Within 24 hours of the person's last message WhatsApp allows free-form replies. */
export function insideServiceWindow(contact: { lastInboundAt: Date | null }, now = new Date()) {
  return Boolean(contact.lastInboundAt && now.getTime() - contact.lastInboundAt.getTime() < CUSTOMER_SERVICE_WINDOW_MS);
}

export type QueuedOutbound = { idempotencyKey: string; reply: Reply };

/** Inserts outbound rows inside the caller's transaction; a repeated key is ignored. */
export async function queueOutboundInTransaction(tx: Prisma.TransactionClient, contactId: string, messages: QueuedOutbound[]) {
  if (!messages.length) return;
  await tx.whatsAppOutboundMessage.createMany({
    data: messages.map(({ idempotencyKey, reply }) => ({
      contactId,
      idempotencyKey,
      kind: reply.kind,
      payload: JSON.parse(JSON.stringify(reply)),
    })),
    skipDuplicates: true,
  });
}

/** Never released: the person asked for no notifications. */
export const SKIP_OPTED_OUT = "OPTED_OUT: The contact opted out of WhatsApp notifications.";
/** Released automatically the next time the person messages (which reopens the 24-hour window). */
export const SKIP_OUTSIDE_WINDOW = "OUTSIDE_WINDOW: Outside the 24-hour WhatsApp window and no approved status template is configured (WHATSAPP_STATUS_TEMPLATE_NAME). It will be sent if they message again within 7 days.";
const DEFERRED_RELEASE_MS = 7 * 86_400_000;

/**
 * Re-queues notifications that were skipped only because the 24-hour window was closed, now that
 * the person has written again (the window is open). Called when one of their messages is claimed,
 * so these go out before the reply. Opt-outs are respected; anything older than 7 days stays skipped.
 */
export async function releaseDeferredNotifications(contactId: string) {
  const contact = await db.whatsAppContact.findUnique({ where: { id: contactId }, select: { optedOutAt: true } });
  if (!contact || contact.optedOutAt) return 0;
  const released = await db.whatsAppOutboundMessage.updateMany({
    where: { contactId, status: "SKIPPED", lastError: SKIP_OUTSIDE_WINDOW, createdAt: { gt: new Date(Date.now() - DEFERRED_RELEASE_MS) } },
    data: { status: "QUEUED", lastError: "Released after the contact messaged again." },
  });
  if (released.count) await recordEvent("deferred_notifications_released", contactId, { count: released.count });
  return released.count;
}

/**
 * Queues a proactive notification (not a reply to the person's own message). Respects opt-out and
 * WhatsApp's 24-hour rule: outside the window it uses the approved status template when one is
 * configured, and otherwise records the message as SKIPPED with the reason instead of failing.
 */
export async function queueNotification(contactId: string, idempotencyKey: string, body: string) {
  const contact = await db.whatsAppContact.findUnique({ where: { id: contactId } });
  if (!contact) return null;
  const config = whatsAppAssistantConfig();
  let reply: Reply = { kind: "text", text: body };
  let skipReason: string | null = null;
  if (contact.optedOutAt) skipReason = SKIP_OPTED_OUT;
  else if (!insideServiceWindow(contact)) {
    if (config.statusTemplateName) reply = { kind: "template", name: config.statusTemplateName, language: config.statusTemplateLanguage, parameters: [body.replace(/\s*\n+\s*/g, " ").slice(0, 1000)] };
    else skipReason = SKIP_OUTSIDE_WINDOW;
  }
  try {
    await db.whatsAppOutboundMessage.create({
      data: {
        contactId,
        idempotencyKey,
        kind: reply.kind,
        payload: JSON.parse(JSON.stringify(reply)),
        ...(skipReason ? { status: "SKIPPED" as const, lastError: skipReason } : {}),
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return null;
  }
  if (!skipReason) await flushOutbound(contactId);
  return { skipped: Boolean(skipReason), reason: skipReason };
}

/**
 * Sends a contact's queued messages strictly in order. Stops at the first retryable failure and
 * schedules a retry job, so later messages never overtake an earlier one. Re-sending a message
 * never re-runs the conversation step that produced it.
 */
export async function flushOutbound(contactId: string) {
  const contact = await db.whatsAppContact.findUnique({ where: { id: contactId } });
  if (!contact) return { sent: 0, failed: 0, pending: 0 };
  const queued = await db.whatsAppOutboundMessage.findMany({ where: { contactId, status: "QUEUED" }, orderBy: [{ createdAt: "asc" }, { idempotencyKey: "asc" }], take: 50 });
  let sent = 0;
  let failed = 0;
  for (const message of queued) {
    // Claim the row so two concurrent flushes never send the same message twice.
    const claimed = await db.whatsAppOutboundMessage.updateMany({ where: { id: message.id, status: "QUEUED", attempts: message.attempts }, data: { attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    const result = await sendCloudApiMessage(toCloudApiMessage(contact.waId, message.payload as unknown as Reply));
    if (result.ok) {
      await db.whatsAppOutboundMessage.update({ where: { id: message.id }, data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId ?? null, lastError: null } });
      sent += 1;
      continue;
    }
    const exhausted = message.attempts + 1 >= MAX_OUTBOUND_ATTEMPTS;
    if (result.retryable && !exhausted) {
      await db.whatsAppOutboundMessage.update({ where: { id: message.id }, data: { lastError: `${result.ambiguous ? "AMBIGUOUS (may already be delivered; retrying): " : ""}${result.error}` } });
      await enqueueJob({
        type: OUTBOUND_JOB,
        idempotencyKey: `wa-out:${message.id}:${message.attempts + 1}`,
        payload: { contactId },
        runAt: new Date(Date.now() + 30_000 * 2 ** message.attempts),
        maxAttempts: 3,
      });
      return { sent, failed, pending: queued.length - sent - failed };
    }
    await db.whatsAppOutboundMessage.update({ where: { id: message.id }, data: { status: "FAILED", failedAt: new Date(), lastError: result.error } });
    await recordEvent("outbound_failed", contactId, { code: result.code ?? null, retryable: result.retryable });
    failed += 1;
  }
  return { sent, failed, pending: 0 };
}

const STATUS_RANK = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4, SKIPPED: 4 } as const;

/** Applies a delivery status webhook. Statuses can arrive out of order; they never move backwards. */
export async function applyStatusUpdate(update: { providerMessageId: string; status: "sent" | "delivered" | "read" | "failed"; timestamp: Date; errorCode?: number; errorTitle?: string }) {
  const message = await db.whatsAppOutboundMessage.findUnique({ where: { providerMessageId: update.providerMessageId } });
  if (!message) return false;
  const next = update.status.toUpperCase() as "SENT" | "DELIVERED" | "READ" | "FAILED";
  if (STATUS_RANK[next] <= STATUS_RANK[message.status] && next !== "FAILED") return false;
  await db.whatsAppOutboundMessage.update({
    where: { id: message.id },
    data: {
      status: next,
      ...(next === "DELIVERED" ? { deliveredAt: update.timestamp } : {}),
      ...(next === "READ" ? { readAt: update.timestamp, deliveredAt: message.deliveredAt ?? update.timestamp } : {}),
      ...(next === "FAILED" ? { failedAt: update.timestamp, lastError: `${update.errorCode ?? ""} ${update.errorTitle ?? "Delivery failed"}`.trim().slice(0, 500) } : {}),
    },
  });
  if (next === "FAILED") await recordEvent("outbound_failed", message.contactId, { code: update.errorCode ?? null, stage: "delivery" });
  return true;
}

/** An event that must commit with (and only with) the business change it describes. */
export async function recordEventInTx(tx: Prisma.TransactionClient, name: string, contactId: string | null, properties: Record<string, unknown> = {}) {
  await tx.whatsAppAssistantEvent.create({ data: { name, contactId, properties: JSON.parse(JSON.stringify(properties)) } });
}

export async function recordEvent(name: string, contactId: string | null, properties: Record<string, unknown> = {}) {
  await db.whatsAppAssistantEvent.create({ data: { name, contactId, properties: JSON.parse(JSON.stringify(properties)) } }).catch((error) => {
    // Analytics never break a conversation.
    console.error("[whatsapp-assistant] event not recorded", { name, error: errorLabel(error) });
  });
}
