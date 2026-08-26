import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { enqueueNotificationDelivery } from "@/modules/notifications/service";
import { getEntitlementSnapshot, previewPlanChangeConflicts } from "@/modules/entitlements/service";
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
  const [entitlements, invoices, availablePlans] = await Promise.all([
    getEntitlementSnapshot(organisationId),
    db.subscriptionInvoice.findMany({ where: { organisationId }, orderBy: { periodStart: "desc" }, take: 24 }),
    db.subscriptionPlan.findMany({ where: { isActive: true, isPublic: true }, include: { prices: { where: { isActive: true } } }, orderBy: { sortOrder: "asc" } }),
  ]);
  return { ...entitlements, invoices, availablePlans };
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

/** Self-service upgrade/downgrade (item 4). Never deletes any existing record: a downgrade that
 * would put the organisation over a new, lower limit is still applied, and the conflicts are
 * returned alongside the result so the caller can surface them (item 2's "report conflicts"). */
export async function changeOrganisationPlan(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.billingManage);
  const data = changePlanSchema.parse(input);
  const subscription = await db.organisationSubscription.findUnique({ where: { organisationId } });
  if (!subscription) throw notFound();
  if (subscription.status === "CANCELLED") throw new AppError("SUBSCRIPTION_CANCELLED", 409, "A cancelled subscription cannot change plans. Reactivate first.");
  const targetPlan = await db.subscriptionPlan.findUnique({ where: { key: data.planKey } });
  if (!targetPlan || !targetPlan.isActive || !targetPlan.isPublic) throw new AppError("PLAN_NOT_AVAILABLE", 422, "The selected plan is not available.");
  const billingCycle = data.billingCycle ?? subscription.billingCycle;
  const price = await db.planPrice.findFirst({ where: { planId: targetPlan.id, currencyCode: subscription.currencyCode, billingCycle, isActive: true } });
  if (!price) throw new AppError("PLAN_PRICE_UNAVAILABLE", 422, `No active price is configured for this plan in ${subscription.currencyCode} (${billingCycle}).`);
  const conflicts = await previewPlanChangeConflicts(organisationId, targetPlan.id);
  if (subscription.planId === targetPlan.id && billingCycle === subscription.billingCycle) return { subscription, conflicts };
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.organisationSubscription.update({ where: { id: subscription.id }, data: { planId: targetPlan.id, billingCycle } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "subscription.plan_changed", entityType: "organisation_subscription", entityId: subscription.id, metadata: json({ fromPlanId: subscription.planId, toPlanId: targetPlan.id, billingCycle, conflicts }) } });
    await tx.domainEvent.create({ data: { organisationId, name: "subscription.plan_changed", aggregateType: "organisation_subscription", aggregateId: subscription.id, payload: json({ planKey: targetPlan.key, billingCycle }) } });
    const notificationId = await notifySubscriptionEvent(tx, organisationId, "SUBSCRIPTION_CHANGED", `${subscription.id}:plan_changed:${Date.now()}`);
    return { updated, notificationId };
  });
  if (result.notificationId) await enqueueNotificationDelivery({ id: result.notificationId, organisationId });
  return { subscription: result.updated, conflicts };
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
