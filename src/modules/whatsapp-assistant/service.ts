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
import { isOfficialWhatsAppOrganisation, isWhatsAppOptedOut, recordInboundIdentity, setWhatsAppOptOut, whatsappSessionKey } from "./identity";

type ChannelConfig = z.infer<typeof assistantChannelConfigSchema>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/** Persist receipt and the worker job together. No AI or outbound network calls in the webhook. */
export async function acceptWhatsAppEvents(organisationId: string, config: ChannelConfig, payload: unknown) {
  const events = parseWhatsAppEvents(payload, config.phoneNumberId, config.businessAccountId);
  // Unrecognised items are acknowledged, not rejected: a non-2xx makes Meta redeliver the batch.
  if (events.skipped) console.warn(JSON.stringify({ event: "whatsapp.webhook.items_skipped", organisationId, skipped: events.skipped }));
  for (const inbound of events.messages) {
    if (!config.marketplaceAssistantEnabled) {
      await db.backgroundJob.upsert({ where: { idempotencyKey: `whatsapp-legacy:${organisationId}:${inbound.externalMessageId}` }, update: {}, create: { organisationId, type: "whatsapp-legacy-inbound", idempotencyKey: `whatsapp-legacy:${organisationId}:${inbound.externalMessageId}`, payload: json({ organisationId, inbound }), maxAttempts: 5 } });
      continue;
    }
    const sessionKey = whatsappSessionKey(organisationId, config.phoneNumberId, inbound.channelAddress);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionKey + ":intake"}, 0))`;
      const duplicate = await tx.message.findUnique({ where: { organisationId_channel_externalMessageId: { organisationId, channel: "WHATSAPP", externalMessageId: inbound.externalMessageId } } });
      if (duplicate) return;
      const conversation = await tx.conversation.upsert({
        where: { whatsappSessionKey: sessionKey }, update: {},
        create: { organisationId, channel: "WHATSAPP", channelAddress: inbound.channelAddress, whatsappSessionKey: sessionKey, subject: "NesAfric WhatsApp assistant", identityLevel: "NONE", participants: { create: { organisationId, type: "ANONYMOUS", phone: inbound.channelAddress, displayName: inbound.senderName } } },
      });
      // Receipt order is stable even when two events arrive in the same millisecond.
      const receivedAt = new Date(Math.max(Date.now(), (conversation.lastMessageAt?.getTime() ?? 0) + 1));
      const limited = await tx.message.count({ where: { conversationId: conversation.id, direction: "INBOUND", createdAt: { gte: new Date(Date.now() - 60_000) } } }) >= 20;
      const message = await tx.message.create({ data: { organisationId, conversationId: conversation.id, channel: "WHATSAPP", direction: "INBOUND", senderType: "PROSPECT", externalMessageId: inbound.externalMessageId, externalReferenceId: inbound.externalReferenceId, body: inbound.body, metadata: json({ ...inbound.providerPayload, providerReceivedAt: inbound.receivedAt?.toISOString(), rateLimited: limited }), processedAt: limited ? receivedAt : null, createdAt: receivedAt } });
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
async function queueReply(tx: Tx, organisationId: string, conversationId: string, phone: string, inboundId: string, body: string, suffix = "reply") {
  const externalMessageId = `assistant:${inboundId}:${suffix}`;
  const existing = await tx.message.findUnique({ where: { organisationId_channel_externalMessageId: { organisationId, channel: "WHATSAPP", externalMessageId } } });
  if (existing) return;
  const message = await tx.message.create({ data: { organisationId, conversationId, channel: "WHATSAPP", direction: "OUTBOUND", senderType: "SYSTEM", body, externalMessageId } });
  const delivery = await tx.messageDelivery.create({ data: { organisationId, messageId: message.id, channel: "WHATSAPP", recipientAddress: phone, idempotencyKey: `message-delivery:${message.id}` } });
  await tx.backgroundJob.create({ data: { organisationId, type: "conversation-message-delivery", idempotencyKey: `conversation-message-delivery:${delivery.id}`, payload: { organisationId, deliveryId: delivery.id }, maxAttempts: 5 } });
  await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), lastOutboundAt: new Date() } });
}

const jobSchema = z.object({ organisationId: z.string().uuid(), conversationId: z.string().uuid(), messageId: z.string().uuid() });

type Outcome =
  | { kind: "skip" }
  | { kind: "reply"; state: unknown; reply: string; status: ConversationStatus; handoff: boolean; redactInbound: boolean; optOut?: boolean; workflow: string; step: string };

const ENDED_STATUSES = ["CLOSED", "RESOLVED"];

/**
 * Decides the reply for one inbound message. Runs outside any database transaction because it
 * may call the AI provider and the OTP provider; every write it makes on its own (leads, viewings,
 * OTP challenges, identity links) is idempotent or safe to repeat.
 */
async function decide(organisationId: string, conversation: { id: string; status: string; assignedMemberId: string | null; assistantState: unknown; channelAddress: string }, message: { id: string; body: string; metadata: unknown }, config: ChannelConfig): Promise<Outcome> {
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
    ? await advanceOfficialConversation({ ...input, organisationId, media })
    : await advanceConversation(input);
  if (result.reply.length > 4096) throw new Error("Assistant reply exceeds WhatsApp text limit.");
  return { kind: "reply", state: result.state, reply: result.reply, status: result.handoff ? "HUMAN_REQUIRED" : "AI_ACTIVE", handoff: Boolean(result.handoff), redactInbound: "redactInbound" in result && Boolean(result.redactInbound), workflow: result.state.workflow, step: result.state.step };
}

const sameSnapshot = (a: { status: string; assignedMemberId: string | null; assistantState: unknown }, b: typeof a) =>
  a.status === b.status && a.assignedMemberId === b.assignedMemberId && JSON.stringify(a.assistantState ?? null) === JSON.stringify(b.assistantState ?? null);

export async function processAssistantMessage(payload: Record<string, unknown>) {
  const job = jobSchema.parse(payload);
  const channel = await db.communicationChannelConfig.findUnique({ where: { organisationId_channel: { organisationId: job.organisationId, channel: "WHATSAPP" } } });
  const config = assistantChannelConfigSchema.safeParse(channel?.config);
  if (!channel?.enabled || !config.success || !config.data.marketplaceAssistantEnabled) throw new NonRetryableJobError("WhatsApp marketplace assistant is disabled or misconfigured.");
  // Every pending inbound has a durable job. Drain preceding receipts before this job's target
  // so parallel workers cannot apply later answers to an earlier workflow step. Each pass decides
  // outside a transaction, then commits only if nothing changed meanwhile (optimistic check).
  try {
    for (let count = 0; count < 20; count += 1) {
      const conversation = await db.conversation.findFirst({ where: { id: job.conversationId, organisationId: job.organisationId, channel: "WHATSAPP" } });
      if (!conversation?.whatsappSessionKey || !conversation.channelAddress) throw new NonRetryableJobError("WhatsApp conversation not found.");
      const target = await db.message.findFirst({ where: { id: job.messageId, conversationId: conversation.id, direction: "INBOUND" } });
      if (!target || target.processedAt) return;
      const message = await db.message.findFirstOrThrow({ where: { conversationId: conversation.id, direction: "INBOUND", processedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      const outcome = await decide(job.organisationId, { ...conversation, channelAddress: conversation.channelAddress }, message, config.data);

      const committed = await db.$transaction(async (tx) => {
        const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${conversation.whatsappSessionKey!}, 0)) AS acquired`;
        if (!lock?.acquired) throw new Error("WhatsApp conversation is already being processed.");
        const current = await tx.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
        const still = await tx.message.findUniqueOrThrow({ where: { id: message.id } });
        if (still.processedAt || !sameSnapshot(current, conversation)) return "stale" as const;
        if (outcome.kind === "skip") {
          await tx.message.update({ where: { id: message.id }, data: { processedAt: new Date() } });
          return message.id === job.messageId ? "done" as const : "next" as const;
        }
        if (outcome.redactInbound) await tx.message.update({ where: { id: message.id }, data: { body: "[verification code removed]", containsSensitiveData: true } });
        if (outcome.optOut !== undefined) await setWhatsAppOptOut(tx, conversation.channelAddress!, outcome.optOut);
        await queueReply(tx, job.organisationId, conversation.id, conversation.channelAddress!, message.id, outcome.reply);
        await tx.conversation.update({ where: { id: conversation.id }, data: { assistantState: json(outcome.state), status: outcome.status } });
        if (outcome.handoff) await tx.conversationAssignment.create({ data: { organisationId: job.organisationId, conversationId: conversation.id, assigneeType: "UNASSIGNED", reason: "WhatsApp customer requested human support." } });
        await tx.message.update({ where: { id: message.id }, data: { processedAt: new Date() } });
        await tx.domainEvent.create({ data: { organisationId: job.organisationId, name: outcome.handoff ? "whatsapp.support_requested" : "whatsapp.workflow_advanced", aggregateType: "conversation", aggregateId: conversation.id, payload: { messageId: message.id, workflow: outcome.workflow, step: outcome.step } } });
        return message.id === job.messageId ? "done" as const : "next" as const;
      }, { timeout: 15_000, maxWait: 5_000 });
      if (committed === "done") return;
    }
    throw new Error("Earlier WhatsApp messages are still pending.");
  } catch (error) {
    // Preserve the draft and original action key. A single outage notice is independent of retry.
    if (!(error instanceof NonRetryableJobError)) await db.$transaction(async (tx) => {
      const message = await tx.message.findFirst({ where: { id: job.messageId, organisationId: job.organisationId, conversationId: job.conversationId, processedAt: null }, include: { conversation: true } });
      if (!message?.conversation.channelAddress) return;
      if (error instanceof Error && error.message.includes("already being processed")) return;
      await queueReply(tx, job.organisationId, job.conversationId, message.conversation.channelAddress, message.id, "I could not finish processing your request. Your progress is saved and the system will retry. Please avoid resending confirmations; the team can see failed items in the jobs queue.", "failure");
    }).catch(() => undefined);
    throw error;
  }
}

export async function processLegacyWhatsAppMessage(payload: Record<string, unknown>) {
  await receiveInboundChannelMessage(z.string().uuid().parse(payload.organisationId), "WHATSAPP", payload.inbound);
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
