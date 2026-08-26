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

/** Which provider a brand-new subscription should bill through: the configured HTTP provider if
 * one is set up, otherwise the always-available deterministic test provider (item 15). */
export function resolveDefaultBillingProviderKey(): string {
  return billingProviders.get("http").isConfigured() ? "http" : "test";
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
  const subscription = await ensureBillingSubscriptionRef(organisationId);
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
