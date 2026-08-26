import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@/platform/errors";
import type {
  BillingChargeRequest,
  BillingChargeResult,
  BillingCustomerRequest,
  BillingCustomerResult,
  BillingProviderAdapter,
  BillingSubscriptionRequest,
  BillingSubscriptionResult,
  NormalizedBillingEvent,
} from "../providers";

function env(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function safeEqual(expected: string, actual: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function providerUnavailable() {
  return new AppError("BILLING_PROVIDER_UNAVAILABLE", 503, "No SaaS billing provider is configured. Set BILLING_HTTP_BASE_URL and BILLING_HTTP_API_KEY before enabling live billing.");
}

/**
 * Provider-neutral REST SaaS-billing adapter (item 5). Which real billing vendor sits behind
 * `BILLING_HTTP_BASE_URL` (a subscription-billing platform, or an in-house billing service) is an
 * operational/env concern, matching the exact pattern already used for Ghana payment gateways and
 * the e-signature/geocoding/calendar adapters: a generic REST contract, credentials read from the
 * environment only, and a webhook secured with an HMAC signature header.
 */
export class HttpBillingAdapter implements BillingProviderAdapter {
  readonly key = "http";
  readonly displayName = "External billing provider";

  private credentials() {
    const baseUrl = env("BILLING_HTTP_BASE_URL");
    const apiKey = env("BILLING_HTTP_API_KEY");
    if (!baseUrl || !apiKey) return null;
    return { baseUrl, apiKey };
  }

  isConfigured() {
    return this.credentials() !== null;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const credentials = this.credentials();
    if (!credentials) throw providerUnavailable();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(env("BILLING_HTTP_TIMEOUT_MS") ?? "15000"));
    try {
      const authHeaderValue = ["Bearer", credentials.apiKey].join(" ");
      const response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", authorization: authHeaderValue },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new AppError("BILLING_PROVIDER_ERROR", 502, `The billing provider rejected the request with status ${response.status}.`);
      return (await response.json().catch(() => ({}))) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async createCustomer(request: BillingCustomerRequest): Promise<BillingCustomerResult> {
    const payload = await this.post<{ customerRef?: string }>("/customers", { externalId: request.organisationId, name: request.name, email: request.email, countryCode: request.countryCode });
    if (!payload.customerRef) throw new AppError("BILLING_PROVIDER_ERROR", 502, "The billing provider response was missing a customer reference.");
    return { customerRef: payload.customerRef };
  }

  async createRecurringSubscription(request: BillingSubscriptionRequest): Promise<BillingSubscriptionResult> {
    const payload = await this.post<{ subscriptionRef?: string }>("/subscriptions", {
      customerRef: request.customerRef, externalId: request.internalReference, planKey: request.planKey,
      billingCycle: request.billingCycle, currency: request.currencyCode, amount: request.amountMinor,
    });
    if (!payload.subscriptionRef) throw new AppError("BILLING_PROVIDER_ERROR", 502, "The billing provider response was missing a subscription reference.");
    return { subscriptionRef: payload.subscriptionRef };
  }

  async cancelRecurringSubscription(subscriptionRef: string): Promise<void> {
    await this.post(`/subscriptions/${encodeURIComponent(subscriptionRef)}/cancel`, {});
  }

  async chargeCurrentPeriod(request: BillingChargeRequest): Promise<BillingChargeResult> {
    const payload = await this.post<{ status?: string; providerInvoiceRef?: string; failureReason?: string }>("/charges", {
      customerRef: request.customerRef, subscriptionRef: request.subscriptionRef, externalId: request.internalReference,
      currency: request.currencyCode, amount: request.amountMinor,
    });
    if (!payload.providerInvoiceRef) throw new AppError("BILLING_PROVIDER_ERROR", 502, "The billing provider response was missing an invoice reference.");
    return { status: payload.status === "PAID" ? "PAID" : "FAILED", providerInvoiceRef: payload.providerInvoiceRef, failureReason: payload.failureReason };
  }

  async parseWebhookEvent(payload: unknown): Promise<NormalizedBillingEvent> {
    const event = payload as {
      eventId?: string; eventType?: string; customerRef?: string; subscriptionRef?: string;
      providerInvoiceRef?: string; amount?: string; currency?: string; occurredAt?: string; failureReason?: string;
    };
    if (!event.eventType || !event.subscriptionRef) {
      throw new AppError("BILLING_EVENT_INVALID", 422, "The billing webhook event is missing required fields (eventType, subscriptionRef).");
    }
    const knownTypes = new Set(["INVOICE_PAID", "INVOICE_FAILED", "SUBSCRIPTION_CANCELLED", "SUBSCRIPTION_UPDATED"]);
    if (!knownTypes.has(event.eventType)) throw new AppError("BILLING_EVENT_INVALID", 422, `Unrecognised billing event type '${event.eventType}'.`);
    return {
      eventKey: event.eventId ?? `${event.subscriptionRef}:${event.eventType}:${event.occurredAt ?? ""}`,
      eventType: event.eventType as NormalizedBillingEvent["eventType"],
      customerRef: event.customerRef,
      subscriptionRef: event.subscriptionRef,
      providerInvoiceRef: event.providerInvoiceRef,
      amountMinor: event.amount,
      currencyCode: event.currency?.toUpperCase(),
      occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
      failureReason: event.failureReason,
    };
  }

  verifyWebhookSignature(rawBody: string, headers: Record<string, string | null>) {
    const secret = env("BILLING_HTTP_WEBHOOK_SECRET");
    if (!secret) return { verified: false, reason: "not-configured" };
    const signature = headers["x-billing-signature"];
    if (!signature) return { verified: false, reason: "missing-signature" };
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return { verified: safeEqual(expected, signature) };
  }
}
