import { z } from "zod";
import { Prisma } from "@/platform/database/generated/client";
import type { SubscriptionStatus } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { enqueueNotificationDelivery } from "@/modules/notifications/service";
import { resolveCheckoutProvider } from "@/modules/billing/service";
import { previewPlanChangeConflicts } from "@/modules/entitlements/service";
import { activatePropertyManagement } from "./activation";
import { notifySubscriptionEvent } from "./notifications";
import { isPmPlanKey, PM_BILLING_RULES } from "./plan-catalog";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const hours = (count: number) => count * 60 * 60 * 1000;

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

/** Only the plan key, cycle and an idempotency key come from the client. Price, currency, plan
 * capacity and the organisation's state are always read on the server. */
export const startCheckoutSchema = z.object({
  planKey: z.string().trim().min(1).max(80),
  billingCycle: z.enum(["MONTHLY"]).optional().default("MONTHLY"),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

async function transition(tx: Tx, subscription: { id: string; organisationId: string; status: SubscriptionStatus }, toStatus: SubscriptionStatus, reason: string, actorUserId: string | null, data: Prisma.OrganisationSubscriptionUpdateInput = {}) {
  const { applyTransition } = await import("./lifecycle");
  return applyTransition(tx, subscription, toStatus, reason, actorUserId ? { userId: actorUserId } : {}, data);
}

function appBaseUrl() {
  return (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Starts a hosted checkout for a property-management plan: a new paid plan, a renewal of the
 * current plan, or an upgrade. Grants nothing by itself — the plan only becomes active when the
 * provider's signed webhook confirms the payment (`applyCheckoutPaid`). A repeated request with
 * the same idempotency key returns the same checkout. Downgrades never go through checkout; they
 * are scheduled for the next renewal (`subscriptions/service.ts`).
 */
export async function startPlanCheckout(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.billingManage);
  const data = startCheckoutSchema.parse(input);
  if (!isPmPlanKey(data.planKey)) throw new AppError("PLAN_NOT_AVAILABLE", 422, "The selected plan is not available.");
  const plan = await db.subscriptionPlan.findUnique({ where: { key: data.planKey } });
  if (!plan || !plan.isActive || !plan.isPublic) throw new AppError("PLAN_NOT_AVAILABLE", 422, "The selected plan is not available.");

  const existingForKey = await db.subscriptionCheckout.findUnique({ where: { organisationId_idempotencyKey: { organisationId, idempotencyKey: data.idempotencyKey } } });
  if (existingForKey) {
    if (existingForKey.planId !== plan.id) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "This request key was already used for a different plan.");
    return { checkout: existingForKey, conflicts: [] };
  }

  if (!(await db.organisationSubscription.findUnique({ where: { organisationId }, select: { id: true } }))) await activatePropertyManagement(organisationId, userId);
  const subscription = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId }, include: { plan: true } });
  if (subscription.status === "SUSPENDED") throw new AppError("SUBSCRIPTION_SUSPENDED", 409, "This organisation is suspended. Contact NesAfric support.");

  const price = await db.planPrice.findFirst({ where: { planId: plan.id, currencyCode: subscription.currencyCode, billingCycle: data.billingCycle, isActive: true } });
  if (!price) throw new AppError("PLAN_PRICE_UNAVAILABLE", 422, `No active price is configured for this plan in ${subscription.currencyCode}.`);

  // Mid-period on an active plan, a lower plan waits for the renewal. Once the renewal is due
  // (past due or in grace), paying for any plan is the renewal itself.
  if (subscription.status === "ACTIVE" && subscription.planId !== plan.id && subscription.currentPeriodEnd > new Date()) {
    const currentPrice = await db.planPrice.findFirst({ where: { planId: subscription.planId, currencyCode: subscription.currencyCode, billingCycle: subscription.billingCycle, isActive: true } });
    if (currentPrice && Number(price.amountMinor) < Number(currentPrice.amountMinor)) {
      throw new AppError("PLAN_DOWNGRADE_SCHEDULED_ONLY", 409, "A lower plan takes effect at your next renewal. Choose it as your next plan instead of paying now.");
    }
  }

  const provider = resolveCheckoutProvider();
  if (!provider) throw new AppError("BILLING_PROVIDER_UNAVAILABLE", 503, "Online payment is not available yet. Contact NesAfric support to activate your plan.");

  const conflicts = await previewPlanChangeConflicts(organisationId, plan.id);
  const now = new Date();
  const checkout = await db.$transaction(async (tx) => {
    const created = await tx.subscriptionCheckout.create({
      data: {
        organisationId, subscriptionId: subscription.id, planId: plan.id, billingCycle: data.billingCycle,
        amountMinor: price.amountMinor, currencyCode: price.currencyCode, billingProviderKey: provider.key,
        idempotencyKey: data.idempotencyKey, createdByUserId: userId, expiresAt: new Date(now.getTime() + hours(PM_BILLING_RULES.checkoutExpiryHours)),
      },
    });
    if (subscription.status === "EXPIRED" || subscription.status === "CANCELLED") {
      await transition(tx, subscription, "PAYMENT_PENDING", "Checkout started; waiting for the payment provider to confirm.", userId);
    }
    if (subscription.status === "TRIALING" && subscription.selectedPlanId !== plan.id) {
      await tx.organisationSubscription.update({ where: { id: subscription.id }, data: { selectedPlanId: plan.id } });
    }
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "subscription.checkout_started", entityType: "subscription_checkout", entityId: created.id, metadata: json({ planKey: plan.key, amountMinor: price.amountMinor.toString(), currencyCode: price.currencyCode, conflicts }) } });
    return created;
  });

  try {
    const organisation = await db.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { name: true } });
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
    const result = await provider.createCheckout({
      internalReference: checkout.id, organisationId, customerName: organisation.name, customerEmail: user?.email ?? undefined,
      planKey: plan.key, billingCycle: data.billingCycle, currencyCode: price.currencyCode, amountMinor: price.amountMinor.toString(),
      returnUrl: `${appBaseUrl()}/settings/billing?checkout=${checkout.id}`,
    });
    const updated = await db.subscriptionCheckout.update({ where: { id: checkout.id }, data: { providerCheckoutRef: result.checkoutRef, checkoutUrl: result.checkoutUrl } });
    return { checkout: updated, conflicts };
  } catch (error) {
    await applyCheckoutFailed(checkout.id, "The payment provider could not open a checkout.").catch(() => undefined);
    if (error instanceof AppError) throw error;
    throw new AppError("BILLING_PROVIDER_UNAVAILABLE", 503, "The payment provider could not open a checkout. Please try again.");
  }
}

/** What the billing page shows after the customer returns from the provider. Never activates. */
export async function getCheckoutStatus(userId: string, organisationId: string, checkoutId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.billingRead);
  const checkout = await db.subscriptionCheckout.findFirst({ where: { id: checkoutId, organisationId }, include: { plan: { select: { key: true, name: true } } } });
  if (!checkout) throw notFound();
  return { id: checkout.id, status: checkout.status, plan: checkout.plan, amountMinor: checkout.amountMinor.toString(), currencyCode: checkout.currencyCode, failureReason: checkout.failureReason, paidAt: checkout.paidAt };
}

/**
 * Applies a provider-confirmed payment. Idempotent (a second confirmation is a no-op) and serialised
 * per checkout. The reported amount and currency must equal what the server priced; otherwise
 * nothing is granted and `MISMATCHED` is returned for the webhook ledger. A payment the provider
 * confirms after the checkout expired on our side is still honoured — the customer did pay.
 */
export async function applyCheckoutPaid(checkoutId: string, reported: { amountMinor?: string; currencyCode?: string; providerInvoiceRef?: string }, now: Date = new Date()): Promise<"APPLIED" | "ALREADY_APPLIED" | "MISMATCHED"> {
  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pm-checkout:${checkoutId}`}))`;
    const checkout = await tx.subscriptionCheckout.findUniqueOrThrow({ where: { id: checkoutId }, include: { plan: true } });
    if (checkout.status === "PAID") return { result: "ALREADY_APPLIED" as const, notificationId: null, organisationId: checkout.organisationId };
    if (reported.amountMinor === undefined || reported.amountMinor !== checkout.amountMinor.toString() || (reported.currencyCode ?? "").toUpperCase() !== checkout.currencyCode) {
      await tx.auditEvent.create({ data: { organisationId: checkout.organisationId, action: "subscription.checkout_mismatch", entityType: "subscription_checkout", entityId: checkout.id, metadata: json({ expected: { amountMinor: checkout.amountMinor.toString(), currencyCode: checkout.currencyCode }, reported }) } });
      return { result: "MISMATCHED" as const, notificationId: null, organisationId: checkout.organisationId };
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pm-subscription:${checkout.subscriptionId}`}))`;
    const subscription = await tx.organisationSubscription.findUniqueOrThrow({ where: { id: checkout.subscriptionId } });

    const renewingSamePlan = subscription.planId === checkout.planId && ["ACTIVE", "PAST_DUE", "GRACE_PERIOD"].includes(subscription.status);
    // A renewal (same plan, or any plan once the renewal is due) continues from the end of the
    // current period; an upgrade, a trial conversion or a reactivation starts now.
    const continuesPeriod = renewingSamePlan || ["PAST_DUE", "GRACE_PERIOD"].includes(subscription.status);
    const periodStart = subscription.status !== "TRIALING" && continuesPeriod ? subscription.currentPeriodEnd : now;
    // Paying during the trial keeps the remaining trial days: the first paid month starts when
    // the trial would have ended.
    const creditFrom = subscription.status === "TRIALING" && subscription.trialEndsAt && subscription.trialEndsAt > now ? subscription.trialEndsAt : periodStart;
    const periodEnd = addMonths(creditFrom, 1);

    await tx.subscriptionCheckout.update({ where: { id: checkout.id }, data: { status: "PAID", paidAt: now, failureReason: null } });
    await tx.subscriptionInvoice.upsert({
      where: { subscriptionId_periodStart: { subscriptionId: subscription.id, periodStart } },
      create: { organisationId: checkout.organisationId, subscriptionId: subscription.id, planId: checkout.planId, periodStart, periodEnd, amountMinor: checkout.amountMinor, currencyCode: checkout.currencyCode, status: "PAID", billingProviderKey: checkout.billingProviderKey, providerInvoiceRef: reported.providerInvoiceRef ?? checkout.providerCheckoutRef, paidAt: now },
      update: { status: "PAID", planId: checkout.planId, periodEnd, amountMinor: checkout.amountMinor, providerInvoiceRef: reported.providerInvoiceRef ?? checkout.providerCheckoutRef, paidAt: now, failureReason: null },
    });
    const fromStatus = subscription.status;
    await transition(tx, subscription, "ACTIVE", renewingSamePlan ? "Renewal payment confirmed by the payment provider." : `Payment confirmed by the payment provider; ${checkout.plan.name} plan active.`, checkout.createdByUserId, {
      plan: { connect: { id: checkout.planId } }, selectedPlan: { disconnect: true }, billingCycle: checkout.billingCycle, billingProviderKey: checkout.billingProviderKey,
      currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, pastDueSince: null, gracePeriodEndsAt: null, suspendedAt: null, expiredAt: null, cancelAtPeriodEnd: false, cancelledAt: null,
    });
    await tx.auditEvent.create({ data: { organisationId: checkout.organisationId, actorUserId: checkout.createdByUserId, action: renewingSamePlan ? "subscription.renewed" : "subscription.activated", entityType: "organisation_subscription", entityId: subscription.id, metadata: json({ fromStatus, planKey: checkout.plan.key, checkoutId: checkout.id, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() }) } });
    await tx.domainEvent.create({ data: { organisationId: checkout.organisationId, name: renewingSamePlan ? "subscription.renewed" : "subscription.activated", aggregateType: "organisation_subscription", aggregateId: subscription.id, payload: json({ planKey: checkout.plan.key }) } });
    const notificationId = await notifySubscriptionEvent(tx, checkout.organisationId, renewingSamePlan ? "SUBSCRIPTION_RENEWED" : "SUBSCRIPTION_ACTIVATED", `${checkout.id}:paid`);
    return { result: "APPLIED" as const, notificationId, organisationId: checkout.organisationId };
  });
  if (outcome.notificationId) await enqueueNotificationDelivery({ id: outcome.notificationId, organisationId: outcome.organisationId });
  return outcome.result;
}

/** Records a failed or abandoned checkout. Grants nothing; the owner can simply start another. */
export async function applyCheckoutFailed(checkoutId: string, reason: string) {
  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pm-checkout:${checkoutId}`}))`;
    const checkout = await tx.subscriptionCheckout.findUniqueOrThrow({ where: { id: checkoutId } });
    if (checkout.status !== "PENDING") return null;
    await tx.subscriptionCheckout.update({ where: { id: checkout.id }, data: { status: "FAILED", failureReason: reason } });
    await revertPaymentPending(tx, checkout.subscriptionId, checkout.id, "Payment was not completed.");
    await tx.auditEvent.create({ data: { organisationId: checkout.organisationId, action: "subscription.checkout_failed", entityType: "subscription_checkout", entityId: checkout.id, metadata: json({ reason }) } });
    const notificationId = await notifySubscriptionEvent(tx, checkout.organisationId, "SUBSCRIPTION_PAYMENT_FAILED", `${checkout.id}:failed`);
    return { notificationId, organisationId: checkout.organisationId };
  });
  if (outcome?.notificationId) await enqueueNotificationDelivery({ id: outcome.notificationId, organisationId: outcome.organisationId });
}

async function revertPaymentPending(tx: Tx, subscriptionId: string, checkoutId: string, reason: string) {
  const subscription = await tx.organisationSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  if (subscription.status !== "PAYMENT_PENDING") return;
  const otherPending = await tx.subscriptionCheckout.count({ where: { subscriptionId, status: "PENDING", id: { not: checkoutId } } });
  if (otherPending) return;
  await transition(tx, subscription, "EXPIRED", reason, null);
}

/** Expires checkouts the provider never confirmed. Part of the lifecycle sweep. */
export async function expireStaleCheckouts(now: Date = new Date()) {
  const stale = await db.subscriptionCheckout.findMany({ where: { status: "PENDING", expiresAt: { lte: now } }, select: { id: true } });
  for (const { id } of stale) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pm-checkout:${id}`}))`;
      const checkout = await tx.subscriptionCheckout.findUniqueOrThrow({ where: { id } });
      if (checkout.status !== "PENDING") return;
      await tx.subscriptionCheckout.update({ where: { id }, data: { status: "EXPIRED", failureReason: "The payment was not confirmed in time." } });
      await revertPaymentPending(tx, checkout.subscriptionId, id, "Checkout expired without a confirmed payment.");
    });
  }
  return stale.length;
}
