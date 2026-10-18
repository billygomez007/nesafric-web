import type { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { activeWhatsAppAssignment, lockWhatsAppChannelShared, trustedWhatsAppConfig } from "./whatsapp-numbers";

type Client = Prisma.TransactionClient | typeof db;
export type WhatsAppSender = { senderOrganisationId: string; assignmentId: string; official: boolean; providerKey: string | null; config: Record<string, unknown> };

/**
 * The WhatsApp number that sends a business-initiated message for an organisation:
 * - its own number, when its channel is enabled and NesAfric assigned it a number;
 * - otherwise the official NesAfric number, when the official organisation
 *   (`WHATSAPP_OFFICIAL_ORGANISATION_ID`) has an enabled channel and an official assignment.
 * A number the organisation saved itself is never used. Returns null when neither applies.
 */
export async function resolveWhatsAppSendConfig(organisationId: string, env: Record<string, string | undefined> = process.env, client: Client = db): Promise<WhatsAppSender | null> {
  const official = env.WHATSAPP_OFFICIAL_ORGANISATION_ID?.trim();
  for (const candidate of official && official !== organisationId ? [organisationId, official] : [organisationId]) {
    const [channel, assignment] = await Promise.all([
      client.communicationChannelConfig.findUnique({ where: { organisationId_channel: { organisationId: candidate, channel: "WHATSAPP" } } }),
      activeWhatsAppAssignment(client, candidate),
    ]);
    if (!channel?.enabled || !assignment) continue;
    // The fallback is only ever the official number itself, never whatever the official
    // organisation happens to hold.
    if (candidate !== organisationId && !assignment.official) continue;
    return { senderOrganisationId: candidate, assignmentId: assignment.id, official: assignment.official, providerKey: channel.providerKey, config: trustedWhatsAppConfig(channel.config, assignment) };
  }
  return null;
}

/**
 * Sends while holding a shared lock on the sending organisation's channel, so an assignment or
 * move waits until the send finishes and a send never goes out from a number that has already
 * moved. Throws (retryable) when the assignment changed between choosing and locking.
 */
export async function withWhatsAppSender<T>(organisationId: string, send: (sender: WhatsAppSender) => Promise<T>, env: Record<string, string | undefined> = process.env): Promise<T | null> {
  const chosen = await resolveWhatsAppSendConfig(organisationId, env);
  if (!chosen) return null;
  return db.$transaction(async (tx) => {
    await lockWhatsAppChannelShared(tx, chosen.senderOrganisationId);
    const current = await resolveWhatsAppSendConfig(organisationId, env, tx);
    if (current?.assignmentId !== chosen.assignmentId) throw new Error("The WhatsApp sending number changed; retrying.");
    return send(current);
  }, { timeout: 30_000, maxWait: 10_000 });
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
