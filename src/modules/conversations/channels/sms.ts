import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, NormalizedInboundMessage, OutboundDeliveryResult, OutboundMessageRequest } from "./types";

function safeEqual(expected: string, actual: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Provider-neutral SMS transport. `SMS_PROVIDER_SEND_URL` / `SMS_PROVIDER_API_KEY`
 * point at any REST-based aggregator (no single telecom/vendor is hard-coded);
 * unset falls back to a deterministic test transport.
 */
export class SmsChannelAdapter implements ChannelAdapter {
  readonly channel = "SMS" as const;

  async send(request: OutboundMessageRequest): Promise<OutboundDeliveryResult> {
    if (!request.recipientAddress) return { status: "FAILED", failureReason: "No recipient phone number is available for this conversation." };
    const sendUrl = process.env.SMS_PROVIDER_SEND_URL;
    const apiKey = process.env.SMS_PROVIDER_API_KEY;
    if (!sendUrl || !apiKey) {
      return { status: "SENT", providerReference: `test-sms:${request.messageId}` };
    }
    try {
      const response = await fetch(sendUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ to: request.recipientAddress, from: request.fromAddress, message: request.body }),
      });
      if (!response.ok) return { status: "FAILED", failureReason: `SMS provider responded with status ${response.status}.` };
      const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
      const providerReference = typeof (payload as { id?: unknown }).id === "string" ? (payload as { id: string }).id : undefined;
      return { status: "SENT", providerReference };
    } catch (error) {
      return { status: "FAILED", failureReason: error instanceof Error ? error.message : "SMS provider request failed." };
    }
  }

  normalizeInbound(rawPayload: unknown): NormalizedInboundMessage[] {
    const payload = rawPayload as Record<string, unknown>;
    const from = typeof payload.from === "string" ? payload.from : typeof payload.sender === "string" ? payload.sender : undefined;
    const messageId = typeof payload.messageId === "string" ? payload.messageId : typeof payload.id === "string" ? payload.id : undefined;
    const body = typeof payload.text === "string" ? payload.text : typeof payload.body === "string" ? payload.body : undefined;
    if (!from || !messageId || !body) return [];
    return [{
      channelAddress: from,
      toAddress: typeof payload.to === "string" ? payload.to : undefined,
      externalMessageId: messageId,
      body,
    }];
  }

  verifyWebhookSignature(rawBody: string, headers: Record<string, string | null>, secret: string | null) {
    if (!secret) return { verified: false, reason: "not-configured" };
    const signature = headers["x-webhook-signature"];
    if (!signature) return { verified: false, reason: "missing-signature" };
    return { verified: safeEqual(createHmac("sha256", secret).update(rawBody).digest("hex"), signature) };
  }
}
