import type { ChannelAdapter, NormalizedInboundMessage, OutboundDeliveryResult, OutboundMessageRequest } from "./types";

/**
 * VOICE's slot in the generic omnichannel adapter registry (item 1/12). Unlike WEB_CHAT/EMAIL/
 * WHATSAPP/SMS, a voice call is never delivered by "sending a text `Message`" through this
 * generic path — outbound calls are placed by `src/modules/voice/provider.ts`'s telephony
 * adapter, and inbound calls are routed by `src/modules/voice/service.ts`'s own entrypoint. This
 * adapter exists only so `ConversationChannel.VOICE` satisfies the same registry every other
 * channel does; every method is intentionally inert.
 */
export class VoiceChannelAdapter implements ChannelAdapter {
  readonly channel = "VOICE" as const;

  async send(_request: OutboundMessageRequest): Promise<OutboundDeliveryResult> {
    return { status: "SKIPPED", failureReason: "Voice calls are placed through the voice provider adapter, not the generic channel-message path." };
  }

  normalizeInbound(_rawPayload: unknown): NormalizedInboundMessage[] {
    return [];
  }

  verifyWebhookSignature(): { verified: boolean; reason?: string } {
    return { verified: false, reason: "not-applicable" };
  }
}
