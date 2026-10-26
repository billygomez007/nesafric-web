import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { enqueueNotificationDelivery } from "@/modules/notifications/service";
import { getEntitlementSnapshot, getUnitUsage, previewPlanChangeConflicts } from "@/modules/entitlements/service";
import { resolveCheckoutProvider } from "@/modules/billing/service";
import { activatePropertyManagement } from "./activation";
import { getPublicPlanSummaries } from "./plans";
import { PM_BILLING_RULES } from "./plan-catalog";
import { notifySubscriptionEvent } from "./notifications";
import { changePlanSchema, cancelSubscriptionSchema } from "./schemas";

const json = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * Organisation-facing subscription/billing operations (item 1 + item 7) — the read/write surface
 * behind `/settings/billing`. Self-service plan changes and cancellation are only ever performed
 * against active, public plans; forcing an organisation onto a non-public/inactive plan or a
 * hard suspension is a platform-admin-only action (`src/modules/platform-admin/service.ts`).
 */

export async function getOrganisationBillingSnapshot(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.billingRead);
  const [entitlements, invoices, availablePlans, plans, units, pendingCheckout, trialGrant] = await Promise.all([
    getEntitlementSnapshot(organisationId),
    db.subscriptionInvoice.findMany({ where: { organisationId }, orderBy: { periodStart: "desc" }, take: 24 }),
    db.subscriptionPlan.findMany({ where: { isActive: true, isPublic: true }, include: { prices: { where: { isActive: true } } }, orderBy: { sortOrder: "asc" } }),
    getPublicPlanSummaries(),
    getUnitUsage(organisationId),
    db.subscriptionCheckout.findFirst({ where: { organisationId, status: "PENDING" }, orderBy: { createdAt: "desc" }, select: { id: true, checkoutUrl: true, expiresAt: true, plan: { select: { key: true, name: true } } } }),
    db.managementTrialGrant.findUnique({ where: { organisationId }, select: { startedAt: true, endsAt: true } }),
  ]);
  const selectedPlan = entitlements.selectedPlanId ? await db.subscriptionPlan.findUnique({ where: { id: entitlements.selectedPlanId }, select: { key: true, name: true } }) : null;
  return { ...entitlements, invoices, availablePlans, plans, units, pendingCheckout, trialGrant, selectedPlan, billingRules: PM_BILLING_RULES, paymentsAvailable: resolveCheckoutProvider() !== null };
}

/** The explicit "Start free trial" action in the property-management dashboard. Idempotent. */
export async function startPropertyManagement(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.billingManage);
  return activatePropertyManagement(organisationId, userId);
}

export async function listOrganisationInvoices(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.billingRead);
  return db.subscriptionInvoice.findMany({ where: { organisationId }, orderBy: { periodStart: "desc" } });
}

export async function previewOrganisationPlanChange(userId: string, organisationId: string, planKey: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.billingRead);
  const plan = await db.subscriptionPlan.findUnique({ where: { key: planKey } });
  if (!plan || !plan.isActive || !plan.isPublic) throw new AppError("PLAN_NOT_AVAILABLE", 422, "The selected plan is not available.");
  return previewPlanChangeConflicts(organisationId, plan.id);
}

/**
 * Self-service plan choice. Never deletes any record and never grants a paid plan by itself:
 *  - during the trial, or while expired/cancelled, it records the plan the owner wants to pay for
 *    (`selectedPlanId`); the plan starts when a checkout payment is confirmed;
 *  - on a paid plan, a lower plan is scheduled for the next renewal, and a higher plan requires a
 *    checkout (`PLAN_UPGRADE_REQUIRES_PAYMENT`) — upgrades start when the payment is confirmed.
 * Usage above the chosen plan's limits is returned as `conflicts`: existing data stays, and only
 * creating more (e.g. new units) is blocked until usage is within the limit.
 */
export async function changeOrganisationPlan(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.billingManage);
  const data = changePlanSchema.parse(input);
  const subscription = await db.organisationSubscription.findUnique({ where: { organisationId } });
  if (!subscription) throw new AppError("PM_NOT_ACTIVATED", 409, "Start property management first; your free trial starts then.");
  if (subscription.status === "SUSPENDED") throw new AppError("SUBSCRIPTION_SUSPENDED", 409, "This organisation is suspended. Contact NesAfric support.");
  const targetPlan = await db.subscriptionPlan.findUnique({ where: { key: data.planKey } });
  if (!targetPlan || !targetPlan.isActive || !targetPlan.isPublic) throw new AppError("PLAN_NOT_AVAILABLE", 422, "The selected plan is not available.");
  const billingCycle = data.billingCycle ?? subscription.billingCycle;
  const price = await db.planPrice.findFirst({ where: { planId: targetPlan.id, currencyCode: subscription.currencyCode, billingCycle, isActive: true } });
  if (!price) throw new AppError("PLAN_PRICE_UNAVAILABLE", 422, `No active price is configured for this plan in ${subscription.currencyCode} (${billingCycle}).`);
  const conflicts = await previewPlanChangeConflicts(organisationId, targetPlan.id);

  const onPaidPlan = ["ACTIVE", "PAST_DUE", "GRACE_PERIOD"].includes(subscription.status);
  let effect: "SELECTED" | "SCHEDULED" | "UNCHANGED" = "SELECTED";
  if (onPaidPlan) {
    if (subscription.planId === targetPlan.id) {
      effect = "UNCHANGED";
    } else {
      const currentPrice = await db.planPrice.findFirst({ where: { planId: subscription.planId, currencyCode: subscription.currencyCode, billingCycle: subscription.billingCycle, isActive: true } });
      if (!currentPrice || Number(price.amountMinor) > Number(currentPrice.amountMinor)) {
        throw new AppError("PLAN_UPGRADE_REQUIRES_PAYMENT", 409, `${targetPlan.name} starts as soon as its payment is confirmed. Continue to payment to upgrade.`, { planKey: targetPlan.key });
      }
      effect = "SCHEDULED";
    }
  }
  if (effect === "UNCHANGED" && !subscription.selectedPlanId) return { subscription, conflicts, effect };

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.organisationSubscription.update({ where: { id: subscription.id }, data: { selectedPlanId: effect === "UNCHANGED" ? null : targetPlan.id } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: effect === "SCHEDULED" ? "subscription.downgrade_scheduled" : "subscription.plan_selected", entityType: "organisation_subscription", entityId: subscription.id, metadata: json({ fromPlanId: subscription.planId, selectedPlanId: targetPlan.id, effect, conflicts }) } });
    await tx.domainEvent.create({ data: { organisationId, name: "subscription.plan_selected", aggregateType: "organisation_subscription", aggregateId: subscription.id, payload: json({ planKey: targetPlan.key, effect }) } });
    const notificationId = await notifySubscriptionEvent(tx, organisationId, effect === "SCHEDULED" ? "SUBSCRIPTION_CHANGED" : "SUBSCRIPTION_PLAN_SELECTED", `${subscription.id}:plan_selected:${targetPlan.key}:${new Date().toISOString().slice(0, 10)}`);
    return { updated, notificationId };
  });
  if (result.notificationId) await enqueueNotificationDelivery({ id: result.notificationId, organisationId });
  return { subscription: result.updated, conflicts, effect };
}

/** Self-service cancellation (item 4): defaults to taking effect at the end of the current
 * billing period (data and access remain fully intact until then); `immediate: true` cancels
 * right away. Either way, no domain record is ever deleted as a result. */
export async function cancelOrganisationSubscription(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.billingManage);
  const data = cancelSubscriptionSchema.parse(input);
  const subscription = await db.organisationSubscription.findUnique({ where: { organisationId } });
  if (!subscription) throw notFound();
  if (subscription.status === "CANCELLED") return subscription;
  const now = new Date();
  const reason = data.reason ?? (data.immediate ? "Cancelled immediately by the organisation." : "Cancellation scheduled for the end of the billing period.");
  return db.$transaction(async (tx) => {
    const updated = await tx.organisationSubscription.update({
      where: { id: subscription.id },
      data: data.immediate ? { status: "CANCELLED", cancelledAt: now, cancelAtPeriodEnd: false } : { cancelAtPeriodEnd: true },
    });
    if (data.immediate) {
      await tx.subscriptionStatusHistory.create({ data: { subscriptionId: subscription.id, organisationId, fromStatus: subscription.status, toStatus: "CANCELLED", reason, actorUserId: userId } });
    }
    await notifySubscriptionEvent(tx, organisationId, "SUBSCRIPTION_CANCELLED", `${subscription.id}:${data.immediate ? "cancelled" : "cancel_scheduled"}:${now.toISOString().slice(0, 10)}`);
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: data.immediate ? "subscription.cancelled" : "subscription.cancel_scheduled", entityType: "organisation_subscription", entityId: subscription.id, metadata: json({ reason, immediate: data.immediate }) } });
    await tx.domainEvent.create({ data: { organisationId, name: data.immediate ? "subscription.cancelled" : "subscription.cancel_scheduled", aggregateType: "organisation_subscription", aggregateId: subscription.id, payload: json({ immediate: data.immediate }) } });
    return updated;
  });
}

/** Undoes a scheduled (not-yet-effective) cancellation. */
export async function reactivateScheduledCancellation(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.billingManage);
  const subscription = await db.organisationSubscription.findUnique({ where: { organisationId } });
  if (!subscription) throw notFound();
  if (!subscription.cancelAtPeriodEnd) return subscription;
  return db.$transaction(async (tx) => {
    const updated = await tx.organisationSubscription.update({ where: { id: subscription.id }, data: { cancelAtPeriodEnd: false } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "subscription.cancel_reversed", entityType: "organisation_subscription", entityId: subscription.id } });
    await tx.domainEvent.create({ data: { organisationId, name: "subscription.cancel_reversed", aggregateType: "organisation_subscription", aggregateId: subscription.id, payload: {} } });
    return updated;
  });
}

/** The organisation-visible list of platform support access to their data (item 9's "visible session"). */
export async function listVisibleSupportSessions(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.billingRead);
  return db.platformSupportSession.findMany({
    where: { organisationId },
    select: { id: true, reason: true, startedAt: true, expiresAt: true, endedAt: true, revokedAt: true },
    orderBy: { startedAt: "desc" },
  });
}
