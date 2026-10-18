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
  /** EMAIL-only. Ignored by every other channel adapter. */
  subject?: string;
  /** EMAIL-only branded HTML body. When present, the adapter sends it alongside `body` as the
   * plain-text alternative. Ignored by every other channel adapter. */
  html?: string;
  /** EMAIL-only. Where a reply to an automated message should land. */
  replyTo?: string;
  /** Required for WhatsApp free-form replies; never inferred from a send attempt. */
  lastInboundAt?: Date | null;
  /** Explicit approved template, supplied by trusted application code. */
  whatsappTemplate?: { name: string; language: string; bodyParameters?: string[] };
};

export type OutboundDeliveryResult = {
  status: "SENT" | "DELIVERED" | "FAILED" | "SKIPPED";
  providerReference?: string;
  failureReason?: string;
  /** FAILED only. `false` when another attempt cannot succeed (not configured, window closed,
   * rejected request). Omitted means a transient failure that may be retried. */
  retryable?: boolean;
  /** FAILED only. The provider may have accepted the message; resending could duplicate it. */
  unconfirmed?: boolean;
};

export type NormalizedInboundMessage = {
  channelAddress: string;
  toAddress?: string;
  externalMessageId: string;
  externalReferenceId?: string;
  body: string;
  senderName?: string;
  receivedAt?: Date;
  providerPayload?: Record<string, unknown>;
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
