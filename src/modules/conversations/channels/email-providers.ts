import { Resend } from "resend";

/**
 * The two real email transports UmoAfric can be in: a genuinely-connected Resend account, or the
 * deterministic in-memory test transport used whenever `RESEND_API_KEY` is unset (local dev, CI,
 * any environment nobody has wired a real provider into yet). Every `providerReference` this
 * module produces is prefixed by which one actually ran (`resend:` vs `test-email:`), so nothing
 * downstream — job records, admin health views, support investigations — can mistake a simulated
 * send for a real one. `status: "SENT"` here means "the provider accepted the request", never
 * "a mailbox received it" — that stronger claim only ever comes from a Resend `email.delivered`
 * webhook event, which is a separate, later signal (see the `/api/webhooks/resend` route).
 */
export type EmailProviderMode = "RESEND" | "TEST";

export type EmailSendInput = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Threaded-reply header for conversation messages; ignored by callers that don't set it. */
  inReplyTo?: string;
  /** A stable, caller-chosen id (typically the same `messageId` already used for our own
   * BackgroundJob idempotency) — when the provider supports it, this also protects against a
   * duplicate *external* send if our own job runner ever retries after a send actually succeeded
   * but the result was lost before the job could be marked SUCCEEDED. */
  idempotencyKey?: string;
};

export type EmailProviderResult =
  | { status: "SENT"; providerReference: string }
  | { status: "FAILED"; failureReason: string };

export interface EmailProvider {
  readonly mode: EmailProviderMode;
  send(input: EmailSendInput): Promise<EmailProviderResult>;
}

/** No real credentials are ever invented — this is the explicit, honestly-labeled simulation
 * transport, not a silent stand-in for a real one. */
export class TestEmailProvider implements EmailProvider {
  readonly mode = "TEST" as const;

  async send(input: EmailSendInput): Promise<EmailProviderResult> {
    return { status: "SENT", providerReference: `test-email:${input.idempotencyKey ?? `${Date.now()}`}` };
  }
}

/** The narrow slice of the Resend SDK this adapter actually calls — declared separately so tests
 * can pass a lightweight fake instead of constructing a real `Resend` client (which needs a
 * plausible-looking API key and makes real network calls). */
export type ResendClient = { emails: { send: Resend["emails"]["send"] } };

export class ResendEmailProvider implements EmailProvider {
  readonly mode = "RESEND" as const;
  private readonly client: ResendClient;

  constructor(apiKeyOrClient: string | ResendClient) {
    this.client = typeof apiKeyOrClient === "string" ? new Resend(apiKeyOrClient) : apiKeyOrClient;
  }

  async send(input: EmailSendInput): Promise<EmailProviderResult> {
    try {
      const { data, error } = await this.client.emails.send(
        {
          from: input.from,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
          replyTo: input.replyTo,
          headers: input.inReplyTo ? { "In-Reply-To": input.inReplyTo } : undefined,
        },
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      );
      // Resend's SDK never throws on an API-level rejection — it returns `{ data: null, error }`
      // instead — so a rejected send must be checked explicitly, not just wrapped in try/catch.
      if (error || !data) {
        return { status: "FAILED", failureReason: error?.message ?? "Resend rejected the email with no error detail." };
      }
      return { status: "SENT", providerReference: `resend:${data.id}` };
    } catch (error) {
      // A thrown error here is a network/transport failure, not an API rejection — the Resend SDK
      // never includes the API key in any error it throws, but the message is normalized through
      // `Error.message` regardless, so nothing provider-internal beyond that ever surfaces.
      return { status: "FAILED", failureReason: error instanceof Error ? error.message : "Resend request failed." };
    }
  }
}

/** Fresh on every call (deliberately not cached at module scope) — cheap to construct, and this
 * keeps `RESEND_API_KEY` reads honest across the process lifetime rather than freezing whatever
 * was configured at first use, which would misbehave in tests that toggle env vars per case. */
export function getEmailProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY;
  return apiKey ? new ResendEmailProvider(apiKey) : new TestEmailProvider();
}

/** Safe, secret-free provider status for diagnostics/health surfaces (Platform Admin, `/api/health`
 * equivalents) — reports only which transport is active and whether it's configured, never the
 * credential itself. */
export function getEmailProviderStatus(): { provider: EmailProviderMode; configured: boolean } {
  const configured = Boolean(process.env.RESEND_API_KEY);
  return { provider: configured ? "RESEND" : "TEST", configured };
}
