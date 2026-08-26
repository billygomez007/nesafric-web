import { AppError } from "@/platform/errors";

export type ProviderIntentRequest = {
  internalReference: string;
  amountMinor: string;
  currencyCode: string;
  method: "BANK_TRANSFER" | "MOBILE_MONEY" | "CARD";
  returnUrl?: string;
  metadata?: Record<string, string>;
};

export type ProviderIntentResult = {
  providerIntentReference: string;
  status: "PENDING" | "PROCESSING";
  expiresAt?: Date;
  providerPayload?: Record<string, unknown>;
};

export type NormalizedProviderEvent = {
  eventKey: string;
  providerIntentReference: string;
  providerTransactionReference: string;
  status: "SUCCEEDED" | "FAILED" | "CANCELLED";
  amountMinor: string;
  currencyCode: string;
  occurredAt: Date;
  failureReason?: string;
};

export interface PaymentProviderAdapter {
  readonly key: string;
  readonly displayName?: string;
  readonly supportedMethods: ReadonlyArray<"BANK_TRANSFER" | "MOBILE_MONEY" | "CARD">;
  createIntent(request: ProviderIntentRequest): Promise<ProviderIntentResult>;
  parseEvent(payload: unknown): Promise<NormalizedProviderEvent>;
  /**
   * Whether the adapter has the environment configuration it needs to talk to the live
   * provider. Adapters that are unconfigured must still register (so they show up as a
   * temporarily unavailable option) but `createIntent` must reject rather than fabricate
   * a successful checkout.
   */
  isConfigured?(): boolean;
  /**
   * Verify an inbound webhook actually originated from the configured provider using
   * environment-configured credentials. Adapters with no signing secret configured return
   * `{ verified: false, reason: "not-configured" }` rather than throwing.
   */
  verifyWebhookSignature?(rawBody: string, headers: Record<string, string | null>): { verified: boolean; reason?: string };
}

export class PaymentProviderRegistry {
  private readonly adapters = new Map<string, PaymentProviderAdapter>();

  constructor(adapters: PaymentProviderAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: PaymentProviderAdapter) {
    if (this.adapters.has(adapter.key)) throw new Error(`Payment provider adapter '${adapter.key}' is already registered.`);
    this.adapters.set(adapter.key, adapter);
    return this;
  }

  get(key: string) {
    const adapter = this.adapters.get(key);
    if (!adapter) throw new AppError("PAYMENT_PROVIDER_UNKNOWN", 404, `Payment provider adapter '${key}' is not registered.`);
    return adapter;
  }

  list() {
    return [...this.adapters.values()];
  }
}

export const paymentProviders = new PaymentProviderRegistry();
