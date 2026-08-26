import { db } from "@/platform/database/client";
import { Prisma } from "@/platform/database/generated/client";
import { AppError, notFound } from "@/platform/errors";
import { getEntitlementDefinition, listEntitlementDefinitions } from "./catalog";
import { getCurrentUsage, getUsageSnapshot, type UsagePeriod } from "./usage";
import { entitlementFeatureDisabled, entitlementLimitReached, organisationReadOnly } from "./errors";

const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Subscription statuses that still allow the organisation to write. `SUSPENDED`/`CANCELLED` are
 * the only "expired read-only" states (item 4) — every other status (including `PAST_DUE` and
 * `GRACE_PERIOD`) keeps full functionality so a billing hiccup never silently locks a landlord
 * out of their own data before the grace window has actually run out. */
const WRITABLE_STATUSES = new Set(["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"]);
const APPROACHING_RATIO = 0.8;

export type EffectiveEntitlement = {
  featureKey: string;
  kind: "BOOLEAN" | "LIMIT";
  booleanValue: boolean | null;
  limitValue: number | null;
  isUnlimited: boolean;
  source: "override" | "plan" | "default";
};

async function getSubscription(organisationId: string) {
  const subscription = await db.organisationSubscription.findUnique({
    where: { organisationId },
    include: { plan: { include: { entitlements: true } } },
  });
  if (!subscription) throw notFound();
  return subscription;
}

function billingPeriod(subscription: { currentPeriodStart: Date; currentPeriodEnd: Date }): UsagePeriod {
  return { start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd };
}

async function activeOverride(organisationId: string, featureKey: string) {
  const now = new Date();
  return db.organisationEntitlementOverride.findFirst({
    where: { organisationId, featureKey, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Resolves the entitlement actually in force for one feature key (item 2): an active
 * organisation-specific override always wins over the plan; the plan entitlement is used
 * otherwise; a feature the plan never configured falls back to the safest default (disabled /
 * zero) rather than silently behaving as unlimited.
 */
export async function resolveEntitlement(organisationId: string, featureKey: string): Promise<EffectiveEntitlement> {
  const definition = getEntitlementDefinition(featureKey);
  if (!definition) throw new AppError("ENTITLEMENT_UNKNOWN_FEATURE", 500, `'${featureKey}' is not a recognised entitlement feature.`);
  const override = await activeOverride(organisationId, featureKey);
  if (override) {
    return { featureKey, kind: definition.kind, booleanValue: override.booleanValue, limitValue: override.limitValue === null ? null : Number(override.limitValue), isUnlimited: override.isUnlimited, source: "override" };
  }
  const subscription = await getSubscription(organisationId);
  const planEntitlement = subscription.plan.entitlements.find((entry) => entry.featureKey === featureKey);
  if (planEntitlement) {
    return { featureKey, kind: definition.kind, booleanValue: planEntitlement.booleanValue, limitValue: planEntitlement.limitValue === null ? null : Number(planEntitlement.limitValue), isUnlimited: planEntitlement.isUnlimited, source: "plan" };
  }
  return { featureKey, kind: definition.kind, booleanValue: false, limitValue: 0, isUnlimited: false, source: "default" };
}

/** Whether any active, public plan offers a strictly better entitlement for this feature than
 * the organisation's current plan — i.e. whether upgrading would actually resolve the limit. */
async function upgradeWouldHelp(currentPlanId: string, featureKey: string, effective: EffectiveEntitlement) {
  if (effective.isUnlimited) return false;
  const candidates = await db.planEntitlement.findMany({
    where: { featureKey, plan: { isActive: true, isPublic: true, id: { not: currentPlanId } } },
  });
  return candidates.some((candidate) => {
    if (candidate.isUnlimited) return true;
    if (effective.kind === "BOOLEAN") return candidate.booleanValue === true && effective.booleanValue !== true;
    return candidate.limitValue !== null && effective.limitValue !== null && Number(candidate.limitValue) > effective.limitValue;
  });
}

async function notifyUsageThreshold(organisationId: string, subscriptionId: string, featureKey: string, current: number, limit: number, periodStart: Date) {
  const ratio = limit > 0 ? current / limit : 1;
  const eventType = current >= limit ? "ENTITLEMENT_LIMIT_REACHED" : ratio >= APPROACHING_RATIO ? "ENTITLEMENT_LIMIT_APPROACHING" : null;
  if (!eventType) return;
  const dedupeReference = `${subscriptionId}:${featureKey}:${eventType}:${periodStart.toISOString().slice(0, 10)}`;
  try {
    await db.$transaction(async (tx) => {
      const existing = await tx.notification.findFirst({ where: { organisationId, eventType, dedupeReference, channel: "IN_APP" }, select: { id: true } });
      if (existing) return;
      await tx.notification.create({ data: { organisationId, eventType, dedupeReference, channel: "IN_APP", scheduledAt: new Date() } });
      await tx.domainEvent.create({ data: { organisationId, name: eventType === "ENTITLEMENT_LIMIT_REACHED" ? "entitlement.limit_reached" : "entitlement.limit_approaching", aggregateType: "organisation_subscription", aggregateId: subscriptionId, payload: json({ featureKey, current, limit }) } });
    });
  } catch (error) {
    // Usage-threshold notifications are informational only; a failure here must never block the
    // underlying feature usage that triggered the check.
    console.error("Failed to record entitlement usage-threshold notification", error);
  }
}

/**
 * Enforces a numeric (`LIMIT`) entitlement (item 2 + item 7). `increment` is how many additional
 * units of the resource this operation is about to create (e.g. a property plus its initial
 * units). Never deletes or blocks access to existing records — it only ever blocks *creating
 * more* once usage would meet or exceed the limit. Fires an approaching/reached notification as a
 * side effect once the threshold is crossed, but never throws because of that side effect.
 */
export async function assertWithinLimit(organisationId: string, featureKey: string, increment = 1) {
  const subscription = await getSubscription(organisationId);
  const effective = await resolveEntitlement(organisationId, featureKey);
  if (effective.isUnlimited) return { current: null, limit: null, isUnlimited: true };
  const limit = effective.limitValue ?? 0;
  const current = (await getCurrentUsage(organisationId, featureKey, billingPeriod(subscription))) ?? 0;
  if (current + increment > limit) {
    const upgradeReady = await upgradeWouldHelp(subscription.planId, featureKey, effective);
    throw entitlementLimitReached(featureKey, getEntitlementDefinition(featureKey)?.label ?? featureKey, current, limit, upgradeReady);
  }
  await notifyUsageThreshold(organisationId, subscription.id, featureKey, current + increment, limit, subscription.currentPeriodStart);
  return { current, limit, isUnlimited: false };
}

/** Enforces a boolean feature entitlement (item 2 + item 7). */
export async function assertFeatureEnabled(organisationId: string, featureKey: string) {
  const effective = await resolveEntitlement(organisationId, featureKey);
  if (effective.booleanValue === true) return;
  const subscription = await getSubscription(organisationId);
  const upgradeReady = await upgradeWouldHelp(subscription.planId, featureKey, effective);
  throw entitlementFeatureDisabled(featureKey, getEntitlementDefinition(featureKey)?.label ?? featureKey, upgradeReady);
}

/** The subscription-status write gate (item 4's "expired read-only"). Read access is never
 * affected — only mutation entry points call this. */
export async function assertWritableOrganisation(organisationId: string) {
  const subscription = await getSubscription(organisationId);
  if (!WRITABLE_STATUSES.has(subscription.status)) throw organisationReadOnly(subscription.status);
  return subscription;
}

/** Combines the write gate with a limit/feature check in one call — the shape every
 * representative integration point in this codebase actually calls. */
export async function assertOperational(organisationId: string, featureKey: string, increment = 1) {
  await assertWritableOrganisation(organisationId);
  const definition = getEntitlementDefinition(featureKey);
  if (definition?.kind === "BOOLEAN") {
    await assertFeatureEnabled(organisationId, featureKey);
    return null;
  }
  return assertWithinLimit(organisationId, featureKey, increment);
}

/** Full entitlement + usage snapshot for the organisation billing settings UI and the
 * platform-admin organisation detail view (item 7 + item 8's "safe aggregate projections"). */
export async function getEntitlementSnapshot(organisationId: string) {
  const subscription = await getSubscription(organisationId);
  const usage = await getUsageSnapshot(organisationId, billingPeriod(subscription));
  const features = await Promise.all(listEntitlementDefinitions().map(async (definition) => {
    const effective = await resolveEntitlement(organisationId, definition.key);
    const current = definition.kind === "LIMIT" ? usage[definition.key] ?? 0 : null;
    const limit = effective.kind === "LIMIT" ? effective.limitValue : null;
    const approaching = effective.kind === "LIMIT" && !effective.isUnlimited && limit !== null && limit > 0 && current !== null ? current / limit >= APPROACHING_RATIO && current < limit : false;
    const reached = effective.kind === "LIMIT" && !effective.isUnlimited && limit !== null && current !== null ? current >= limit : false;
    return {
      featureKey: definition.key,
      label: definition.label,
      description: definition.description,
      unit: definition.unit ?? null,
      kind: definition.kind,
      booleanValue: effective.booleanValue,
      limit,
      isUnlimited: effective.isUnlimited,
      current,
      approaching,
      reached,
      source: effective.source,
    };
  }));
  return {
    subscriptionId: subscription.id,
    status: subscription.status,
    planKey: subscription.plan.key,
    planName: subscription.plan.name,
    billingCycle: subscription.billingCycle,
    currencyCode: subscription.currencyCode,
    trialEndsAt: subscription.trialEndsAt,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    features,
  };
}

/**
 * Computes which features/limits would be violated by switching to `targetPlanId` *right now*,
 * without changing anything (item 2's "report conflicts/read-only state" for downgrades). Existing
 * records are never deleted because of a conflict — a conflict only means further creation of
 * that resource would be blocked until usage drops or the organisation upgrades again.
 */
export async function previewPlanChangeConflicts(organisationId: string, targetPlanId: string) {
  const subscription = await getSubscription(organisationId);
  const targetPlan = await db.subscriptionPlan.findUnique({ where: { id: targetPlanId }, include: { entitlements: true } });
  if (!targetPlan) throw notFound();
  const period = billingPeriod(subscription);
  const conflicts: Array<{ featureKey: string; label: string; current: number; newLimit: number }> = [];
  for (const definition of listEntitlementDefinitions()) {
    if (definition.kind !== "LIMIT") continue;
    const targetEntitlement = targetPlan.entitlements.find((entry) => entry.featureKey === definition.key);
    if (!targetEntitlement || targetEntitlement.isUnlimited) continue;
    const override = await activeOverride(organisationId, definition.key);
    if (override) continue; // an active override already supersedes whatever the plan says.
    const current = (await getCurrentUsage(organisationId, definition.key, period)) ?? 0;
    const newLimit = Number(targetEntitlement.limitValue ?? 0);
    if (current > newLimit) conflicts.push({ featureKey: definition.key, label: definition.label, current, newLimit });
  }
  return conflicts;
}
