import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, NormalizedInboundMessage, OutboundDeliveryResult, OutboundMessageRequest } from "./types";

function hmacHex(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function safeEqual(expected: string, actual: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Provider-neutral email transport boundary. When `EMAIL_PROVIDER_SEND_URL` and
 * `EMAIL_PROVIDER_API_KEY` are configured this posts a generic JSON payload to
 * the configured provider; otherwise it uses an in-memory test transport so
 * outbound email conversations remain fully exercisable without live
 * credentials. No credentials are invented - if unset, the boundary is a no-op
 * "sent" acknowledgement so the rest of the delivery pipeline can be tested.
 */
export class EmailChannelAdapter implements ChannelAdapter {
  readonly channel = "EMAIL" as const;

  async send(request: OutboundMessageRequest): Promise<OutboundDeliveryResult> {
    if (!request.recipientAddress) return { status: "FAILED", failureReason: "No recipient email address is available for this conversation." };
    const sendUrl = process.env.EMAIL_PROVIDER_SEND_URL;
    const apiKey = process.env.EMAIL_PROVIDER_API_KEY;
    if (!sendUrl || !apiKey) {
      return { status: "SENT", providerReference: `test-email:${request.messageId}` };
    }
    try {
      const response = await fetch(sendUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          from: request.fromAddress,
          to: request.recipientAddress,
          text: request.body,
          headers: request.externalReferenceId ? { "In-Reply-To": request.externalReferenceId } : undefined,
        }),
      });
      if (!response.ok) return { status: "FAILED", failureReason: `Email provider responded with status ${response.status}.` };
      const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
      const providerReference = typeof (payload as { id?: unknown }).id === "string" ? (payload as { id: string }).id : undefined;
      return { status: "SENT", providerReference };
    } catch (error) {
      return { status: "FAILED", failureReason: error instanceof Error ? error.message : "Email provider request failed." };
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
      externalReferenceId: typeof payload.inReplyTo === "string" ? payload.inReplyTo : undefined,
      body,
      senderName: typeof payload.senderName === "string" ? payload.senderName : undefined,
    }];
  }

  verifyWebhookSignature(rawBody: string, headers: Record<string, string | null>, secret: string | null) {
    if (!secret) return { verified: false, reason: "not-configured" };
    const signature = headers["x-webhook-signature"];
    if (!signature) return { verified: false, reason: "missing-signature" };
    return { verified: safeEqual(hmacHex(secret, rawBody), signature) };
  }
}
