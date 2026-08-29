import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, NormalizedInboundMessage, OutboundDeliveryResult, OutboundMessageRequest } from "./types";
import { BRAND } from "@/platform/brand";
import { renderEmail } from "@/modules/notifications/email-templates/render";
import { getEmailProvider, type EmailProvider } from "./email-providers";

function hmacHex(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function safeEqual(expected: string, actual: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Email transport boundary — delegates the actual send to a pluggable `EmailProvider`
 * (`ResendEmailProvider` when `RESEND_API_KEY` is configured, `TestEmailProvider` otherwise; see
 * `email-providers.ts`), defaulting to whichever one `getEmailProvider()` resolves but accepting
 * an explicit override so tests never need a real credential or network access. This class itself
 * stays provider-neutral: it only builds the branded HTML/text envelope and the From/Reply-To
 * identity, then hands a plain `{from,to,subject,html,text,replyTo,idempotencyKey}` object to
 * whichever provider is active.
 */
export class EmailChannelAdapter implements ChannelAdapter {
  readonly channel = "EMAIL" as const;

  constructor(private readonly provider: EmailProvider = getEmailProvider()) {}

  async send(request: OutboundMessageRequest): Promise<OutboundDeliveryResult> {
    if (!request.recipientAddress) return { status: "FAILED", failureReason: "No recipient email address is available for this conversation." };
    // Every outbound email gets the UmoAfric branded envelope, whether or not the caller built
    // one explicitly — callers that only ever set `body` (e.g. conversation replies) still get a
    // consistent, professional layout instead of a bare-text message. An explicit `html` from the
    // caller is preserved untouched.
    const html = request.html ?? renderEmail({ heading: request.subject ?? "New message", paragraphs: [request.body] }).html;
    const from = request.fromAddress ?? BRAND.sender.notifications;
    const replyTo = request.replyTo ?? BRAND.contact.support;
    const result = await this.provider.send({
      from,
      to: request.recipientAddress,
      subject: request.subject ?? "New message",
      html,
      text: request.body,
      replyTo,
      inReplyTo: request.externalReferenceId ?? undefined,
      idempotencyKey: request.messageId,
    });
    return result;
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
