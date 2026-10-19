import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/platform/database/client";
import { Prisma, type ConversationStatus } from "@/platform/database/generated/client";
import { parseWhatsAppEvents, type WhatsAppStatusEvent } from "@/modules/conversations/channels/whatsapp-payload";
import { receiveInboundChannelMessage } from "@/modules/conversations/service";
import { NonRetryableJobError } from "@/platform/jobs/errors";
import { assistantChannelConfigSchema, assistantStateSchema, initialState } from "./schemas";
import { advanceConversation } from "./engine";
import { advanceOfficialConversation } from "./router";
import type { WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";
import { activeWhatsAppAssignment, lockWhatsAppChannelShared, trustedWhatsAppConfig, withWhatsAppProcessingGuard } from "@/modules/conversations/channels/whatsapp-numbers";
import { isOfficialWhatsAppOrganisation, isWhatsAppOptedOut, recordInboundIdentity, setWhatsAppOptOut, whatsappSessionKey } from "./identity";

type ChannelConfig = z.infer<typeof assistantChannelConfigSchema>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/** Work that met a different number assignment from the one it arrived under: kept, never acted on. */
function logQuarantine(organisationId: string, reason: string, detail: Record<string, unknown> = {}) {
  console.warn(JSON.stringify({ event: "whatsapp.inbound_quarantined", organisationId, reason, ...detail }));
}

const stampOf = (metadata: unknown) => {
  const value = (metadata as { whatsappAssignmentId?: unknown } | null)?.whatsappAssignmentId;
  return typeof value === "string" ? value : null;
};

/**
 * Persist receipt and the worker job together. No AI or outbound network calls in the webhook.
 * `assignmentId` is the number assignment the webhook checked; each receipt re-checks it under a
 * shared channel lock and records it, so later work can tell if the number has moved since.
 */
/**
 * Optional test allowlist (`WHATSAPP_INBOUND_ALLOWLIST`, comma-separated numbers). When set, only
 * events from or to those numbers are kept; everything else is acknowledged and discarded without
 * storing content or creating jobs. For live tests on a real number; unset in normal operation.
 */
export function whatsappInboundAllowlist(env: Record<string, string | undefined> = process.env) {
  const raw = env.WHATSAPP_INBOUND_ALLOWLIST?.trim();
  if (!raw) return null;
  return new Set(raw.split(",").map((entry) => entry.replace(/[^\d]/g, "")).filter(Boolean));
}

export async function acceptWhatsAppEvents(organisationId: string, config: ChannelConfig, payload: unknown, assignmentId: string) {
  const parsed = parseWhatsAppEvents(payload, config.phoneNumberId, config.businessAccountId);
  const allowlist = whatsappInboundAllowlist();
  const allowed = (address: string) => !allowlist || allowlist.has(address.replace(/[^\d]/g, ""));
  const events = { ...parsed, messages: parsed.messages.filter((inbound) => allowed(inbound.channelAddress)), statuses: parsed.statuses.filter((status) => allowed(status.recipient)) };
  const discarded = parsed.messages.length - events.messages.length + parsed.statuses.length - events.statuses.length;
  if (discarded) console.warn(JSON.stringify({ event: "whatsapp.webhook.not_allowlisted", organisationId, discarded }));
  // Unrecognised items are acknowledged, not rejected: a non-2xx makes Meta redeliver the batch.
  if (events.skipped) console.warn(JSON.stringify({ event: "whatsapp.webhook.items_skipped", organisationId, skipped: events.skipped }));
  for (const inbound of events.messages) {
    if (!config.marketplaceAssistantEnabled) {
      await db.backgroundJob.upsert({ where: { idempotencyKey: `whatsapp-legacy:${organisationId}:${inbound.externalMessageId}` }, update: {}, create: { organisationId, type: "whatsapp-legacy-inbound", idempotencyKey: `whatsapp-legacy:${organisationId}:${inbound.externalMessageId}`, payload: json({ organisationId, inbound, whatsappAssignmentId: assignmentId }), maxAttempts: 5 } });
      continue;
    }
    const sessionKey = whatsappSessionKey(organisationId, config.phoneNumberId, inbound.channelAddress);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionKey + ":intake"}, 0))`;
      await lockWhatsAppChannelShared(tx, organisationId);
      if ((await activeWhatsAppAssignment(tx, organisationId))?.id !== assignmentId) {
        logQuarantine(organisationId, "number_reassigned_during_receipt");
        return;
      }
      const duplicate = await tx.message.findUnique({ where: { organisationId_channel_externalMessageId: { organisationId, channel: "WHATSAPP", externalMessageId: inbound.externalMessageId } } });
      if (duplicate) return;
      // The session key names this number, and the receipt was just checked under the shared
      // channel lock, so the conversation is (re-)verified under this assignment.
      const conversation = await tx.conversation.upsert({
        where: { whatsappSessionKey: sessionKey }, update: { whatsappAssignmentId: assignmentId },
        create: { organisationId, channel: "WHATSAPP", channelAddress: inbound.channelAddress, whatsappSessionKey: sessionKey, whatsappAssignmentId: assignmentId, subject: "NesAfric WhatsApp assistant", identityLevel: "NONE", participants: { create: { organisationId, type: "ANONYMOUS", phone: inbound.channelAddress, displayName: inbound.senderName } } },
      });
      // Receipt order is stable even when two events arrive in the same millisecond.
      const receivedAt = new Date(Math.max(Date.now(), (conversation.lastMessageAt?.getTime() ?? 0) + 1));
      const limited = await tx.message.count({ where: { conversationId: conversation.id, direction: "INBOUND", createdAt: { gte: new Date(Date.now() - 60_000) } } }) >= 20;
      const message = await tx.message.create({ data: { organisationId, conversationId: conversation.id, channel: "WHATSAPP", direction: "INBOUND", senderType: "PROSPECT", externalMessageId: inbound.externalMessageId, externalReferenceId: inbound.externalReferenceId, body: inbound.body, metadata: json({ ...inbound.providerPayload, providerReceivedAt: inbound.receivedAt?.toISOString(), rateLimited: limited, whatsappAssignmentId: assignmentId }), processedAt: limited ? receivedAt : null, createdAt: receivedAt } });
      const providerAt = inbound.receivedAt && inbound.receivedAt.getTime() <= Date.now() ? inbound.receivedAt : new Date();
      const lastInboundAt = new Date(Math.max(conversation.lastInboundAt?.getTime() ?? 0, providerAt.getTime()));
      await tx.conversation.update({ where: { id: conversation.id }, data: { lastInboundAt, lastMessageAt: receivedAt } });
      await recordInboundIdentity(tx, inbound.channelAddress, lastInboundAt);
      if (!limited) await tx.backgroundJob.create({ data: { organisationId, type: "whatsapp-assistant-message", idempotencyKey: `whatsapp-assistant:${message.id}`, payload: { organisationId, messageId: message.id, conversationId: conversation.id }, maxAttempts: 8 } });
    });
  }
  for (const status of events.statuses) {
    const key = `whatsapp-status:${organisationId}:${hash(JSON.stringify(status))}`;
    await db.backgroundJob.upsert({ where: { idempotencyKey: key }, update: {}, create: { organisationId, type: "whatsapp-delivery-status", idempotencyKey: key, payload: json({ organisationId, status }), maxAttempts: 8 } });
  }
  return { accepted: events.messages.length, statuses: events.statuses.length };
}

type Tx = Prisma.TransactionClient;
/**
 * `assignmentId`: the assignment the inbound arrived under, already re-checked by the caller under a shared channel lock.
 * `interactive`: a list or reply buttons for the WhatsApp send. `body` stays the stored plain-text
 * fallback, so the transcript and staff inbox read the same either way. It is a session message,
 * held to the customer-service window like any free-form reply.
 */
async function queueReply(tx: Tx, organisationId: string, assignmentId: string, conversationId: string, phone: string, inboundId: string, body: string, suffix = "reply", replyMetadata?: Record<string, unknown>, interactive?: WhatsAppInteractive) {
  const externalMessageId = `assistant:${inboundId}:${suffix}`;
  const metadata = interactive ? { ...replyMetadata, whatsappInteractive: interactive } : replyMetadata;
  const existing = await tx.message.findUnique({ where: { organisationId_channel_externalMessageId: { organisationId, channel: "WHATSAPP", externalMessageId } } });
  if (existing) return;
  const message = await tx.message.create({ data: { organisationId, conversationId, channel: "WHATSAPP", direction: "OUTBOUND", senderType: "SYSTEM", body, externalMessageId, ...(metadata ? { metadata: json(metadata), containsSensitiveData: Boolean(metadata.redactAfterSend) } : {}) } });
  const delivery = await tx.messageDelivery.create({ data: { organisationId, messageId: message.id, channel: "WHATSAPP", recipientAddress: phone, idempotencyKey: `message-delivery:${message.id}`, whatsappAssignmentId: assignmentId } });
  await tx.backgroundJob.create({ data: { organisationId, type: "conversation-message-delivery", idempotencyKey: `conversation-message-delivery:${delivery.id}`, payload: { organisationId, deliveryId: delivery.id }, maxAttempts: 5 } });
  await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), lastOutboundAt: new Date() } });
}

/** True when the inbound's assignment is still the organisation's active one (caller holds the shared channel lock). */
async function stillAssigned(tx: Tx, organisationId: string, metadata: unknown) {
  const stamp = stampOf(metadata);
  return Boolean(stamp && (await activeWhatsAppAssignment(tx, organisationId))?.id === stamp);
}

/** Marks an inbound handled without acting on it: it arrived under an assignment that has since changed. */
async function quarantineInbound(tx: Tx, organisationId: string, message: { id: string; conversationId: string; metadata: unknown }) {
  await tx.message.update({ where: { id: message.id }, data: { processedAt: new Date(), metadata: json({ ...((message.metadata ?? {}) as Record<string, unknown>), quarantined: "number_reassigned" }) } });
  await tx.domainEvent.create({ data: { organisationId, name: "whatsapp.inbound_quarantined", aggregateType: "conversation", aggregateId: message.conversationId, payload: { messageId: message.id, whatsappAssignmentId: stampOf(message.metadata) } } });
}

const jobSchema = z.object({ organisationId: z.string().uuid(), conversationId: z.string().uuid(), messageId: z.string().uuid() });

type Outcome =
  | { kind: "skip" }
  | { kind: "reply"; state: unknown; reply: string; status: ConversationStatus; handoff: boolean; redactInbound: boolean; optOut?: boolean; workflow: string; step: string; replyMetadata?: Record<string, unknown>; interactive?: WhatsAppInteractive };

const ENDED_STATUSES = ["CLOSED", "RESOLVED"];

/**
 * Decides the reply for one inbound message. Runs outside any database transaction because it
 * may call the AI provider and the OTP provider; every write it makes on its own (leads, viewings,
 * OTP challenges, identity links) is idempotent or safe to repeat.
 */
async function decide(organisationId: string, conversation: { id: string; status: string; assignedMemberId: string | null; assistantState: unknown; channelAddress: string }, message: { id: string; body: string; metadata: unknown; externalReferenceId: string | null }, config: ChannelConfig): Promise<Outcome> {
  const command = message.body.trim().toLowerCase();
  const metadata = (message.metadata ?? {}) as Record<string, unknown>;
  const kind = String(metadata.kind ?? "text");
  // Opt-out commands are answered whoever owns the thread, and never change who owns it.
  const optOutReply = (reply: string, optOut: boolean): Outcome => ({ kind: "reply", state: conversation.assistantState, reply, status: conversation.status as ConversationStatus, handoff: false, redactInbound: false, optOut, workflow: "opt_out", step: optOut ? "stop" : "start" });
  if (kind === "text" && /^(stop|unsubscribe|stop all)$/.test(command)) {
    return optOutReply("You have unsubscribed from NesAfric WhatsApp notifications. You can still message us at any time. Reply START to subscribe again.", true);
  }
  if (kind === "text" && command === "start" && await isWhatsAppOptedOut(conversation.channelAddress)) {
    return optOutReply("You are subscribed to NesAfric WhatsApp notifications again. Reply menu to see what I can help with.", false);
  }

  // A person on the team owns the thread; their inbox shows this message.
  if (conversation.assignedMemberId || conversation.status === "HUMAN_ACTIVE") return { kind: "skip" };
  let state = conversation.assistantState;
  if (conversation.status === "HUMAN_REQUIRED") {
    if (!["menu", "cancel"].includes(command)) return { kind: "skip" };
  }
  // A resolved or closed thread starts fresh instead of ignoring the person forever.
  if (ENDED_STATUSES.includes(conversation.status)) {
    const previous = assistantStateSchema.safeParse(state ?? {});
    state = { ...initialState(), lastRequest: previous.success ? previous.data.lastRequest : undefined };
  }
  const input = { state, body: message.body, kind, phone: conversation.channelAddress, conversationId: conversation.id, messageId: message.id, defaultCountry: config.defaultCountry, defaultCurrency: config.defaultCurrency };
  const rawMedia = metadata.media as { id?: unknown; mime_type?: unknown } | undefined;
  const media = typeof rawMedia?.id === "string" ? { id: rawMedia.id, mimeType: typeof rawMedia.mime_type === "string" ? rawMedia.mime_type : undefined } : undefined;
  const result = isOfficialWhatsAppOrganisation(organisationId)
    ? await advanceOfficialConversation({ ...input, organisationId, media, replyTo: message.externalReferenceId ?? undefined })
    : await advanceConversation(input);
  if (result.reply.length > 4096) throw new Error("Assistant reply exceeds WhatsApp text limit.");
  return { kind: "reply", state: result.state, reply: result.reply, status: result.handoff ? "HUMAN_REQUIRED" : "AI_ACTIVE", handoff: Boolean(result.handoff), redactInbound: "redactInbound" in result && Boolean(result.redactInbound), workflow: result.state.workflow, step: result.state.step, replyMetadata: "replyMetadata" in result ? result.replyMetadata as Record<string, unknown> | undefined : undefined, interactive: result.interactive };
}

const sameSnapshot = (a: { status: string; assignedMemberId: string | null; assistantState: unknown }, b: typeof a) =>
  a.status === b.status && a.assignedMemberId === b.assignedMemberId && JSON.stringify(a.assistantState ?? null) === JSON.stringify(b.assistantState ?? null);

export async function processAssistantMessage(payload: Record<string, unknown>) {
  const job = jobSchema.parse(payload);
  const [channel, assignment] = await Promise.all([
    db.communicationChannelConfig.findUnique({ where: { organisationId_channel: { organisationId: job.organisationId, channel: "WHATSAPP" } } }),
    activeWhatsAppAssignment(db, job.organisationId),
  ]);
  const config = assistantChannelConfigSchema.safeParse(assignment ? trustedWhatsAppConfig(channel?.config, assignment) : channel?.config);
  if (!channel?.enabled || !config.success || !config.data.marketplaceAssistantEnabled) {
    if (channel?.enabled && !assignment) {
      // The number moved away (or was never approved): the pending receipts are not this
      // organisation's to answer any more.
      await db.$transaction(async (tx) => {
        await lockWhatsAppChannelShared(tx, job.organisationId);
        for (const pending of await tx.message.findMany({ where: { conversationId: job.conversationId, organisationId: job.organisationId, direction: "INBOUND", processedAt: null } })) {
          if (!await stillAssigned(tx, job.organisationId, pending.metadata)) await quarantineInbound(tx, job.organisationId, pending);
        }
      });
      return;
    }
    throw new NonRetryableJobError("WhatsApp marketplace assistant is disabled or misconfigured.");
  }
  // Every pending inbound has a durable job. Drain preceding receipts before this job's target
  // so parallel workers cannot apply later answers to an earlier workflow step. Each pass decides
  // outside a transaction, then commits only if nothing changed meanwhile (optimistic check).
  try {
    for (let count = 0; count < 20; count += 1) {
      // Deciding can create requests, accept jobs or change rules: none of it may happen for a
      // number that moves meanwhile, so each pass holds the processing guard to its end.
      const step = await withWhatsAppProcessingGuard(job.organisationId, async () => {
        const conversation = await db.conversation.findFirst({ where: { id: job.conversationId, organisationId: job.organisationId, channel: "WHATSAPP" } });
        if (!conversation?.whatsappSessionKey || !conversation.channelAddress) throw new NonRetryableJobError("WhatsApp conversation not found.");
        const target = await db.message.findFirst({ where: { id: job.messageId, conversationId: conversation.id, direction: "INBOUND" } });
        if (!target || target.processedAt) return "stop" as const;
        const message = await db.message.findFirstOrThrow({ where: { conversationId: conversation.id, direction: "INBOUND", processedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
        // Received under an earlier assignment: never decided, so no data of this organisation is
        // used to answer someone who wrote to a number it may no longer hold.
        // Under the processing guard the assignment cannot change until this pass has finished.
        const assigned = await activeWhatsAppAssignment(db, job.organisationId);
        if (stampOf(message.metadata) !== assigned?.id) {
          const quarantined = await db.$transaction(async (tx) => {
            await lockWhatsAppChannelShared(tx, job.organisationId);
            const still = await tx.message.findUniqueOrThrow({ where: { id: message.id } });
            if (still.processedAt) return false;
            await quarantineInbound(tx, job.organisationId, still);
            return true;
          });
          if (quarantined) logQuarantine(job.organisationId, "number_reassigned_before_processing", { messageId: message.id });
          return message.id === job.messageId ? "stop" as const : "next" as const;
        }
        const outcome = await decide(job.organisationId, { ...conversation, channelAddress: conversation.channelAddress }, message, config.data);

        const committed = await db.$transaction(async (tx) => {
          const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${conversation.whatsappSessionKey!}, 0)) AS acquired`;
          if (!lock?.acquired) throw new Error("WhatsApp conversation is already being processed.");
          await lockWhatsAppChannelShared(tx, job.organisationId);
          const current = await tx.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
          const still = await tx.message.findUniqueOrThrow({ where: { id: message.id } });
          if (still.processedAt || !sameSnapshot(current, conversation)) return "stale" as const;
          // The number moved while the reply was being decided: drop the decision.
          if (!await stillAssigned(tx, job.organisationId, still.metadata)) {
            await quarantineInbound(tx, job.organisationId, still);
            return message.id === job.messageId ? "done" as const : "next" as const;
          }
          if (outcome.kind === "skip") {
            await tx.message.update({ where: { id: message.id }, data: { processedAt: new Date() } });
            return message.id === job.messageId ? "done" as const : "next" as const;
          }
          if (outcome.redactInbound) await tx.message.update({ where: { id: message.id }, data: { body: "[verification code removed]", containsSensitiveData: true } });
          if (outcome.optOut !== undefined) await setWhatsAppOptOut(tx, conversation.channelAddress!, outcome.optOut);
          await queueReply(tx, job.organisationId, stampOf(still.metadata)!, conversation.id, conversation.channelAddress!, message.id, outcome.reply, "reply", outcome.replyMetadata, outcome.interactive);
          await tx.conversation.update({ where: { id: conversation.id }, data: { assistantState: json(outcome.state), status: outcome.status } });
          if (outcome.handoff) await tx.conversationAssignment.create({ data: { organisationId: job.organisationId, conversationId: conversation.id, assigneeType: "UNASSIGNED", reason: "WhatsApp customer requested human support." } });
          await tx.message.update({ where: { id: message.id }, data: { processedAt: new Date() } });
          await tx.domainEvent.create({ data: { organisationId: job.organisationId, name: outcome.handoff ? "whatsapp.support_requested" : "whatsapp.workflow_advanced", aggregateType: "conversation", aggregateId: conversation.id, payload: { messageId: message.id, workflow: outcome.workflow, step: outcome.step } } });
          return message.id === job.messageId ? "done" as const : "next" as const;
        }, { timeout: 15_000, maxWait: 5_000 });
        return committed === "done" ? "stop" as const : "next" as const;
      });
      if (step === "stop") return;
    }
    throw new Error("Earlier WhatsApp messages are still pending.");
  } catch (error) {
    // Preserve the draft and original action key. A single outage notice is independent of retry.
    if (!(error instanceof NonRetryableJobError)) await db.$transaction(async (tx) => {
      const message = await tx.message.findFirst({ where: { id: job.messageId, organisationId: job.organisationId, conversationId: job.conversationId, processedAt: null }, include: { conversation: true } });
      if (!message?.conversation.channelAddress) return;
      if (error instanceof Error && error.message.includes("already being processed")) return;
      await lockWhatsAppChannelShared(tx, job.organisationId);
      if (!await stillAssigned(tx, job.organisationId, message.metadata)) return;
      await queueReply(tx, job.organisationId, stampOf(message.metadata)!, job.conversationId, message.conversation.channelAddress, message.id, "I could not finish processing your request. Your progress is saved and the system will retry. Please avoid resending confirmations; the team can see failed items in the jobs queue.", "failure");
    }).catch(() => undefined);
    throw error;
  }
}

export async function processLegacyWhatsAppMessage(payload: Record<string, unknown>) {
  const organisationId = z.string().uuid().parse(payload.organisationId);
  // The check and the ingestion (with any automatic reply) run under the processing guard, so the
  // number cannot move between them.
  await withWhatsAppProcessingGuard(organisationId, async () => {
    const assignment = await activeWhatsAppAssignment(db, organisationId);
    // Received before the number moved (or before receipts recorded their assignment): not
    // delivered into this organisation's inbox.
    if (!assignment || payload.whatsappAssignmentId !== assignment.id) {
      logQuarantine(organisationId, "number_reassigned_before_processing", { legacy: true });
      await db.domainEvent.create({ data: { organisationId, name: "whatsapp.inbound_quarantined", aggregateType: "communication_channel", aggregateId: organisationId, payload: { legacy: true, whatsappAssignmentId: typeof payload.whatsappAssignmentId === "string" ? payload.whatsappAssignmentId : null } } });
      return;
    }
    await receiveInboundChannelMessage(organisationId, "WHATSAPP", payload.inbound, { whatsappAssignmentId: assignment.id });
  });
}

/** Statuses can arrive before the send response is stored; after this they are not ours. */
const STATUS_MATCH_WINDOW_MS = 15 * 60_000;

export async function recordWhatsAppDeliveryStatus(organisationId: string, status: WhatsAppStatusEvent, now = new Date()) {
  const at = new Date(Number(status.timestamp) * 1000);
  const recipient = status.recipient.replace(/^\+/, "");
  // Meta message ids are unguessable and globally unique. The official number also carries
  // notifications for other organisations, so its statuses match across organisations.
  const scope = isOfficialWhatsAppOrganisation(organisationId) ? {} : { organisationId };
  const where = { ...scope, channel: "WHATSAPP" as const, providerReference: status.id, recipientAddress: { in: [recipient, `+${recipient}`] } };
  const delivery = await db.messageDelivery.findFirst({ where });
  if (!delivery) {
    const notification = await db.notification.findFirst({ where: { ...scope, channel: "WHATSAPP", providerReference: status.id } });
    if (notification) {
      if (status.status === "delivered" || status.status === "read") await db.notification.updateMany({ where: { id: notification.id, status: { in: ["SENT", "FAILED"] } }, data: { status: "DELIVERED", deliveredAt: at, failedAt: null, failureReason: null } });
      if (status.status === "failed") await db.notification.updateMany({ where: { id: notification.id, status: "SENT" }, data: { status: "FAILED", failedAt: at, failureReason: `WhatsApp delivery failed (${status.errorCodes.join(", ") || "unspecified"}).` } });
      return;
    }
    // Status can race the send response. Retry for a while, then stop: it matches nothing we sent.
    if (now.getTime() - at.getTime() < STATUS_MATCH_WINDOW_MS) throw new Error("WhatsApp status has no matching delivery receipt yet.");
    console.warn(JSON.stringify({ event: "whatsapp.status.unmatched", organisationId, status: status.status }));
    return;
  }
  const permitted = status.status === "read" ? ["SENT", "DELIVERED", "FAILED", "UNCONFIRMED"] : status.status === "delivered" ? ["SENT", "FAILED", "UNCONFIRMED"] : status.status === "failed" ? ["SENT", "UNCONFIRMED"] : status.status === "sent" ? ["UNCONFIRMED"] : [];
  if (!permitted.length) return;
  const data = status.status === "read" ? { status: "READ" as const, readAt: at, deliveredAt: delivery.deliveredAt ?? at, failedAt: null, failureReason: null }
    : status.status === "delivered" ? { status: "DELIVERED" as const, deliveredAt: at, failedAt: null, failureReason: null }
    : status.status === "sent" ? { status: "SENT" as const, sentAt: at, failedAt: null, failureReason: null }
    : { status: "FAILED" as const, failedAt: at, failureReason: `WhatsApp delivery failed (${status.errorCodes.join(", ") || "unspecified"}).` };
  await db.messageDelivery.updateMany({ where: { ...where, status: { in: permitted as Array<"SENT" | "DELIVERED" | "FAILED" | "UNCONFIRMED"> } }, data });
}
