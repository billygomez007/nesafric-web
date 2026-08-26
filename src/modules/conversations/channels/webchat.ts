import type { ChannelAdapter, NormalizedInboundMessage, OutboundDeliveryResult, OutboundMessageRequest } from "./types";

/** IN_APP / WEB_CHAT have no external transport: delivery is the database write itself. */
export class InAppChannelAdapter implements ChannelAdapter {
  constructor(readonly channel: "WEB_CHAT" | "IN_APP") {}

  async send(request: OutboundMessageRequest): Promise<OutboundDeliveryResult> {
    return { status: "DELIVERED", providerReference: `${this.channel.toLowerCase()}:${request.messageId}` };
  }

  normalizeInbound(rawPayload: unknown): NormalizedInboundMessage[] {
    const payload = rawPayload as Partial<NormalizedInboundMessage>;
    if (!payload.channelAddress || !payload.externalMessageId || !payload.body) return [];
    return [{
      channelAddress: payload.channelAddress,
      toAddress: payload.toAddress,
      externalMessageId: payload.externalMessageId,
      externalReferenceId: payload.externalReferenceId,
      body: payload.body,
      senderName: payload.senderName,
      receivedAt: payload.receivedAt,
    }];
  }

  verifyWebhookSignature() {
    return { verified: true };
  }
}
