import { normalizePhone } from "@/platform/identity/phone";
import { ArkeselClient } from "./arkesel-client";
import { MessagingError } from "./errors";

/**
 * Reusable transactional SMS for NesAfric workflows (viewing confirmations, maintenance updates,
 * enquiry and service-request notifications, …). Not wired into any workflow yet: each one should
 * opt in deliberately, with its own consent and rate-limit rules. Server-only.
 *
 * Recipients are normalised to E.164 (Ghana default, international only with "+"); any invalid
 * number rejects the whole call. At most `MAX_TRANSACTIONAL_RECIPIENTS` per call, so no caller can
 * turn this into bulk messaging.
 */
export const MAX_TRANSACTIONAL_RECIPIENTS = 10;

export type TransactionalSmsResult = { status: "SENT"; providerReferences: string[] };

export async function sendTransactionalSms(
  input: { to: string | string[]; message: string; sandbox?: boolean },
  client: ArkeselClient = new ArkeselClient(),
): Promise<TransactionalSmsResult> {
  const raw = Array.isArray(input.to) ? input.to : [input.to];
  if (!raw.length || raw.length > MAX_TRANSACTIONAL_RECIPIENTS) {
    throw new MessagingError("CONFIGURATION", `Transactional SMS needs 1-${MAX_TRANSACTIONAL_RECIPIENTS} recipients.`);
  }
  const recipients = raw.map((value) => normalizePhone(value));
  if (recipients.some((value) => !value)) throw new MessagingError("INVALID_PHONE", "One or more phone numbers are invalid.");
  const message = input.message.trim();
  if (!message || message.length > 918) throw new MessagingError("CONFIGURATION", "SMS text must be 1-918 characters.");
  const result = await client.sendSms({ recipientsE164: [...new Set(recipients as string[])], message, sandbox: input.sandbox });
  return { status: "SENT", providerReferences: result.messages.map((item) => `arkesel:${item.providerId}`) };
}
