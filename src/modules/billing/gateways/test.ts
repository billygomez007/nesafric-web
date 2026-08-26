import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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

/**
 * Deterministic, credential-free billing adapter (item 5 + item 15's "App works absent billing
 * credentials"). This is the default adapter for every organisation: it always succeeds
 * synchronously (there is no real payment network to fail against), so the full subscription
 * lifecycle — trial, activation, renewal, cancellation — is fully exercisable in development and
 * automated tests with zero configuration.
 *
 * Its webhook signing key is intentionally a fixed, publicly-documented, non-secret constant
 * (overridable via `BILLING_TEST_WEBHOOK_SECRET` for tests that want a distinct value) — exactly
 * like the deterministic AI provider and the internal e-signature adapter need no credentials by
 * design. This still lets the fail-closed verification path be genuinely exercised end-to-end
 * (a missing or incorrect signature is still rejected) without requiring any real provider
 * credential.
 */
export class TestBillingAdapter implements BillingProviderAdapter {
  readonly key = "test";
  readonly displayName = "Deterministic test billing";

  private secret() {
    return env("BILLING_TEST_WEBHOOK_SECRET") ?? "nesafric-test-billing-webhook-secret";
  }

  isConfigured() {
    return true;
  }

  async createCustomer(request: BillingCustomerRequest): Promise<BillingCustomerResult> {
    return { customerRef: `cus_test_${createHash("sha256").update(request.organisationId).digest("hex").slice(0, 24)}` };
  }

  async createRecurringSubscription(request: BillingSubscriptionRequest): Promise<BillingSubscriptionResult> {
    return { subscriptionRef: `sub_test_${createHash("sha256").update(request.internalReference).digest("hex").slice(0, 24)}` };
  }

  async cancelRecurringSubscription(): Promise<void> {
    // Nothing external to cancel.
  }

  async chargeCurrentPeriod(request: BillingChargeRequest): Promise<BillingChargeResult> {
    return { status: "PAID", providerInvoiceRef: `inv_test_${createHash("sha256").update(request.internalReference).digest("hex").slice(0, 24)}` };
  }

  async parseWebhookEvent(payload: unknown): Promise<NormalizedBillingEvent> {
    const event = payload as {
      eventId?: string;
      eventType?: string;
      customerRef?: string;
      subscriptionRef?: string;
      providerInvoiceRef?: string;
      amountMinor?: string;
      currencyCode?: string;
      occurredAt?: string;
      failureReason?: string;
    };
    if (!event.eventType || !event.subscriptionRef) {
      throw new Error("Test billing webhook event is missing required fields (eventType, subscriptionRef).");
    }
    return {
      eventKey: event.eventId ?? randomUUID(),
      eventType: event.eventType as NormalizedBillingEvent["eventType"],
      customerRef: event.customerRef,
      subscriptionRef: event.subscriptionRef,
      providerInvoiceRef: event.providerInvoiceRef,
      amountMinor: event.amountMinor,
      currencyCode: event.currencyCode?.toUpperCase(),
      occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
      failureReason: event.failureReason,
    };
  }

  verifyWebhookSignature(rawBody: string, headers: Record<string, string | null>) {
    const signature = headers["x-billing-signature"];
    if (!signature) return { verified: false, reason: "missing-signature" };
    const expected = createHmac("sha256", this.secret()).update(rawBody).digest("hex");
    return { verified: safeEqual(expected, signature) };
  }
}
