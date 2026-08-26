import type { ConversationChannel } from "@/platform/database/generated/client";

export type OutboundMessageRequest = {
  organisationId: string;
  conversationId: string;
  messageId: string;
  channel: ConversationChannel;
  recipientAddress: string | null;
  fromAddress: string | null;
  body: string;
  externalReferenceId?: string | null;
  providerKey?: string | null;
  config?: Record<string, unknown>;
};

export type OutboundDeliveryResult = {
  status: "SENT" | "DELIVERED" | "FAILED" | "SKIPPED";
  providerReference?: string;
  failureReason?: string;
};

export type NormalizedInboundMessage = {
  channelAddress: string;
  toAddress?: string;
  externalMessageId: string;
  externalReferenceId?: string;
  body: string;
  senderName?: string;
  receivedAt?: Date;
};

export interface ChannelAdapter {
  readonly channel: ConversationChannel;
  send(request: OutboundMessageRequest): Promise<OutboundDeliveryResult>;
  /** Normalize a raw provider webhook payload into a conversation-neutral inbound message. */
  normalizeInbound(rawPayload: unknown): NormalizedInboundMessage[];
  /**
   * Verify an inbound webhook actually originated from the configured provider.
   * Adapters that have no provider secret configured (test/dev mode) return
   * `{ verified: false, reason: "not-configured" }` rather than throwing, so
   * callers can decide whether to accept test traffic.
   */
  verifyWebhookSignature(rawBody: string, headers: Record<string, string | null>, secret: string | null): { verified: boolean; reason?: string };
}
