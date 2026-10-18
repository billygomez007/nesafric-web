import type { Prisma } from "@/platform/database/generated/client";
import { lockWhatsAppChannelShared } from "@/modules/conversations/channels/whatsapp-numbers";
import { resolveWhatsAppSendConfig, whatsappTemplate, type WhatsAppTemplateKey } from "@/modules/conversations/channels/whatsapp-sender";
import { officialWhatsAppOrganisationId, whatsappSessionKey } from "./identity";
import { assistantChannelConfigSchema } from "./schemas";

type Tx = Prisma.TransactionClient;
export type OfficialTemplateMessage = {
  /** E.164 with "+". */
  phoneE164: string;
  displayName: string;
  template: WhatsAppTemplateKey;
  bodyParameters: string[];
  /** Readable copy for the transcript. */
  body: string;
  /** Idempotency: one message per key, ever. */
  externalMessageId: string;
  metadata?: Record<string, unknown>;
};

/** Whether business-initiated messages of this kind can be sent at all, and why not. */
/**
 * Whether business-initiated messages of this kind can be sent at all, and why not. Inside a
 * transaction (`tx`) it takes the shared lock on the official channel first, so the assignment it
 * returns stays in force until the caller commits what it queues.
 */
export async function officialTemplateReadiness(template: WhatsAppTemplateKey, tx?: Tx) {
  const officialId = officialWhatsAppOrganisationId();
  if (officialId && tx) await lockWhatsAppChannelShared(tx, officialId);
  const sender = officialId ? await resolveWhatsAppSendConfig(officialId, process.env, tx) : null;
  const channel = assistantChannelConfigSchema.safeParse(sender?.config);
  const approved = whatsappTemplate(template);
  if (!officialId || !sender?.official || !channel.success) return { ready: false as const, reason: "The official NesAfric WhatsApp number is not configured." };
  if (!approved) return { ready: false as const, reason: `No approved WhatsApp template is configured (WHATSAPP_TEMPLATE_${template}).` };
  return { ready: true as const, officialId, assignmentId: sender.assignmentId, phoneNumberId: channel.data.phoneNumberId, approved };
}

/**
 * Queues a template message from the official number inside the caller's transaction, in the
 * conversation the recipient's replies will arrive in. Returns the message id, or null with a
 * reason when it cannot be sent. Delivery happens in the conversation-delivery job, which never
 * resends an unconfirmed attempt.
 */
/** Someone who replied STOP gets no business-initiated message of any kind until they reply START. */
async function optedOut(tx: Tx, phoneE164: string) {
  const identity = await tx.channelIdentity.findUnique({ where: { channel_address: { channel: "WHATSAPP", address: `+${phoneE164.replace(/^\+/, "")}` } }, select: { optedOutAt: true } });
  return Boolean(identity?.optedOutAt);
}

/**
 * Template parameters that come from customers (an organisation's name, a provider's name) must
 * not turn an official NesAfric message into someone else's advert: links and phone numbers are
 * removed and the length is capped.
 */
export function safeTemplateText(value: string, max = 80) {
  return value.replace(/https?:\/\/\S+|www\.\S+|\b\S+\.(com|net|org|io|me|ly|gh|co)\b\S*/gi, "").replace(/\+?\d[\d\s-]{6,}\d/g, "").replace(/\s+/g, " ").trim().slice(0, max) || "A NesAfric customer";
}

export async function queueOfficialTemplate(tx: Tx, message: OfficialTemplateMessage): Promise<{ messageId: string } | { messageId: null; reason: string }> {
  if (await optedOut(tx, message.phoneE164)) return { messageId: null, reason: "The recipient opted out of WhatsApp messages (STOP)." };
  const readiness = await officialTemplateReadiness(message.template, tx);
  if (!readiness.ready) return { messageId: null, reason: readiness.reason };
  const { officialId, assignmentId, phoneNumberId, approved } = readiness;
  const existing = await tx.message.findUnique({ where: { organisationId_channel_externalMessageId: { organisationId: officialId, channel: "WHATSAPP", externalMessageId: message.externalMessageId } } });
  if (existing) return { messageId: existing.id };
  const waId = message.phoneE164.replace(/^\+/, "");
  const sessionKey = whatsappSessionKey(officialId, phoneNumberId, waId);
  const conversation = await tx.conversation.upsert({
    where: { whatsappSessionKey: sessionKey }, update: {},
    create: { organisationId: officialId, channel: "WHATSAPP", channelAddress: waId, whatsappSessionKey: sessionKey, whatsappAssignmentId: assignmentId, subject: "NesAfric WhatsApp assistant", identityLevel: "NONE", participants: { create: { organisationId: officialId, type: "ANONYMOUS", phone: waId, displayName: message.displayName } } },
  });
  const created = await tx.message.create({
    data: {
      organisationId: officialId, conversationId: conversation.id, channel: "WHATSAPP", direction: "OUTBOUND", senderType: "SYSTEM", body: message.body, externalMessageId: message.externalMessageId,
      metadata: JSON.parse(JSON.stringify({ ...(message.metadata ?? {}), whatsappTemplate: { ...approved, bodyParameters: message.bodyParameters } })),
    },
  });
  const delivery = await tx.messageDelivery.create({ data: { organisationId: officialId, messageId: created.id, channel: "WHATSAPP", recipientAddress: waId, idempotencyKey: `message-delivery:${created.id}`, whatsappAssignmentId: assignmentId } });
  await tx.backgroundJob.create({ data: { organisationId: officialId, type: "conversation-message-delivery", idempotencyKey: `conversation-message-delivery:${delivery.id}`, payload: { organisationId: officialId, deliveryId: delivery.id }, maxAttempts: 5 } });
  await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date(), lastOutboundAt: new Date() } });
  return { messageId: created.id };
}


/**
 * Queues a message to a person on the official number: free text when they wrote to us in the
 * last 24 hours, otherwise the approved NOTIFICATION template carrying the same text. Returns
 * null with a reason when neither is possible (nothing is sent then).
 */
export async function queueOfficialText(tx: Tx, input: { phoneE164: string; displayName: string; text: string; externalMessageId: string; metadata?: Record<string, unknown> }): Promise<{ messageId: string } | { messageId: null; reason: string }> {
  if (await optedOut(tx, input.phoneE164)) return { messageId: null, reason: "The recipient opted out of WhatsApp messages (STOP)." };
  // Free text needs the number assignment just as a template does; only the template approval is optional here.
  const readiness = await officialTemplateReadiness("NOTIFICATION", tx);
  const sender = readiness.ready ? readiness : await officialSender(tx);
  if (!sender) return { messageId: null, reason: "The official NesAfric WhatsApp number is not configured." };
  const { officialId, assignmentId, phoneNumberId } = sender;
  const existing = await tx.message.findUnique({ where: { organisationId_channel_externalMessageId: { organisationId: officialId, channel: "WHATSAPP", externalMessageId: input.externalMessageId } } });
  if (existing) return { messageId: existing.id };
  const waId = input.phoneE164.replace(/^\+/, "");
  // Only the conversation on the current official number: one on a replaced number is not continued.
  const conversation = await tx.conversation.findUnique({ where: { whatsappSessionKey: whatsappSessionKey(officialId, phoneNumberId, waId) } });
  const windowOpen = Boolean(conversation?.lastInboundAt && Date.now() - conversation.lastInboundAt.getTime() < 23 * 60 * 60_000);
  if (!windowOpen || !conversation) {
    return queueOfficialTemplate(tx, { phoneE164: input.phoneE164, displayName: input.displayName, template: "NOTIFICATION", bodyParameters: [input.text.slice(0, 1000)], body: input.text, externalMessageId: input.externalMessageId, metadata: input.metadata });
  }
  const created = await tx.message.create({ data: { organisationId: officialId, conversationId: conversation.id, channel: "WHATSAPP", direction: "OUTBOUND", senderType: "SYSTEM", body: input.text.slice(0, 4096), externalMessageId: input.externalMessageId, metadata: JSON.parse(JSON.stringify(input.metadata ?? {})) } });
  const delivery = await tx.messageDelivery.create({ data: { organisationId: officialId, messageId: created.id, channel: "WHATSAPP", recipientAddress: waId, idempotencyKey: `message-delivery:${created.id}`, whatsappAssignmentId: assignmentId } });
  await tx.backgroundJob.create({ data: { organisationId: officialId, type: "conversation-message-delivery", idempotencyKey: `conversation-message-delivery:${delivery.id}`, payload: { organisationId: officialId, deliveryId: delivery.id }, maxAttempts: 5 } });
  await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date(), lastOutboundAt: new Date() } });
  return { messageId: created.id };
}

/** The official number's assignment without a template requirement (caller already holds the shared lock). */
async function officialSender(tx: Tx) {
  const officialId = officialWhatsAppOrganisationId();
  const sender = officialId ? await resolveWhatsAppSendConfig(officialId, process.env, tx) : null;
  const channel = assistantChannelConfigSchema.safeParse(sender?.config);
  if (!officialId || !sender?.official || !channel.success) return null;
  return { officialId, assignmentId: sender.assignmentId, phoneNumberId: channel.data.phoneNumberId };
}
