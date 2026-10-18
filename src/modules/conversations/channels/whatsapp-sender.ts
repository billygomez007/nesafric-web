import { db } from "@/platform/database/client";

/**
 * The WhatsApp number that sends a business-initiated message for an organisation: its own
 * enabled channel when it has a receiving number, otherwise the official NesAfric number
 * (`WHATSAPP_OFFICIAL_ORGANISATION_ID`). Returns null when neither is configured.
 */
export async function resolveWhatsAppSendConfig(organisationId: string, env: Record<string, string | undefined> = process.env) {
  const official = env.WHATSAPP_OFFICIAL_ORGANISATION_ID?.trim();
  for (const candidate of official && official !== organisationId ? [organisationId, official] : [organisationId]) {
    const channel = await db.communicationChannelConfig.findUnique({ where: { organisationId_channel: { organisationId: candidate, channel: "WHATSAPP" } } });
    const config = (channel?.config ?? {}) as Record<string, unknown>;
    if (channel?.enabled && typeof config.phoneNumberId === "string" && /^\d+$/.test(config.phoneNumberId)) {
      return { senderOrganisationId: candidate, providerKey: channel.providerKey, config };
    }
  }
  return null;
}

/**
 * NOTIFICATION: {{1}} text.
 * PROVIDER_INVITE: {{1}} organisation, {{2}} work; quick replies Accept / Decline.
 * WORK_ORDER: {{1}} organisation, {{2}} reference, {{3}} location, {{4}} issue, {{5}} urgency,
 *   {{6}} what is authorised, {{7}} reply deadline; quick replies Accept / Decline.
 */
export type WhatsAppTemplateKey = "NOTIFICATION" | "PROVIDER_INVITE" | "WORK_ORDER";

/**
 * Approved Meta templates, configured as `name:language` (for example
 * `WHATSAPP_TEMPLATE_NOTIFICATION=nesafric_notification:en`). Each template must be approved in
 * WhatsApp Manager before it is configured; an unconfigured template means business-initiated
 * WhatsApp messages of that kind are not sent at all.
 */
export function whatsappTemplate(key: WhatsAppTemplateKey, env: Record<string, string | undefined> = process.env) {
  const value = env[`WHATSAPP_TEMPLATE_${key}`]?.trim();
  const match = value ? /^([a-z0-9_]{1,512}):([A-Za-z_]{2,15})$/.exec(value) : null;
  return match ? { name: match[1], language: match[2] } : null;
}
