import { db } from "@/platform/database/client";
import { parseWebhook, verifySignature } from "./cloud-api";
import { whatsAppAssistantConfig } from "./config";
import { applyStatusUpdate, recordEvent, recordInbound, upsertContact } from "./store";

/**
 * More than this many messages from one contact in a minute are stored but not processed. Generous
 * on purpose: an agent sending a burst of listing photos is normal use, not abuse.
 */
export function inboundRateLimitPerMinute() {
  const configured = Number(process.env.WHATSAPP_INBOUND_RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(configured) && configured > 0 ? configured : 60;
}

export type IngestResult =
  | { ok: true; contactIds: string[]; stored: number; duplicates: number; statuses: number; ignored: number }
  | { ok: false; status: 401 | 400 | 404 | 503; reason: string };

/**
 * Authenticates and records one webhook delivery. Fast and side-effect-light by design: the HTTP
 * response must go back to Meta quickly, so conversation processing happens afterwards
 * (`processContact`, via `after()` and a durable safety-net job).
 */
export async function ingestWebhook(rawBody: Buffer | string, signatureHeader: string | null): Promise<IngestResult> {
  const config = whatsAppAssistantConfig();
  if (!config.enabled) return { ok: false, status: 404, reason: "The WhatsApp assistant is not enabled." };
  // Fail closed: without the app secret no request can be authenticated, and without the phone
  // number id no message can be attributed to NesAfric's number — so none is accepted.
  if (!config.appSecret) return { ok: false, status: 503, reason: "WHATSAPP_APP_SECRET is not configured." };
  if (!config.phoneNumberId) return { ok: false, status: 503, reason: "WHATSAPP_PHONE_NUMBER_ID is not configured." };
  if (!verifySignature(rawBody, signatureHeader, config.appSecret)) return { ok: false, status: 401, reason: "Invalid signature." };
  let payload: unknown;
  try {
    payload = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"));
  } catch {
    return { ok: false, status: 400, reason: "Invalid JSON." };
  }
  const { messages, statuses } = parseWebhook(payload);
  // Only events for NesAfric's own number (and business account, when configured). A signed
  // delivery for another number of the same Meta app is acknowledged but never acted on.
  const ours = (event: { phoneNumberId?: string; wabaId?: string }) =>
    event.phoneNumberId === config.phoneNumberId && (!config.businessAccountId || event.wabaId === config.businessAccountId);
  let ignored = 0;
  for (const update of statuses) {
    if (ours(update)) await applyStatusUpdate(update);
    else ignored += 1;
  }

  const contactIds = new Set<string>();
  let stored = 0;
  let duplicates = 0;
  for (const message of messages) {
    if (!ours(message)) {
      ignored += 1;
      continue;
    }
    const contact = await upsertContact(message);
    const inbound = await recordInbound(contact.id, message);
    if (!inbound) {
      // Meta redelivers when our acknowledgement was lost; the job was re-armed if still pending.
      duplicates += 1;
      contactIds.add(contact.id);
      continue;
    }
    stored += 1;
    const recent = await db.whatsAppInboundMessage.count({ where: { contactId: contact.id, receivedAt: { gt: new Date(Date.now() - 60_000) } } });
    const limit = inboundRateLimitPerMinute();
    if (recent > limit) {
      await db.whatsAppInboundMessage.update({ where: { id: inbound.id }, data: { status: "IGNORED", lastError: "Rate limited." } });
      if (recent === limit + 1) await recordEvent("rate_limited", contact.id, {});
      ignored += 1;
      continue;
    }
    contactIds.add(contact.id);
  }
  return { ok: true, contactIds: [...contactIds], stored, duplicates, statuses: statuses.length, ignored };
}
