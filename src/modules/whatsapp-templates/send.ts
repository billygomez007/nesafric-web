import type { Prisma } from "@/platform/database/generated/client";
import { queueOfficialTemplate } from "@/modules/whatsapp-assistant/outbound";
import { renderTemplate, templateParameters } from "./format";
import type { OptInBasis, UtilityTemplate } from "./registry";
import { approvedTemplate } from "./state";

type Tx = Prisma.TransactionClient;
export type UtilityRecipient = { phone: string; displayName: string; basis: OptInBasis };
export type UtilitySendResult = { outcome: "QUEUED"; messageId: string } | { outcome: "SKIPPED"; reason: string };

/**
 * Queues one Utility template from the official number, inside the caller's transaction. Sent
 * only when the recipient's opt-in basis is one the template allows, Meta approved exactly this
 * text as UTILITY, and the recipient has not replied STOP. `idempotencyKey` names the business
 * event: the same key never produces a second message.
 */
export async function queueUtilityTemplate(tx: Tx, input: { template: UtilityTemplate; recipient: UtilityRecipient; values: Record<string, string>; idempotencyKey: string; metadata?: Record<string, unknown> }): Promise<UtilitySendResult> {
  const { template, recipient } = input;
  if (!template.optIn.includes(recipient.basis)) return { outcome: "SKIPPED", reason: `Template ${template.key} needs ${template.optIn.join(" or ")}; the recipient has ${recipient.basis}.` };
  const approval = await approvedTemplate(tx, template);
  if (!approval.approved) return { outcome: "SKIPPED", reason: approval.reason };
  const parameters = templateParameters(template, input.values);
  const queued = await queueOfficialTemplate(tx, {
    phoneE164: recipient.phone, displayName: recipient.displayName,
    template: { name: approval.name, language: approval.language },
    bodyParameters: parameters, body: renderTemplate(template, parameters),
    externalMessageId: `utility:${template.key}:${input.idempotencyKey}`,
    metadata: { ...input.metadata, utilityTemplate: template.key, templateVersion: template.version, optInBasis: recipient.basis },
  });
  return queued.messageId !== null ? { outcome: "QUEUED", messageId: queued.messageId } : { outcome: "SKIPPED", reason: queued.reason };
}
