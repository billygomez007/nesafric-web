import { AppError } from "@/platform/errors";

/**
 * Provider-neutral SaaS billing adapter contract (item 5), matching the same shape as
 * `PaymentProviderAdapter` (tenant rent collection) and `ESignatureAdapter` elsewhere in this
 * codebase — but a completely separate registry and a completely separate concern. This adapter
 * bills the *organisation* for its NesAfric subscription; it must never be confused with, or
 * share a table/route/registry with, the tenant-rent-collection payments module.
 */
export type BillingCustomerRequest = {
  organisationId: string;
  name: string;
  email?: string;
  countryCode: string;
};

export type BillingCustomerResult = { customerRef: string };

export type BillingSubscriptionRequest = {
  customerRef: string;
  internalReference: string;
  planKey: string;
  billingCycle: "MONTHLY" | "ANNUAL";
  currencyCode: string;
  amountMinor: string;
};

export type BillingSubscriptionResult = { subscriptionRef: string };

export type BillingChargeRequest = {
  customerRef: string;
  subscriptionRef: string;
  internalReference: string;
  currencyCode: string;
  amountMinor: string;
};

export type BillingChargeResult = {
  status: "PAID" | "FAILED";
  providerInvoiceRef: string;
  failureReason?: string;
};

export type NormalizedBillingEventType = "INVOICE_PAID" | "INVOICE_FAILED" | "SUBSCRIPTION_CANCELLED" | "SUBSCRIPTION_UPDATED";

export type NormalizedBillingEvent = {
  eventKey: string;
  eventType: NormalizedBillingEventType;
  customerRef?: string;
  subscriptionRef?: string;
  providerInvoiceRef?: string;
  amountMinor?: string;
  currencyCode?: string;
  occurredAt: Date;
  failureReason?: string;
};

export interface BillingProviderAdapter {
  readonly key: string;
  readonly displayName: string;
  /** Whether this adapter has the environment configuration it needs to reach the live provider.
   * The default `test` adapter is always configured (there is nothing to misconfigure); a
   * misconfigured HTTP adapter must reject rather than fabricate a successful charge. */
  isConfigured(): boolean;
  createCustomer(request: BillingCustomerRequest): Promise<BillingCustomerResult>;
  createRecurringSubscription(request: BillingSubscriptionRequest): Promise<BillingSubscriptionResult>;
  cancelRecurringSubscription(subscriptionRef: string): Promise<void>;
  /** Synchronously attempts to charge the current period. Real providers are normally
   * asynchronous (the true outcome arrives via webhook) but every adapter must still return a
   * best-effort immediate result so the deterministic lifecycle sweep (`advanceOverdueSubscriptions`)
   * can make forward progress without a live provider configured. */
  chargeCurrentPeriod(request: BillingChargeRequest): Promise<BillingChargeResult>;
  parseWebhookEvent(payload: unknown): Promise<NormalizedBillingEvent>;
  /** Verifies an inbound webhook actually originated from this provider (item 5's "fail-closed
   * verification"). Missing/invalid signatures must return `verified: false` — never throw and
   * never default to trusting an unverifiable payload. */
  verifyWebhookSignature(rawBody: string, headers: Record<string, string | null>): { verified: boolean; reason?: string };
}

export class BillingProviderRegistry {
  private readonly adapters = new Map<string, BillingProviderAdapter>();

  constructor(adapters: BillingProviderAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: BillingProviderAdapter) {
    if (this.adapters.has(adapter.key)) throw new Error(`Billing provider adapter '${adapter.key}' is already registered.`);
    this.adapters.set(adapter.key, adapter);
    return this;
  }

  get(key: string) {
    const adapter = this.adapters.get(key);
    if (!adapter) throw new AppError("BILLING_PROVIDER_UNKNOWN", 404, `Billing provider adapter '${key}' is not registered.`);
    return adapter;
  }

  list() {
    return [...this.adapters.values()];
  }
}

export const billingProviders = new BillingProviderRegistry();
