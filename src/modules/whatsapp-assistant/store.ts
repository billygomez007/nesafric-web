import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { enqueueJob } from "@/platform/jobs/runner";
import { normalizePhone } from "@/platform/identity/phone";
import { sendCloudApiMessage, type ParsedInboundMessage } from "./cloud-api";
import { whatsAppAssistantConfig } from "./config";
import { toCloudApiMessage, type Reply } from "./messages";

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
 * Stores an inbound message once. Returns `null` for a duplicate delivery (Meta retries webhooks,
 * and the same message id must never be processed twice).
 */
export async function recordInbound(contactId: string, message: ParsedInboundMessage) {
  try {
    return await db.whatsAppInboundMessage.create({
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
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/** Queues the safety-net job that (re)processes a contact if the immediate attempt is lost. */
export async function scheduleInboundProcessing(contactId: string, key: string, delayMs = 60_000) {
  await enqueueJob({ type: INBOUND_JOB, idempotencyKey: `wa-in:${key}`, payload: { contactId }, runAt: new Date(Date.now() + delayMs), maxAttempts: 5 });
}

/**
 * Claims the contact's processing lease so their messages are handled one at a time, in order.
 * Returns the session, or `null` while another worker holds an unexpired lease.
 */
export async function acquireSession(contactId: string, now = new Date()) {
  await db.whatsAppAssistantSession.upsert({ where: { contactId }, update: {}, create: { contactId } }).catch((error) => {
    if (!isUniqueViolation(error)) throw error;
  });
  const claimed = await db.whatsAppAssistantSession.updateMany({
    where: { contactId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (!claimed.count) return null;
  return db.whatsAppAssistantSession.findUniqueOrThrow({ where: { contactId } });
}

export async function extendSessionLease(sessionId: string) {
  await db.whatsAppAssistantSession.update({ where: { id: sessionId }, data: { lockedUntil: new Date(Date.now() + LEASE_MS) } });
}

export async function releaseSession(sessionId: string) {
  await db.whatsAppAssistantSession.update({ where: { id: sessionId }, data: { lockedUntil: null } });
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
  if (contact.optedOutAt) skipReason = "The contact opted out of WhatsApp notifications.";
  else if (!insideServiceWindow(contact)) {
    if (config.statusTemplateName) reply = { kind: "template", name: config.statusTemplateName, language: config.statusTemplateLanguage, parameters: [body.replace(/\s*\n+\s*/g, " ").slice(0, 1000)] };
    else skipReason = "Outside the 24-hour WhatsApp window and no approved status template is configured (WHATSAPP_STATUS_TEMPLATE_NAME).";
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
      await db.whatsAppOutboundMessage.update({ where: { id: message.id }, data: { lastError: result.error } });
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

export async function recordEvent(name: string, contactId: string | null, properties: Record<string, unknown> = {}) {
  await db.whatsAppAssistantEvent.create({ data: { name, contactId, properties: JSON.parse(JSON.stringify(properties)) } }).catch((error) => {
    // Analytics never break a conversation.
    console.error("[whatsapp-assistant] event not recorded", { name, error: error instanceof Error ? error.message : "unknown" });
  });
}
