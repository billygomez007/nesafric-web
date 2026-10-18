import type { Prisma } from "@/platform/database/generated/client";
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
export async function officialTemplateReadiness(template: WhatsAppTemplateKey) {
  const officialId = officialWhatsAppOrganisationId();
  const sender = officialId ? await resolveWhatsAppSendConfig(officialId) : null;
  const channel = assistantChannelConfigSchema.safeParse(sender?.config);
  const approved = whatsappTemplate(template);
  if (!officialId || !sender || !channel.success) return { ready: false as const, reason: "The official NesAfric WhatsApp number is not configured." };
  if (!approved) return { ready: false as const, reason: `No approved WhatsApp template is configured (WHATSAPP_TEMPLATE_${template}).` };
  return { ready: true as const, officialId, phoneNumberId: channel.data.phoneNumberId, approved };
}

/**
 * Queues a template message from the official number inside the caller's transaction, in the
 * conversation the recipient's replies will arrive in. Returns the message id, or null with a
 * reason when it cannot be sent. Delivery happens in the conversation-delivery job, which never
 * resends an unconfirmed attempt.
 */
export async function queueOfficialTemplate(tx: Tx, message: OfficialTemplateMessage): Promise<{ messageId: string } | { messageId: null; reason: string }> {
  const readiness = await officialTemplateReadiness(message.template);
  if (!readiness.ready) return { messageId: null, reason: readiness.reason };
  const { officialId, phoneNumberId, approved } = readiness;
  const existing = await tx.message.findUnique({ where: { organisationId_channel_externalMessageId: { organisationId: officialId, channel: "WHATSAPP", externalMessageId: message.externalMessageId } } });
  if (existing) return { messageId: existing.id };
  const waId = message.phoneE164.replace(/^\+/, "");
  const sessionKey = whatsappSessionKey(officialId, phoneNumberId, waId);
  const conversation = await tx.conversation.upsert({
    where: { whatsappSessionKey: sessionKey }, update: {},
    create: { organisationId: officialId, channel: "WHATSAPP", channelAddress: waId, whatsappSessionKey: sessionKey, subject: "NesAfric WhatsApp assistant", identityLevel: "NONE", participants: { create: { organisationId: officialId, type: "ANONYMOUS", phone: waId, displayName: message.displayName } } },
  });
  const created = await tx.message.create({
    data: {
      organisationId: officialId, conversationId: conversation.id, channel: "WHATSAPP", direction: "OUTBOUND", senderType: "SYSTEM", body: message.body, externalMessageId: message.externalMessageId,
      metadata: JSON.parse(JSON.stringify({ ...(message.metadata ?? {}), whatsappTemplate: { ...approved, bodyParameters: message.bodyParameters } })),
    },
  });
  const delivery = await tx.messageDelivery.create({ data: { organisationId: officialId, messageId: created.id, channel: "WHATSAPP", recipientAddress: waId, idempotencyKey: `message-delivery:${created.id}` } });
  await tx.backgroundJob.create({ data: { organisationId: officialId, type: "conversation-message-delivery", idempotencyKey: `conversation-message-delivery:${delivery.id}`, payload: { organisationId: officialId, deliveryId: delivery.id }, maxAttempts: 5 } });
  await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date(), lastOutboundAt: new Date() } });
  return { messageId: created.id };
}

