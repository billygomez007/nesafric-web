import { createHash } from "node:crypto";
import { Prisma } from "@/platform/database/generated/client";
import type { BillingWebhookStatus, SubscriptionStatus } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { enqueueNotificationDelivery } from "@/modules/notifications/service";
import { chargeCurrentPeriod, cancelBillingSubscription, getBillingAdapter, resolveDefaultBillingProviderKey } from "@/modules/billing/service";
import type { NormalizedBillingEvent } from "@/modules/billing/providers";
import { notifySubscriptionEvent } from "./notifications";

type Tx = Prisma.TransactionClient;

const json = (value: unknown) => value as Prisma.InputJsonValue;
const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export const DEFAULT_TRIAL_PLAN_KEY = "starter";
export const TRIAL_DAYS = 14;
export const TRIAL_ENDING_NOTICE_DAYS = 3;
export const PAST_DUE_TO_GRACE_DAYS = 3;
export const GRACE_PERIOD_DAYS = 7;

const days = (count: number) => count * 24 * 60 * 60 * 1000;

function addCycle(date: Date, cycle: "MONTHLY" | "ANNUAL") {
  const next = new Date(date);
  if (cycle === "ANNUAL") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

async function planAmountMinor(planId: string, currencyCode: string, billingCycle: "MONTHLY" | "ANNUAL") {
  const price = await db.planPrice.findFirst({ where: { planId, currencyCode, billingCycle, isActive: true } });
  return price ? price.amountMinor.toString() : "0";
}

/** Writes a status transition consistently: `SubscriptionStatusHistory` (only when the status
 * actually changes), the generic `AuditEvent`/`DomainEvent` every other domain in this codebase
 * writes, and attributes the actor (an organisation user, a platform principal, or neither for an
 * automated job) (item 4's "events/audit actor attribution"). */
async function applyTransition(
  tx: Tx,
  subscription: { id: string; organisationId: string; status: SubscriptionStatus },
  toStatus: SubscriptionStatus,
  reason: string,
  actor: { userId?: string; platformPrincipalId?: string } = {},
  extraData: Prisma.OrganisationSubscriptionUpdateInput = {},
) {
  const updated = await tx.organisationSubscription.update({ where: { id: subscription.id }, data: { status: toStatus, ...extraData } });
  if (subscription.status !== toStatus) {
    await tx.subscriptionStatusHistory.create({
      data: { subscriptionId: subscription.id, organisationId: subscription.organisationId, fromStatus: subscription.status, toStatus, reason, actorUserId: actor.userId, actorPlatformPrincipalId: actor.platformPrincipalId },
    });
  }
  await tx.auditEvent.create({
    data: { organisationId: subscription.organisationId, actorUserId: actor.userId, action: "subscription.status_changed", entityType: "organisation_subscription", entityId: subscription.id, metadata: json({ fromStatus: subscription.status, toStatus, reason, platformPrincipalId: actor.platformPrincipalId ?? null }) },
  });
  await tx.domainEvent.create({
    data: { organisationId: subscription.organisationId, name: "subscription.status_changed", aggregateType: "organisation_subscription", aggregateId: subscription.id, payload: json({ fromStatus: subscription.status, toStatus, reason }) },
  });
  return updated;
}

async function notifyAndEnqueue(organisationId: string, run: (tx: Tx) => Promise<string | null>) {
  const notificationId = await db.$transaction(run);
  if (notificationId) await enqueueNotificationDelivery({ id: notificationId, organisationId });
}

/** Creates the initial `TRIALING` subscription for a brand-new organisation (item 1 + item 6).
 * Called transactionally from `organisations/service.ts` so an organisation can never exist
 * without exactly one subscription — never a duplicate identity, never a missing one. */
export async function createTrialSubscription(tx: Tx, organisationId: string, currencyCode: string) {
  const plan = await tx.subscriptionPlan.findUnique({ where: { key: DEFAULT_TRIAL_PLAN_KEY } });
  if (!plan) throw new Error("The default subscription plan has not been seeded.");
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + days(TRIAL_DAYS));
  const subscription = await tx.organisationSubscription.create({
    data: {
      organisationId, planId: plan.id, status: "TRIALING", billingCycle: "MONTHLY", currencyCode,
      billingProviderKey: resolveDefaultBillingProviderKey(),
      trialEndsAt, currentPeriodStart: now, currentPeriodEnd: trialEndsAt,
    },
  });
  await tx.subscriptionStatusHistory.create({ data: { subscriptionId: subscription.id, organisationId, fromStatus: null, toStatus: "TRIALING", reason: "Organisation created; trial started." } });
  await tx.auditEvent.create({ data: { organisationId, action: "subscription.trial_started", entityType: "organisation_subscription", entityId: subscription.id, metadata: json({ planKey: plan.key, trialEndsAt: trialEndsAt.toISOString() }) } });
  await tx.domainEvent.create({ data: { organisationId, name: "subscription.trial_started", aggregateType: "organisation_subscription", aggregateId: subscription.id, payload: json({ planKey: plan.key }) } });
  return subscription;
}

/**
 * Applies a successful billing-period charge (item 4 + item 5): marks the just-ended period's
 * invoice `PAID`, advances to the next period, and returns the subscription to `ACTIVE` from
 * whatever non-cancelled status it was in. A `CANCELLED` subscription is never reactivated by a
 * stray/delayed payment event.
 */
export async function recordSubscriptionPaymentSuccess(organisationId: string, params: { amountMinor?: string; currencyCode?: string; providerInvoiceRef?: string; billingProviderKey: string }) {
  const subscription = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId } });
  if (subscription.status === "CANCELLED") return subscription;
  const currencyCode = params.currencyCode ?? subscription.currencyCode;
  const amountMinor = params.amountMinor ?? (await planAmountMinor(subscription.planId, currencyCode, subscription.billingCycle));
  const newStart = subscription.currentPeriodEnd;
  const newEnd = addCycle(newStart, subscription.billingCycle);
  const fromStatus = subscription.status;
  const result = await db.$transaction(async (tx) => {
    await tx.subscriptionInvoice.upsert({
      where: { subscriptionId_periodStart: { subscriptionId: subscription.id, periodStart: subscription.currentPeriodStart } },
      create: { organisationId, subscriptionId: subscription.id, planId: subscription.planId, periodStart: subscription.currentPeriodStart, periodEnd: subscription.currentPeriodEnd, amountMinor, currencyCode, status: "PAID", billingProviderKey: params.billingProviderKey, providerInvoiceRef: params.providerInvoiceRef, paidAt: new Date() },
      update: { status: "PAID", amountMinor, currencyCode, providerInvoiceRef: params.providerInvoiceRef, paidAt: new Date(), failureReason: null },
    });
    const updated = await applyTransition(tx, subscription, "ACTIVE", fromStatus === "ACTIVE" ? "Billing period renewed." : "Payment succeeded.", {}, {
      currentPeriodStart: newStart, currentPeriodEnd: newEnd, pastDueSince: null, gracePeriodEndsAt: null, suspendedAt: null,
    });
    let notificationId: string | null = null;
    if (fromStatus !== "ACTIVE") {
      await tx.auditEvent.create({ data: { organisationId, action: "subscription.activated", entityType: "organisation_subscription", entityId: subscription.id, metadata: json({ fromStatus }) } });
      await tx.domainEvent.create({ data: { organisationId, name: "subscription.activated", aggregateType: "organisation_subscription", aggregateId: subscription.id, payload: json({ fromStatus }) } });
      notificationId = await notifySubscriptionEvent(tx, organisationId, "SUBSCRIPTION_ACTIVATED", `${subscription.id}:activated:${newStart.toISOString().slice(0, 10)}`);
    } else {
      await tx.auditEvent.create({ data: { organisationId, action: "subscription.renewed", entityType: "organisation_subscription", entityId: subscription.id, metadata: json({ periodStart: newStart.toISOString() }) } });
      await tx.domainEvent.create({ data: { organisationId, name: "subscription.renewed", aggregateType: "organisation_subscription", aggregateId: subscription.id, payload: json({ periodStart: newStart.toISOString() }) } });
    }
    return { updated, notificationId };
  });
  if (result.notificationId) await enqueueNotificationDelivery({ id: result.notificationId, organisationId });
  return result.updated;
}

/**
 * Applies a failed billing-period charge (item 4 + item 5): marks the current period's invoice
 * `FAILED` and moves an `ACTIVE`/`TRIALING` subscription into `PAST_DUE`. Repeated failures while
 * already `PAST_DUE`/`GRACE_PERIOD` update the invoice but never reset the grace clock —
 * `pastDueSince` is set exactly once per dunning cycle.
 */
export async function recordSubscriptionPaymentFailure(organisationId: string, reason: string, meta: { providerInvoiceRef?: string; billingProviderKey: string }) {
  const subscription = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId } });
  if (subscription.status === "CANCELLED" || subscription.status === "SUSPENDED") return subscription;
  const amountMinor = await planAmountMinor(subscription.planId, subscription.currencyCode, subscription.billingCycle);
  const now = new Date();
  const nextStatus: SubscriptionStatus = subscription.status === "PAST_DUE" || subscription.status === "GRACE_PERIOD" ? subscription.status : "PAST_DUE";
  const result = await db.$transaction(async (tx) => {
    await tx.subscriptionInvoice.upsert({
      where: { subscriptionId_periodStart: { subscriptionId: subscription.id, periodStart: subscription.currentPeriodStart } },
      create: { organisationId, subscriptionId: subscription.id, planId: subscription.planId, periodStart: subscription.currentPeriodStart, periodEnd: subscription.currentPeriodEnd, amountMinor, currencyCode: subscription.currencyCode, status: "FAILED", billingProviderKey: meta.billingProviderKey, providerInvoiceRef: meta.providerInvoiceRef, failureReason: reason },
      update: { status: "FAILED", providerInvoiceRef: meta.providerInvoiceRef, failureReason: reason },
    });
    const updated = await applyTransition(tx, subscription, nextStatus, reason, {}, subscription.pastDueSince ? {} : { pastDueSince: now });
    await tx.auditEvent.create({ data: { organisationId, action: "subscription.payment_failed", entityType: "organisation_subscription", entityId: subscription.id, metadata: json({ reason }) } });
    await tx.domainEvent.create({ data: { organisationId, name: "subscription.payment_failed", aggregateType: "organisation_subscription", aggregateId: subscription.id, payload: json({ reason }) } });
    const notificationId = await notifySubscriptionEvent(tx, organisationId, "SUBSCRIPTION_BILLING_ISSUE", `${subscription.id}:billing_issue:${now.toISOString().slice(0, 10)}`);
    return { updated, notificationId };
  });
  if (result.notificationId) await enqueueNotificationDelivery({ id: result.notificationId, organisationId });
  return result.updated;
}

async function finalizeCancellation(subscription: { id: string; organisationId: string; status: SubscriptionStatus }, reason: string, actor: { userId?: string; platformPrincipalId?: string } = {}) {
  await cancelBillingSubscription(subscription.organisationId).catch((error) => console.error("Failed to cancel billing-provider subscription", error));
  return db.$transaction((tx) => applyTransition(tx, subscription, "CANCELLED", reason, actor, { cancelledAt: new Date(), cancelAtPeriodEnd: false }));
}

/**
 * The deterministic, idempotent lifecycle sweep (item 4): finalizes scheduled cancellations,
 * warns about an ending trial, converts an ended trial or renews an active period by attempting
 * a real charge, and escalates unpaid subscriptions `PAST_DUE` → `GRACE_PERIOD` → `SUSPENDED`
 * purely on elapsed time. Safe to run repeatedly (e.g. from a daily background job) — every step
 * only acts on rows whose window has actually elapsed, so running it twice in a row is a no-op
 * the second time.
 */
export async function advanceOverdueSubscriptions(now: Date = new Date()) {
  const summary = { cancelled: 0, trialNoticesSent: 0, trialConverted: 0, renewed: 0, paymentFailures: 0, movedToGrace: 0, suspended: 0 };

  const dueForCancellation = await db.organisationSubscription.findMany({ where: { cancelAtPeriodEnd: true, currentPeriodEnd: { lte: now }, status: { notIn: ["CANCELLED"] } } });
  for (const subscription of dueForCancellation) {
    await finalizeCancellation(subscription, "Cancellation took effect at the end of the billing period.");
    summary.cancelled += 1;
  }

  const endingSoon = await db.organisationSubscription.findMany({ where: { status: "TRIALING", cancelAtPeriodEnd: false, trialEndsAt: { gt: now, lte: new Date(now.getTime() + days(TRIAL_ENDING_NOTICE_DAYS)) } } });
  for (const subscription of endingSoon) {
    await notifyAndEnqueue(subscription.organisationId, (tx) => notifySubscriptionEvent(tx, subscription.organisationId, "SUBSCRIPTION_TRIAL_ENDING", `${subscription.id}:trial_ending:${now.toISOString().slice(0, 10)}`));
    summary.trialNoticesSent += 1;
  }

  const trialsEnded = await db.organisationSubscription.findMany({ where: { status: "TRIALING", cancelAtPeriodEnd: false, trialEndsAt: { lte: now } } });
  for (const subscription of trialsEnded) {
    const amountMinor = await planAmountMinor(subscription.planId, subscription.currencyCode, subscription.billingCycle);
    const outcome = await chargeCurrentPeriod(subscription.organisationId, amountMinor, subscription.currencyCode);
    if (outcome.status === "PAID") {
      await recordSubscriptionPaymentSuccess(subscription.organisationId, { amountMinor, currencyCode: subscription.currencyCode, providerInvoiceRef: outcome.providerInvoiceRef, billingProviderKey: subscription.billingProviderKey });
      summary.trialConverted += 1;
    } else {
      await recordSubscriptionPaymentFailure(subscription.organisationId, outcome.failureReason ?? "The trial-conversion charge was declined.", { providerInvoiceRef: outcome.providerInvoiceRef, billingProviderKey: subscription.billingProviderKey });
      summary.paymentFailures += 1;
    }
  }

  const dueForRenewal = await db.organisationSubscription.findMany({ where: { status: "ACTIVE", cancelAtPeriodEnd: false, currentPeriodEnd: { lte: now } } });
  for (const subscription of dueForRenewal) {
    const amountMinor = await planAmountMinor(subscription.planId, subscription.currencyCode, subscription.billingCycle);
    const outcome = await chargeCurrentPeriod(subscription.organisationId, amountMinor, subscription.currencyCode);
    if (outcome.status === "PAID") {
      await recordSubscriptionPaymentSuccess(subscription.organisationId, { amountMinor, currencyCode: subscription.currencyCode, providerInvoiceRef: outcome.providerInvoiceRef, billingProviderKey: subscription.billingProviderKey });
      summary.renewed += 1;
    } else {
      await recordSubscriptionPaymentFailure(subscription.organisationId, outcome.failureReason ?? "The renewal charge was declined.", { providerInvoiceRef: outcome.providerInvoiceRef, billingProviderKey: subscription.billingProviderKey });
      summary.paymentFailures += 1;
    }
  }

  const dueForGrace = await db.organisationSubscription.findMany({ where: { status: "PAST_DUE", pastDueSince: { lte: new Date(now.getTime() - days(PAST_DUE_TO_GRACE_DAYS)) } } });
  for (const subscription of dueForGrace) {
    const gracePeriodEndsAt = new Date(now.getTime() + days(GRACE_PERIOD_DAYS));
    await notifyAndEnqueue(subscription.organisationId, (tx) => applyTransition(tx, subscription, "GRACE_PERIOD", "Payment remained unresolved past the past-due window.", {}, { gracePeriodEndsAt }).then(() => notifySubscriptionEvent(tx, subscription.organisationId, "SUBSCRIPTION_GRACE_PERIOD", `${subscription.id}:grace:${now.toISOString().slice(0, 10)}`)));
    summary.movedToGrace += 1;
  }

  const dueForSuspension = await db.organisationSubscription.findMany({ where: { status: "GRACE_PERIOD", gracePeriodEndsAt: { lte: now } } });
  for (const subscription of dueForSuspension) {
    await notifyAndEnqueue(subscription.organisationId, (tx) => applyTransition(tx, subscription, "SUSPENDED", "Grace period ended without a resolved payment.", {}, { suspendedAt: now }).then(() => notifySubscriptionEvent(tx, subscription.organisationId, "SUBSCRIPTION_SUSPENDED", `${subscription.id}:suspended:${now.toISOString().slice(0, 10)}`)));
    summary.suspended += 1;
  }

  return summary;
}

async function recordWebhookEvent(providerKey: string, event: NormalizedBillingEvent, payloadHash: string, organisationId: string | null, status: BillingWebhookStatus, failureReason?: string) {
  try {
    return await db.billingWebhookEvent.create({ data: { organisationId, providerKey, eventKey: event.eventKey, eventType: event.eventType, payloadHash, status, failureReason, processedAt: new Date() } });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await db.billingWebhookEvent.findUnique({ where: { providerKey_eventKey: { providerKey, eventKey: event.eventKey } } });
      if (raced) {
        if (raced.payloadHash !== payloadHash) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "The billing webhook event key was reused with a different payload.");
        return raced;
      }
    }
    throw error;
  }
}

/**
 * Idempotent, replay-protected SaaS-billing webhook processor (item 5), mirroring
 * `reconcileProviderEvent`'s (providerKey, eventKey) ledger exactly: a redelivered webhook is
 * recognised and returns the already-recorded outcome rather than re-applying it; the same event
 * key with a different payload is a hard conflict rather than silently overwriting history.
 * Signature verification happens in the route handler, before the raw body is even parsed here —
 * this function only ever runs for an already-verified webhook.
 */
export async function processBillingWebhookEvent(providerKey: string, payload: unknown) {
  const adapter = getBillingAdapter(providerKey);
  const event = await adapter.parseWebhookEvent(payload);
  const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const duplicate = await db.billingWebhookEvent.findUnique({ where: { providerKey_eventKey: { providerKey, eventKey: event.eventKey } } });
  if (duplicate) {
    if (duplicate.payloadHash !== payloadHash) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "The billing webhook event key was reused with a different payload.");
    return duplicate;
  }
  const subscription = event.subscriptionRef
    ? await db.organisationSubscription.findFirst({ where: { billingProviderKey: providerKey, billingSubscriptionRef: event.subscriptionRef } })
    : null;
  if (!subscription) return recordWebhookEvent(providerKey, event, payloadHash, null, "UNMATCHED");
  try {
    if (event.eventType === "INVOICE_PAID") {
      await recordSubscriptionPaymentSuccess(subscription.organisationId, { amountMinor: event.amountMinor, currencyCode: event.currencyCode, providerInvoiceRef: event.providerInvoiceRef, billingProviderKey: providerKey });
    } else if (event.eventType === "INVOICE_FAILED") {
      await recordSubscriptionPaymentFailure(subscription.organisationId, event.failureReason ?? "The billing provider reported a failed charge.", { providerInvoiceRef: event.providerInvoiceRef, billingProviderKey: providerKey });
    } else if (event.eventType === "SUBSCRIPTION_CANCELLED") {
      await db.$transaction((tx) => applyTransition(tx, subscription, "CANCELLED", "Cancelled by billing provider.", {}, { cancelledAt: new Date(), cancelAtPeriodEnd: false }));
    }
    // SUBSCRIPTION_UPDATED is informational only; no local state change is required.
    return recordWebhookEvent(providerKey, event, payloadHash, subscription.organisationId, "PROCESSED");
  } catch (error) {
    await recordWebhookEvent(providerKey, event, payloadHash, subscription.organisationId, "FAILED", error instanceof Error ? error.message : "Unknown failure").catch(() => undefined);
    throw error;
  }
}

/** Platform-initiated suspension (e.g. fraud/abuse), distinct from the billing-driven sweep above — same status field, explicit platform-principal attribution. */
export async function platformSetSubscriptionStatus(platformPrincipalId: string, organisationId: string, toStatus: SubscriptionStatus, reason: string) {
  const subscription = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId } });
  if (toStatus === "CANCELLED") return finalizeCancellation(subscription, reason, { platformPrincipalId });
  return db.$transaction((tx) => applyTransition(tx, subscription, toStatus, reason, { platformPrincipalId }));
}
