import { createHash } from "node:crypto";
import { Prisma } from "@/platform/database/generated/client";
import type { BillingWebhookStatus, SubscriptionStatus } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { enqueueNotificationDelivery } from "@/modules/notifications/service";
import { chargeCurrentPeriod, cancelBillingSubscription, getBillingAdapter, hasRecurringAuthorisation } from "@/modules/billing/service";
import type { NormalizedBillingEvent } from "@/modules/billing/providers";
import { notifySubscriptionEvent } from "./notifications";
import { PM_BILLING_RULES, TRIAL_PLAN_KEY } from "./plan-catalog";
import { applyCheckoutFailed, applyCheckoutPaid, expireStaleCheckouts } from "./checkout";

type Tx = Prisma.TransactionClient;

const json = (value: unknown) => value as Prisma.InputJsonValue;
const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export const TRIAL_DAYS = PM_BILLING_RULES.trialDays;
export const PAST_DUE_TO_GRACE_DAYS = PM_BILLING_RULES.pastDueDays;
export const GRACE_PERIOD_DAYS = PM_BILLING_RULES.gracePeriodDays;

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
export async function applyTransition(
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

/**
 * Applies a successful recurring renewal charge reported by the billing provider: marks the
 * just-ended period's invoice `PAID`, advances to the next period (applying a downgrade scheduled
 * for this renewal), and returns the subscription to `ACTIVE`. Only an organisation already on a
 * paid plan can renew this way — a trial or an expired plan is activated by a confirmed checkout,
 * never by a stray invoice event. A `CANCELLED` subscription is never reactivated by a delayed
 * payment event. The amount must match the configured price, or nothing is granted.
 */
export async function recordSubscriptionPaymentSuccess(organisationId: string, params: { amountMinor?: string; currencyCode?: string; providerInvoiceRef?: string; billingProviderKey: string }) {
  const subscription = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId }, include: { plan: true } });
  if (subscription.status === "CANCELLED") return subscription;
  if (subscription.plan.key === TRIAL_PLAN_KEY || subscription.status === "EXPIRED" || subscription.status === "PAYMENT_PENDING" || subscription.status === "SUSPENDED") {
    throw new AppError("BILLING_EVENT_NOT_APPLICABLE", 409, "This organisation has no paid plan to renew; payment must go through a plan checkout.");
  }
  const renewalPlanId = subscription.selectedPlanId ?? subscription.planId;
  const currencyCode = params.currencyCode ?? subscription.currencyCode;
  const expected = await planAmountMinor(renewalPlanId, currencyCode, subscription.billingCycle);
  const amountMinor = params.amountMinor ?? expected;
  if (amountMinor !== expected || currencyCode !== subscription.currencyCode) {
    throw new AppError("BILLING_AMOUNT_MISMATCH", 409, "The reported payment does not match the plan price.");
  }
  const newStart = subscription.currentPeriodEnd;
  const newEnd = addCycle(newStart, subscription.billingCycle);
  const fromStatus = subscription.status;
  const result = await db.$transaction(async (tx) => {
    await tx.subscriptionInvoice.upsert({
      where: { subscriptionId_periodStart: { subscriptionId: subscription.id, periodStart: newStart } },
      create: { organisationId, subscriptionId: subscription.id, planId: renewalPlanId, periodStart: newStart, periodEnd: newEnd, amountMinor, currencyCode, status: "PAID", billingProviderKey: params.billingProviderKey, providerInvoiceRef: params.providerInvoiceRef, paidAt: new Date() },
      update: { status: "PAID", amountMinor, currencyCode, providerInvoiceRef: params.providerInvoiceRef, paidAt: new Date(), failureReason: null },
    });
    const updated = await applyTransition(tx, subscription, "ACTIVE", fromStatus === "ACTIVE" ? "Billing period renewed." : "Renewal payment succeeded.", {}, {
      plan: { connect: { id: renewalPlanId } }, selectedPlan: { disconnect: true },
      currentPeriodStart: newStart, currentPeriodEnd: newEnd, pastDueSince: null, gracePeriodEndsAt: null, suspendedAt: null,
    });
    await tx.auditEvent.create({ data: { organisationId, action: "subscription.renewed", entityType: "organisation_subscription", entityId: subscription.id, metadata: json({ periodStart: newStart.toISOString(), fromStatus, planId: renewalPlanId }) } });
    await tx.domainEvent.create({ data: { organisationId, name: "subscription.renewed", aggregateType: "organisation_subscription", aggregateId: subscription.id, payload: json({ periodStart: newStart.toISOString() }) } });
    const notificationId = await notifySubscriptionEvent(tx, organisationId, "SUBSCRIPTION_RENEWED", `${subscription.id}:renewed:${newStart.toISOString().slice(0, 10)}`);
    return { updated, notificationId };
  });
  if (result.notificationId) await enqueueNotificationDelivery({ id: result.notificationId, organisationId });
  return result.updated;
}

/**
 * Applies a failed (or missing) renewal: marks the period's invoice `FAILED` and moves an `ACTIVE`
 * subscription into `PAST_DUE`. Repeated failures while already `PAST_DUE`/`GRACE_PERIOD` update the
 * invoice but never reset the grace clock — `pastDueSince` is set once per dunning cycle. Nothing is
 * granted and nothing is removed until the grace period ends.
 */
export async function recordSubscriptionPaymentFailure(organisationId: string, reason: string, meta: { providerInvoiceRef?: string; billingProviderKey: string }, now: Date = new Date()) {
  const subscription = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId } });
  if (!["ACTIVE", "PAST_DUE", "GRACE_PERIOD"].includes(subscription.status)) return subscription;
  const planId = subscription.selectedPlanId ?? subscription.planId;
  const amountMinor = await planAmountMinor(planId, subscription.currencyCode, subscription.billingCycle);
  const nextStatus: SubscriptionStatus = subscription.status === "PAST_DUE" || subscription.status === "GRACE_PERIOD" ? subscription.status : "PAST_DUE";
  const periodStart = subscription.currentPeriodEnd;
  const result = await db.$transaction(async (tx) => {
    await tx.subscriptionInvoice.upsert({
      where: { subscriptionId_periodStart: { subscriptionId: subscription.id, periodStart } },
      create: { organisationId, subscriptionId: subscription.id, planId, periodStart, periodEnd: addCycle(periodStart, subscription.billingCycle), amountMinor, currencyCode: subscription.currencyCode, status: "FAILED", billingProviderKey: meta.billingProviderKey, providerInvoiceRef: meta.providerInvoiceRef, failureReason: reason },
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
  return notifyAndEnqueue(subscription.organisationId, async (tx) => {
    await applyTransition(tx, subscription, "CANCELLED", reason, actor, { cancelledAt: new Date(), cancelAtPeriodEnd: false });
    return notifySubscriptionEvent(tx, subscription.organisationId, "SUBSCRIPTION_CANCELLED", `${subscription.id}:cancelled`);
  });
}

/** The single trial-ending reminder due now: the smallest configured threshold (7, 3, 1 days)
 * that the remaining time has reached. Each threshold is sent at most once, and a sweep that runs
 * late never sends a burst of the earlier ones. */
export function dueTrialReminder(trialEndsAt: Date, now: Date) {
  const remainingDays = Math.ceil((trialEndsAt.getTime() - now.getTime()) / days(1));
  if (remainingDays <= 0) return null;
  const reached = PM_BILLING_RULES.trialReminderDays.filter((threshold) => remainingDays <= threshold);
  return reached.length ? Math.min(...reached) : null;
}

/**
 * The deterministic, idempotent lifecycle sweep, run by the worker and `/api/jobs/run`:
 * expires stale checkouts, finalizes scheduled cancellations, sends trial reminders (7/3/1 days),
 * ends lapsed trials (never charging anyone), renews paid plans only where the provider holds a
 * recurring authorisation, and escalates unpaid renewals `PAST_DUE` → `GRACE_PERIOD` → `EXPIRED`
 * purely on elapsed time. Running it twice in a row is a no-op the second time.
 */
export async function advanceOverdueSubscriptions(now: Date = new Date()) {
  const summary = { checkoutsExpired: 0, cancelled: 0, trialRemindersSent: 0, trialsExpired: 0, renewed: 0, renewalsDue: 0, paymentFailures: 0, movedToGrace: 0, expired: 0 };

  summary.checkoutsExpired = await expireStaleCheckouts(now);

  const dueForCancellation = await db.organisationSubscription.findMany({ where: { cancelAtPeriodEnd: true, currentPeriodEnd: { lte: now }, status: { notIn: ["CANCELLED"] } } });
  for (const subscription of dueForCancellation) {
    await finalizeCancellation(subscription, "Cancellation took effect at the end of the billing period.");
    summary.cancelled += 1;
  }

  const trialing = await db.organisationSubscription.findMany({ where: { status: "TRIALING", cancelAtPeriodEnd: false, trialEndsAt: { gt: now, lte: new Date(now.getTime() + days(Math.max(...PM_BILLING_RULES.trialReminderDays))) } } });
  for (const subscription of trialing) {
    const threshold = dueTrialReminder(subscription.trialEndsAt!, now);
    if (threshold === null) continue;
    const dedupe = `${subscription.id}:trial_reminder:${threshold}`;
    const sent = await db.notification.findFirst({ where: { organisationId: subscription.organisationId, dedupeReference: dedupe }, select: { id: true } });
    if (sent) continue;
    await notifyAndEnqueue(subscription.organisationId, (tx) => notifySubscriptionEvent(tx, subscription.organisationId, "SUBSCRIPTION_TRIAL_REMINDER", dedupe));
    summary.trialRemindersSent += 1;
  }

  // A trial that ends without a confirmed payment expires. Nobody is charged automatically: there
  // is no stored payment authorisation from a trial. All data is kept.
  const trialsEnded = await db.organisationSubscription.findMany({ where: { status: "TRIALING", trialEndsAt: { lte: now } } });
  for (const subscription of trialsEnded) {
    await notifyAndEnqueue(subscription.organisationId, async (tx) => {
      await applyTransition(tx, subscription, "EXPIRED", "The free trial ended without a paid plan. Data is kept; management features are paused.", {}, { expiredAt: now });
      return notifySubscriptionEvent(tx, subscription.organisationId, "SUBSCRIPTION_EXPIRED", `${subscription.id}:trial_expired`);
    });
    summary.trialsExpired += 1;
  }

  const dueForRenewal = await db.organisationSubscription.findMany({ where: { status: "ACTIVE", cancelAtPeriodEnd: false, currentPeriodEnd: { lte: now } } });
  for (const subscription of dueForRenewal) {
    if (hasRecurringAuthorisation(subscription)) {
      const planId = subscription.selectedPlanId ?? subscription.planId;
      const amountMinor = await planAmountMinor(planId, subscription.currencyCode, subscription.billingCycle);
      const outcome = await chargeCurrentPeriod(subscription.organisationId, amountMinor, subscription.currencyCode).catch((error) => ({ status: "FAILED" as const, providerInvoiceRef: undefined, failureReason: error instanceof Error ? error.message : "The billing provider was unavailable." }));
      if (outcome.status === "PAID" && outcome.providerInvoiceRef) {
        await recordSubscriptionPaymentSuccess(subscription.organisationId, { amountMinor, currencyCode: subscription.currencyCode, providerInvoiceRef: outcome.providerInvoiceRef, billingProviderKey: subscription.billingProviderKey });
        summary.renewed += 1;
      } else {
        await recordSubscriptionPaymentFailure(subscription.organisationId, outcome.failureReason ?? "The renewal charge was declined.", { providerInvoiceRef: outcome.providerInvoiceRef, billingProviderKey: subscription.billingProviderKey }, now);
        summary.paymentFailures += 1;
      }
    } else {
      // No recurring authorisation (e.g. mobile money paid by checkout): the owner renews by
      // paying a checkout. Until then the plan is past due and the grace clock runs.
      await recordSubscriptionPaymentFailure(subscription.organisationId, "Renewal payment is due. Pay to keep your plan.", { billingProviderKey: subscription.billingProviderKey }, now);
      summary.renewalsDue += 1;
    }
  }

  const dueForGrace = await db.organisationSubscription.findMany({ where: { status: "PAST_DUE", pastDueSince: { lte: new Date(now.getTime() - days(PAST_DUE_TO_GRACE_DAYS)) } } });
  for (const subscription of dueForGrace) {
    const gracePeriodEndsAt = new Date(now.getTime() + days(GRACE_PERIOD_DAYS));
    await notifyAndEnqueue(subscription.organisationId, (tx) => applyTransition(tx, subscription, "GRACE_PERIOD", "Payment remained unresolved past the past-due window.", {}, { gracePeriodEndsAt }).then(() => notifySubscriptionEvent(tx, subscription.organisationId, "SUBSCRIPTION_GRACE_PERIOD", `${subscription.id}:grace:${subscription.pastDueSince?.toISOString().slice(0, 10)}`)));
    summary.movedToGrace += 1;
  }

  const dueForExpiry = await db.organisationSubscription.findMany({ where: { status: "GRACE_PERIOD", gracePeriodEndsAt: { lte: now } } });
  for (const subscription of dueForExpiry) {
    await notifyAndEnqueue(subscription.organisationId, (tx) => applyTransition(tx, subscription, "EXPIRED", "Grace period ended without a confirmed payment. Data is kept; management features are paused.", {}, { expiredAt: now }).then(() => notifySubscriptionEvent(tx, subscription.organisationId, "SUBSCRIPTION_EXPIRED", `${subscription.id}:expired:${subscription.gracePeriodEndsAt?.toISOString().slice(0, 10)}`)));
    summary.expired += 1;
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
 * Idempotent, replay-protected SaaS-billing webhook processor. A redelivered webhook is recognised
 * by `(providerKey, eventKey)` and returns the already-recorded outcome rather than re-applying it;
 * the same event key with a different payload is a hard conflict. Signature verification happens
 * in the route handler before the body is parsed — this function only runs for a verified webhook.
 * Checkout events are matched by the checkout reference this server created; a reported amount or
 * currency that differs from what the server priced is recorded as `MISMATCHED` and grants nothing.
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

  if (event.eventType === "CHECKOUT_PAID" || event.eventType === "CHECKOUT_FAILED") {
    const checkout = event.checkoutRef ? await db.subscriptionCheckout.findUnique({ where: { billingProviderKey_providerCheckoutRef: { billingProviderKey: providerKey, providerCheckoutRef: event.checkoutRef } } }) : null;
    if (!checkout) return recordWebhookEvent(providerKey, event, payloadHash, null, "UNMATCHED");
    try {
      if (event.eventType === "CHECKOUT_PAID") {
        const applied = await applyCheckoutPaid(checkout.id, { amountMinor: event.amountMinor, currencyCode: event.currencyCode, providerInvoiceRef: event.providerInvoiceRef });
        if (applied === "MISMATCHED") return recordWebhookEvent(providerKey, event, payloadHash, checkout.organisationId, "MISMATCHED", "Reported amount or currency does not match the checkout.");
      } else {
        await applyCheckoutFailed(checkout.id, event.failureReason ?? "The payment provider reported a failed payment.");
      }
      return recordWebhookEvent(providerKey, event, payloadHash, checkout.organisationId, "PROCESSED");
    } catch (error) {
      await recordWebhookEvent(providerKey, event, payloadHash, checkout.organisationId, "FAILED", error instanceof Error ? error.message : "Unknown failure").catch(() => undefined);
      throw error;
    }
  }

  const subscription = event.subscriptionRef
    ? await db.organisationSubscription.findFirst({ where: { billingProviderKey: providerKey, billingSubscriptionRef: event.subscriptionRef } })
    : null;
  if (!subscription) return recordWebhookEvent(providerKey, event, payloadHash, null, "UNMATCHED");
  try {
    if (event.eventType === "INVOICE_PAID") {
      try {
        await recordSubscriptionPaymentSuccess(subscription.organisationId, { amountMinor: event.amountMinor, currencyCode: event.currencyCode, providerInvoiceRef: event.providerInvoiceRef, billingProviderKey: providerKey });
      } catch (error) {
        if (error instanceof AppError && (error.code === "BILLING_AMOUNT_MISMATCH" || error.code === "BILLING_EVENT_NOT_APPLICABLE")) {
          return recordWebhookEvent(providerKey, event, payloadHash, subscription.organisationId, "MISMATCHED", error.message);
        }
        throw error;
      }
    } else if (event.eventType === "INVOICE_FAILED") {
      await recordSubscriptionPaymentFailure(subscription.organisationId, event.failureReason ?? "The billing provider reported a failed charge.", { providerInvoiceRef: event.providerInvoiceRef, billingProviderKey: providerKey });
    } else if (event.eventType === "SUBSCRIPTION_CANCELLED") {
      await finalizeCancellation(subscription, "Cancelled by billing provider.");
    }
    // SUBSCRIPTION_UPDATED is informational only; no local state change is required.
    return recordWebhookEvent(providerKey, event, payloadHash, subscription.organisationId, "PROCESSED");
  } catch (error) {
    await recordWebhookEvent(providerKey, event, payloadHash, subscription.organisationId, "FAILED", error instanceof Error ? error.message : "Unknown failure").catch(() => undefined);
    throw error;
  }
}

/** Platform-initiated status change (suspension for fraud/abuse, resumption, cancellation),
 * distinct from the billing-driven sweep — same status field, explicit platform-principal
 * attribution. Resuming restores the status the subscription had before it was suspended (a lapsed
 * trial resumes as `EXPIRED`), so a resume can never grant a paid plan nobody paid for. */
export async function platformSetSubscriptionStatus(platformPrincipalId: string, organisationId: string, toStatus: SubscriptionStatus | "RESUME", reason: string) {
  const subscription = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId } });
  if (toStatus === "CANCELLED") {
    await finalizeCancellation(subscription, reason, { platformPrincipalId });
    return db.organisationSubscription.findUniqueOrThrow({ where: { organisationId } });
  }
  let target: SubscriptionStatus = toStatus === "RESUME" ? "ACTIVE" : toStatus;
  if (toStatus === "RESUME") {
    if (subscription.status !== "SUSPENDED") return subscription;
    const suspension = await db.subscriptionStatusHistory.findFirst({ where: { subscriptionId: subscription.id, toStatus: "SUSPENDED" }, orderBy: { createdAt: "desc" } });
    target = suspension?.fromStatus ?? "EXPIRED";
    if (target === "TRIALING" && subscription.trialEndsAt && subscription.trialEndsAt <= new Date()) target = "EXPIRED";
    if (["ACTIVE", "PAST_DUE", "GRACE_PERIOD"].includes(target) && subscription.currentPeriodEnd <= new Date()) target = "PAST_DUE";
  }
  return db.$transaction((tx) => applyTransition(tx, subscription, target, reason, { platformPrincipalId }, target === "SUSPENDED" ? { suspendedAt: new Date() } : target === "PAST_DUE" ? { suspendedAt: null, pastDueSince: subscription.pastDueSince ?? new Date() } : { suspendedAt: null }));
}
