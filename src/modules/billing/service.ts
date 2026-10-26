import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { billingProviders } from "./gateways";
import type { BillingProviderAdapter } from "./providers";

/**
 * The pure "talk to a SaaS billing provider" layer (item 5). Deliberately knows nothing about
 * `OrganisationSubscription` lifecycle/status transitions — that state machine lives in
 * `src/modules/subscriptions/lifecycle.ts`, which calls into this module (never the reverse),
 * keeping "how do we bill" and "what does a billing outcome mean for this organisation" cleanly
 * separated, one-directional layers.
 */

export function getBillingAdapter(providerKey: string): BillingProviderAdapter {
  return billingProviders.get(providerKey);
}

/** Which provider a subscription should bill through: the configured HTTP provider if one is set
 * up, otherwise the deterministic test provider. The test provider refuses to work in production,
 * so an unconfigured production deployment can never take or fake a payment. */
export function resolveDefaultBillingProviderKey(): string {
  return billingProviders.get("http").isConfigured() ? "http" : "test";
}

/** The provider to open a checkout with right now, or null when no provider can take payments. */
export function resolveCheckoutProvider(): BillingProviderAdapter | null {
  const key = resolveDefaultBillingProviderKey();
  const adapter = billingProviders.get(key);
  return adapter.isConfigured() ? adapter : null;
}

/** Whether the provider holds a recurring authorisation it can charge without the customer —
 * only a subscription reference the provider itself issued. A trial never has one, so a trial is
 * never charged automatically. */
export function hasRecurringAuthorisation(subscription: { billingProviderKey: string; billingSubscriptionRef: string | null; billingCustomerRef: string | null }) {
  if (!subscription.billingSubscriptionRef || !subscription.billingCustomerRef) return false;
  const adapter = billingProviders.list().find((candidate) => candidate.key === subscription.billingProviderKey);
  return Boolean(adapter?.isConfigured());
}

export function listBillingProviders() {
  return billingProviders.list().map((adapter) => ({ key: adapter.key, displayName: adapter.displayName, available: adapter.isConfigured() }));
}

/** Ensures the organisation's subscription has a billing-provider customer reference, creating one on first use (item 1's "billing customer refs"). */
export async function ensureBillingCustomer(organisationId: string) {
  const subscription = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId }, include: { organisation: true } });
  if (subscription.billingCustomerRef) return subscription;
  const adapter = getBillingAdapter(subscription.billingProviderKey);
  const result = await adapter.createCustomer({ organisationId, name: subscription.organisation.name, countryCode: subscription.organisation.countryCode });
  return db.organisationSubscription.update({ where: { id: subscription.id }, data: { billingCustomerRef: result.customerRef } });
}

/** Ensures a recurring billing-provider subscription reference exists, creating one on first use. */
export async function ensureBillingSubscriptionRef(organisationId: string) {
  const withCustomer = await ensureBillingCustomer(organisationId);
  if (withCustomer.billingSubscriptionRef) return withCustomer;
  const plan = await db.subscriptionPlan.findUniqueOrThrow({ where: { id: withCustomer.planId } });
  const price = await db.planPrice.findFirst({ where: { planId: plan.id, currencyCode: withCustomer.currencyCode, billingCycle: withCustomer.billingCycle, isActive: true } });
  const adapter = getBillingAdapter(withCustomer.billingProviderKey);
  const result = await adapter.createRecurringSubscription({
    customerRef: withCustomer.billingCustomerRef!,
    internalReference: withCustomer.id,
    planKey: plan.key,
    billingCycle: withCustomer.billingCycle,
    currencyCode: withCustomer.currencyCode,
    amountMinor: (price?.amountMinor ?? new Prisma.Decimal(0)).toString(),
  });
  return db.organisationSubscription.update({ where: { id: withCustomer.id }, data: { billingSubscriptionRef: result.subscriptionRef } });
}

/** Attempts to charge the organisation's current billing period. Never throws for a declined
 * charge (that is a normal `FAILED` result the lifecycle state machine handles) — only for a
 * genuinely unavailable/misconfigured provider. */
export async function chargeCurrentPeriod(organisationId: string, amountMinor: string, currencyCode: string) {
  const subscription = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId } });
  if (!hasRecurringAuthorisation(subscription)) return { status: "FAILED" as const, providerInvoiceRef: undefined, failureReason: "No recurring payment authorisation is on file." };
  const adapter = getBillingAdapter(subscription.billingProviderKey);
  return adapter.chargeCurrentPeriod({
    customerRef: subscription.billingCustomerRef!,
    subscriptionRef: subscription.billingSubscriptionRef!,
    internalReference: `${subscription.id}:${subscription.currentPeriodStart.toISOString()}`,
    currencyCode,
    amountMinor,
  });
}

/** Cancels the recurring charge at the provider so no further periods are billed. */
export async function cancelBillingSubscription(organisationId: string) {
  const subscription = await db.organisationSubscription.findUnique({ where: { organisationId } });
  if (!subscription?.billingSubscriptionRef) return;
  const adapter = getBillingAdapter(subscription.billingProviderKey);
  await adapter.cancelRecurringSubscription(subscription.billingSubscriptionRef);
}
