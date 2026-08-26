import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, NormalizedInboundMessage, OutboundDeliveryResult, OutboundMessageRequest } from "./types";

function safeEqual(expected: string, actual: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

type WhatsAppCloudEntry = {
  changes?: Array<{
    value?: {
      messages?: Array<{ id?: string; from?: string; timestamp?: string; text?: { body?: string }; context?: { id?: string } }>;
      contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
      metadata?: { display_phone_number?: string };
    };
  }>;
};

/**
 * WhatsApp transport abstraction. The wire shape mirrors the WhatsApp Cloud
 * API webhook contract (the most common Business Solution Provider shape),
 * but the adapter interface itself is provider-neutral: swapping to a
 * different BSP means adjusting `send()`/`normalizeInbound()` internals, not
 * the conversation/service layer that calls this adapter. Falls back to a
 * deterministic test transport when no provider credentials are configured.
 */
export class WhatsAppChannelAdapter implements ChannelAdapter {
  readonly channel = "WHATSAPP" as const;

  async send(request: OutboundMessageRequest): Promise<OutboundDeliveryResult> {
    if (!request.recipientAddress) return { status: "FAILED", failureReason: "No recipient WhatsApp number is available for this conversation." };
    const sendUrl = process.env.WHATSAPP_PROVIDER_SEND_URL;
    const accessToken = process.env.WHATSAPP_PROVIDER_ACCESS_TOKEN;
    if (!sendUrl || !accessToken) {
      return { status: "SENT", providerReference: `test-whatsapp:${request.messageId}` };
    }
    try {
      const response = await fetch(sendUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: request.recipientAddress,
          type: "text",
          text: { body: request.body },
        }),
      });
      if (!response.ok) return { status: "FAILED", failureReason: `WhatsApp provider responded with status ${response.status}.` };
      const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
      const messages = (payload as { messages?: Array<{ id?: string }> }).messages;
      return { status: "SENT", providerReference: messages?.[0]?.id };
    } catch (error) {
      return { status: "FAILED", failureReason: error instanceof Error ? error.message : "WhatsApp provider request failed." };
    }
  }

  normalizeInbound(rawPayload: unknown): NormalizedInboundMessage[] {
    const payload = rawPayload as { entry?: WhatsAppCloudEntry[] };
    const results: NormalizedInboundMessage[] = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const contact = change.value?.contacts?.[0];
        for (const message of change.value?.messages ?? []) {
          if (!message.id || !message.from || !message.text?.body) continue;
          results.push({
            channelAddress: message.from,
            toAddress: change.value?.metadata?.display_phone_number,
            externalMessageId: message.id,
            externalReferenceId: message.context?.id,
            body: message.text.body,
            senderName: contact?.profile?.name,
            receivedAt: message.timestamp ? new Date(Number(message.timestamp) * 1000) : undefined,
          });
        }
      }
    }
    return results;
  }

  /** Verifies the `X-Hub-Signature-256: sha256=<hex>` header used by Meta-shaped webhooks. */
  verifyWebhookSignature(rawBody: string, headers: Record<string, string | null>, secret: string | null) {
    if (!secret) return { verified: false, reason: "not-configured" };
    const header = headers["x-hub-signature-256"];
    if (!header?.startsWith("sha256=")) return { verified: false, reason: "missing-signature" };
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return { verified: safeEqual(expected, header.slice("sha256=".length)) };
  }

  /** GET webhook handshake: returns the challenge only when the verify token matches. */
  verifyChallenge(mode: string | null, verifyToken: string | null, challenge: string | null, configuredToken: string | null) {
    if (mode === "subscribe" && verifyToken && configuredToken && safeEqual(configuredToken, verifyToken)) return challenge;
    return null;
  }
}
