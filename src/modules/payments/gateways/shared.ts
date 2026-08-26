import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@/platform/errors";
import type { NormalizedProviderEvent, PaymentProviderAdapter, ProviderIntentRequest, ProviderIntentResult } from "../providers";

/**
 * Environment variables a Ghana mobile-money / card / bank collection integration needs.
 * Every field is read from `process.env` at call time (never hard-coded) so credentials are
 * never invented and can be rotated without a deploy. When `baseUrl` or `apiKey` are unset the
 * adapter is treated as unconfigured and MUST reject checkout initiation rather than fabricate
 * a successful response.
 */
export type CollectionGatewayConfig = {
  key: string;
  displayName: string;
  supportedMethods: ReadonlyArray<"BANK_TRANSFER" | "MOBILE_MONEY" | "CARD">;
  baseUrlEnv: string;
  apiKeyEnv: string;
  merchantIdEnv?: string;
  webhookSecretEnv: string;
  /** Header the provider signs the webhook payload with, e.g. "x-webhook-signature". */
  signatureHeader: string;
};

function env(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function safeEqual(expected: string, actual: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function providerUnavailable(displayName: string) {
  return new AppError(
    "PAYMENT_PROVIDER_UNAVAILABLE",
    503,
    `${displayName} is not configured. Set the required environment variables before initiating a checkout with this provider.`,
  );
}

/**
 * A provider-neutral REST collection-request adapter for Ghana mobile-money networks (MTN
 * MoMo, Telecel Cash, AT Money) and readiness adapters for cards and bank transfer. The exact
 * vendor or aggregator behind `baseUrlEnv` is an operational/env concern, not a code concern:
 * swapping MTN's direct Open API for an aggregator that unifies all three Ghanaian mobile-money
 * networks (or vice versa) only requires changing environment variables, matching the
 * provider-neutral pattern already used for SMS/WhatsApp channel transports in this codebase.
 *
 * Checkout initiation always resolves to `PENDING`/`PROCESSING` — this adapter never marks a
 * payment as succeeded synchronously. Only `parseEvent`, driven by an asynchronous, signature
 * verified webhook call, can report a terminal `SUCCEEDED`/`FAILED`/`CANCELLED` status.
 */
export class GhanaCollectionGatewayAdapter implements PaymentProviderAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly supportedMethods: ReadonlyArray<"BANK_TRANSFER" | "MOBILE_MONEY" | "CARD">;

  constructor(private readonly config: CollectionGatewayConfig) {
    this.key = config.key;
    this.displayName = config.displayName;
    this.supportedMethods = config.supportedMethods;
  }

  private credentials() {
    const baseUrl = env(this.config.baseUrlEnv);
    const apiKey = env(this.config.apiKeyEnv);
    const merchantId = this.config.merchantIdEnv ? env(this.config.merchantIdEnv) : undefined;
    if (!baseUrl || !apiKey) return null;
    return { baseUrl, apiKey, merchantId };
  }

  isConfigured() {
    return this.credentials() !== null;
  }

  async createIntent(request: ProviderIntentRequest): Promise<ProviderIntentResult> {
    const credentials = this.credentials();
    if (!credentials) throw providerUnavailable(this.displayName);
    const response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}/collections/requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credentials.apiKey}`,
        ...(credentials.merchantId ? { "x-merchant-id": credentials.merchantId } : {}),
      },
      body: JSON.stringify({
        externalId: request.internalReference,
        amount: request.amountMinor,
        currency: request.currencyCode,
        payerMsisdn: request.metadata?.msisdn,
        callbackUrl: request.returnUrl,
        metadata: request.metadata,
      }),
    });
    if (!response.ok) {
      throw new AppError("PAYMENT_PROVIDER_ERROR", 502, `${this.displayName} rejected the checkout request with status ${response.status}.`);
    }
    const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
    const providerIntentReference = typeof (payload as { reference?: unknown }).reference === "string"
      ? (payload as { reference: string }).reference
      : request.internalReference;
    return {
      providerIntentReference,
      status: "PROCESSING",
      providerPayload: payload as Record<string, unknown>,
    };
  }

  async parseEvent(payload: unknown): Promise<NormalizedProviderEvent> {
    const event = payload as {
      eventId?: string;
      reference?: string;
      transactionId?: string;
      amount?: string | number;
      currency?: string;
      status?: string;
      occurredAt?: string;
      reason?: string;
    };
    const status = (event.status ?? "").toUpperCase();
    const normalizedStatus: NormalizedProviderEvent["status"] =
      status === "SUCCESSFUL" || status === "SUCCEEDED" || status === "COMPLETED"
        ? "SUCCEEDED"
        : status === "CANCELLED" || status === "CANCELED"
          ? "CANCELLED"
          : "FAILED";
    if (!event.reference || !event.transactionId || event.amount === undefined || !event.currency) {
      throw new AppError("PAYMENT_PROVIDER_EVENT_INVALID", 422, `${this.displayName} sent a webhook event missing required fields.`);
    }
    return {
      eventKey: event.eventId ?? `${event.transactionId}:${status}`,
      providerIntentReference: event.reference,
      providerTransactionReference: event.transactionId,
      status: normalizedStatus,
      amountMinor: String(event.amount),
      currencyCode: event.currency.toUpperCase(),
      occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
      failureReason: normalizedStatus === "SUCCEEDED" ? undefined : event.reason,
    };
  }

  verifyWebhookSignature(rawBody: string, headers: Record<string, string | null>) {
    const secret = env(this.config.webhookSecretEnv);
    if (!secret) return { verified: false, reason: "not-configured" };
    const signature = headers[this.config.signatureHeader];
    if (!signature) return { verified: false, reason: "missing-signature" };
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return { verified: safeEqual(expected, signature) };
  }
}
