import { z } from "zod";
import type { NormalizedInboundMessage } from "./types";

const text = z.string().min(1).max(8_000);
const id = z.string().min(1).max(300);
const media = z.object({ id, mime_type: z.string().max(200).optional(), sha256: z.string().max(200).optional(), caption: text.optional(), filename: z.string().max(300).optional() });
const message = z.object({
  id, from: z.string().regex(/^[1-9]\d{6,14}$/), timestamp: z.string().regex(/^\d{1,12}$/),
  type: z.string().max(50).optional(), text: z.object({ body: text }).optional(),
  context: z.object({ id: id.optional() }).optional(),
  interactive: z.object({
    button_reply: z.object({ id, title: text }).optional(),
    list_reply: z.object({ id, title: text }).optional(),
  }).optional(),
  button: z.object({ text, payload: id.optional() }).optional(),
  image: media.optional(), document: media.optional(), video: media.optional(), audio: media.optional(),
  location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), name: text.optional(), address: text.optional() }).optional(),
});

const status = z.object({
  id, recipient_id: z.string().regex(/^[1-9]\d{6,14}$/),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  timestamp: z.string().regex(/^\d{1,12}$/),
  errors: z.array(z.object({ code: z.number().int() }).passthrough()).max(20).optional(),
}).passthrough();

/**
 * The envelope is checked loosely and each message/status on its own. Meta adds fields and event
 * shapes over time; one unrecognised item must not fail the whole delivery, because a non-2xx
 * answer makes Meta retry the batch and eventually disable the webhook.
 */
const looseArray = z.array(z.unknown()).max(100);
export const whatsappEnvelopeSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({
    id: z.string().optional(),
    changes: z.array(z.object({
      field: z.string().optional(),
      value: z.object({
        metadata: z.object({ phone_number_id: z.string(), display_phone_number: z.string().optional() }).passthrough().optional(),
        contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().max(200) }).passthrough().optional() }).passthrough()).max(100).optional().catch(undefined),
        messages: looseArray.optional(),
        statuses: looseArray.optional(),
      }).passthrough().optional(),
    }).passthrough()).max(100).default([]),
  }).passthrough()).max(100).default([]),
}).passthrough();

/** Template review webhooks (`message_template_status_update`, `template_category_update`, quality). */
const templateId = z.union([z.string().regex(/^\d{1,32}$/), z.number().int().nonnegative()]).transform(String);
const templateBase = { message_template_id: templateId, message_template_name: z.string().regex(/^[a-z0-9_]{1,512}$/), message_template_language: z.string().regex(/^[A-Za-z_]{2,15}$/) };
const templateStatus = z.object({ ...templateBase, event: z.string().regex(/^[A-Z_]{2,40}$/), reason: z.string().max(500).nullish() }).passthrough();
const templateCategory = z.object({ ...templateBase, new_category: z.string().regex(/^[A-Z_]{2,40}$/), previous_category: z.string().max(40).optional() }).passthrough();
const templateQuality = z.object({ ...templateBase, new_quality_score: z.string().regex(/^[A-Z_]{2,40}$/) }).passthrough();
export const WHATSAPP_TEMPLATE_FIELDS = ["message_template_status_update", "template_category_update", "message_template_quality_update"];

export type WhatsAppTemplateEvent =
  | { kind: "status"; wabaId: string; metaTemplateId: string; name: string; language: string; event: string; reason?: string }
  | { kind: "category"; wabaId: string; metaTemplateId: string; name: string; language: string; newCategory: string; previousCategory?: string }
  | { kind: "quality"; wabaId: string; metaTemplateId: string; name: string; language: string; newScore: string };

export type WhatsAppStatusEvent = {
  id: string; recipient: string; status: "sent" | "delivered" | "read" | "failed";
  timestamp: string; errorCodes: number[];
};

/**
 * Only the configured receiving number may route events into this organisation. Template events
 * name no number, only the WABA (`entry.id`), so they are accepted only when the number's WABA is
 * known and matches.
 */
export function parseWhatsAppEvents(payload: unknown, phoneNumberId: string, businessAccountId?: string) {
  const messages: NormalizedInboundMessage[] = [];
  const statuses: WhatsAppStatusEvent[] = [];
  const templates: WhatsAppTemplateEvent[] = [];
  let skipped = 0;
  const parsed = whatsappEnvelopeSchema.safeParse(payload);
  if (!parsed.success || parsed.data.object !== "whatsapp_business_account") return { messages, statuses, templates, skipped: 1 };
  const envelope = parsed.data;
  for (const entry of envelope.entry) {
    if (businessAccountId && entry.id !== businessAccountId) continue;
    for (const change of entry.changes) {
      if (change.field && WHATSAPP_TEMPLATE_FIELDS.includes(change.field)) {
        if (!businessAccountId || entry.id !== businessAccountId) continue;
        const template = parseTemplateChange(change.field, change.value, businessAccountId);
        if (template) templates.push(template); else skipped += 1;
        continue;
      }
      if (change.field && change.field !== "messages") continue;
      const value = change.value;
      if (!value || value.metadata?.phone_number_id !== phoneNumberId) continue;
      for (const raw of value.messages ?? []) {
        const result = message.safeParse(raw);
        if (!result.success) { skipped += 1; continue; }
        const item = result.data;
        const contact = value.contacts?.find((candidate) => candidate.wa_id === item.from);
        const attachment = item.image ?? item.document ?? item.video ?? item.audio;
        const kind = item.image ? "image" : item.document ? "document" : item.video ? "video" : item.audio ? "audio" : item.location ? "location" : "text";
        const body = item.text?.body ?? item.interactive?.button_reply?.id ?? item.interactive?.list_reply?.id ?? item.button?.payload ?? item.button?.text ?? attachment?.caption ?? `[${item.type ?? kind} received]`;
        messages.push({
          externalMessageId: item.id, channelAddress: item.from,
          externalReferenceId: item.context?.id, body, senderName: contact?.profile?.name,
          receivedAt: new Date(Number(item.timestamp) * 1000),
          providerPayload: { phoneNumberId, kind: attachment || item.location ? kind : item.text || item.interactive || item.button ? "text" : "unsupported", ...(attachment ? { media: attachment } : {}), ...(item.location ? { location: item.location } : {}) },
        });
      }
      for (const raw of value.statuses ?? []) {
        const result = status.safeParse(raw);
        if (!result.success) { skipped += 1; continue; }
        const item = result.data;
        statuses.push({ id: item.id, recipient: item.recipient_id, status: item.status, timestamp: item.timestamp, errorCodes: item.errors?.map(({ code }) => code) ?? [] });
      }
    }
  }
  return { messages, statuses, templates, skipped };
}

function parseTemplateChange(field: string, value: unknown, wabaId: string): WhatsAppTemplateEvent | null {
  if (field === "message_template_status_update") {
    const item = templateStatus.safeParse(value);
    return item.success ? { kind: "status", wabaId, metaTemplateId: item.data.message_template_id, name: item.data.message_template_name, language: item.data.message_template_language, event: item.data.event, ...(item.data.reason ? { reason: item.data.reason } : {}) } : null;
  }
  if (field === "template_category_update") {
    const item = templateCategory.safeParse(value);
    return item.success ? { kind: "category", wabaId, metaTemplateId: item.data.message_template_id, name: item.data.message_template_name, language: item.data.message_template_language, newCategory: item.data.new_category, ...(item.data.previous_category ? { previousCategory: item.data.previous_category } : {}) } : null;
  }
  const item = templateQuality.safeParse(value);
  return item.success ? { kind: "quality", wabaId, metaTemplateId: item.data.message_template_id, name: item.data.message_template_name, language: item.data.message_template_language, newScore: item.data.new_quality_score } : null;
}
