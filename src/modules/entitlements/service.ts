import { db } from "@/platform/database/client";
import { Prisma } from "@/platform/database/generated/client";
import { AppError, notFound } from "@/platform/errors";
import { ENTITLEMENTS, getEntitlementDefinition, listEntitlementDefinitions } from "./catalog";
import { getCurrentUsage, getUsageSnapshot, type UsagePeriod } from "./usage";
import { entitlementFeatureDisabled, entitlementLimitReached, managementSubscriptionRequired } from "./errors";

const json = (value: unknown) => value as Prisma.InputJsonValue;
type Tx = Prisma.TransactionClient;

/**
 * Statuses in which the organisation's plan entitlements are in force. `PAST_DUE` and
 * `GRACE_PERIOD` keep working so a billing hiccup never locks a landlord out before the grace
 * window has run out. `EXPIRED`, `PAYMENT_PENDING`, `SUSPENDED` and `CANCELLED` grant no paid
 * management entitlement, but never block reading data, billing, support, settings, export or the
 * marketplace.
 */
const ENTITLED_STATUSES = new Set(["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"]);
const APPROACHING_RATIO = 0.8;

/**
 * Allowances that marketplace activity shares with property management. An organisation without
 * an active management plan (agents, sellers, lapsed landlords) keeps this free baseline, so the
 * marketplace is never blocked by property-management billing. Every other feature is off.
 */
const MARKETPLACE_BASELINE: Record<string, number> = {
  [ENTITLEMENTS.listingsMax.key]: 1_000,
  [ENTITLEMENTS.messagesMonthlyMax.key]: 200,
  [ENTITLEMENTS.storageBytesMax.key]: 1024 * 1024 * 1024,
  [ENTITLEMENTS.documentsMonthlyMax.key]: 20,
  [ENTITLEMENTS.teamMembersMax.key]: 5,
};

type SubscriptionWithPlan = Prisma.OrganisationSubscriptionGetPayload<{ include: { plan: { include: { entitlements: true } } } }>;

export type EffectiveEntitlement = {
  featureKey: string;
  kind: "BOOLEAN" | "LIMIT";
  booleanValue: boolean | null;
  limitValue: number | null;
  isUnlimited: boolean;
  source: "override" | "plan" | "default" | "marketplace";
};

async function findSubscription(organisationId: string, client: Tx | typeof db = db): Promise<SubscriptionWithPlan | null> {
  return client.organisationSubscription.findUnique({
    where: { organisationId },
    include: { plan: { include: { entitlements: true } } },
  });
}

/** Whether plan entitlements are in force right now. A trial whose end date has passed is treated
 * as over even before the lifecycle sweep moves it to `EXPIRED`. */
export function isEntitledStatus(subscription: { status: string; trialEndsAt: Date | null } | null, now: Date = new Date()) {
  if (!subscription || !ENTITLED_STATUSES.has(subscription.status)) return false;
  if (subscription.status === "TRIALING" && subscription.trialEndsAt && subscription.trialEndsAt <= now) return false;
  return true;
}

/** The current calendar month, used for flow metrics when there is no billing period. */
function calendarMonth(now = new Date()): UsagePeriod {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
}

function billingPeriod(subscription: { currentPeriodStart: Date; currentPeriodEnd: Date } | null): UsagePeriod {
  if (!subscription || subscription.currentPeriodEnd <= subscription.currentPeriodStart) return calendarMonth();
  return { start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd };
}

/** The organisation's property-management standing, for gates, UI and WhatsApp copy. */
export async function getManagementState(organisationId: string) {
  const subscription = await findSubscription(organisationId);
  return { subscription, activated: Boolean(subscription), entitled: isEntitledStatus(subscription), status: subscription?.status ?? "NOT_ACTIVATED" };
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
  const subscription = await findSubscription(organisationId);
  if (!isEntitledStatus(subscription)) {
    const baseline = MARKETPLACE_BASELINE[featureKey];
    if (baseline !== undefined) return { featureKey, kind: definition.kind, booleanValue: null, limitValue: baseline, isUnlimited: false, source: "marketplace" };
    return { featureKey, kind: definition.kind, booleanValue: false, limitValue: 0, isUnlimited: false, source: "default" };
  }
  const override = await activeOverride(organisationId, featureKey);
  if (override) {
    return { featureKey, kind: definition.kind, booleanValue: override.booleanValue, limitValue: override.limitValue === null ? null : Number(override.limitValue), isUnlimited: override.isUnlimited, source: "override" };
  }
  const planEntitlement = subscription!.plan.entitlements.find((entry) => entry.featureKey === featureKey);
  if (planEntitlement) {
    return { featureKey, kind: definition.kind, booleanValue: planEntitlement.booleanValue, limitValue: planEntitlement.limitValue === null ? null : Number(planEntitlement.limitValue), isUnlimited: planEntitlement.isUnlimited, source: "plan" };
  }
  return { featureKey, kind: definition.kind, booleanValue: false, limitValue: 0, isUnlimited: false, source: "default" };
}

/** Whether any active, public plan offers a strictly better entitlement for this feature than
 * the organisation's current plan — i.e. whether upgrading would actually resolve the limit. */
async function upgradeWouldHelp(currentPlanId: string | null, featureKey: string, effective: EffectiveEntitlement) {
  if (effective.isUnlimited) return false;
  const candidates = await db.planEntitlement.findMany({
    where: { featureKey, plan: { isActive: true, isPublic: true, ...(currentPlanId ? { id: { not: currentPlanId } } : {}) } },
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
 * Enforces a numeric (`LIMIT`) entitlement. `increment` is how many additional units of the
 * resource this operation is about to create. Never deletes or blocks access to existing records —
 * it only ever blocks *creating more* once usage would exceed the limit. Fires an approaching/
 * reached notification as a side effect, but never throws because of that side effect.
 */
export async function assertWithinLimit(organisationId: string, featureKey: string, increment = 1) {
  const subscription = await findSubscription(organisationId);
  const effective = await resolveEntitlement(organisationId, featureKey);
  if (effective.isUnlimited) return { current: null, limit: null, isUnlimited: true };
  const limit = effective.limitValue ?? 0;
  const current = (await getCurrentUsage(organisationId, featureKey, billingPeriod(subscription))) ?? 0;
  if (current + increment > limit) {
    // Tell the owner (once per period) that the allowance is used up, with the upgrade path.
    if (subscription && isEntitledStatus(subscription) && limit > 0) await notifyUsageThreshold(organisationId, subscription.id, featureKey, Math.max(current, limit), limit, subscription.currentPeriodStart);
    const upgradeReady = await upgradeWouldHelp(subscription?.planId ?? null, featureKey, effective);
    throw entitlementLimitReached(featureKey, getEntitlementDefinition(featureKey)?.label ?? featureKey, current, limit, upgradeReady);
  }
  if (subscription && isEntitledStatus(subscription)) await notifyUsageThreshold(organisationId, subscription.id, featureKey, current + increment, limit, subscription.currentPeriodStart);
  return { current, limit, isUnlimited: false };
}

/** Enforces a boolean feature entitlement. */
export async function assertFeatureEnabled(organisationId: string, featureKey: string) {
  const effective = await resolveEntitlement(organisationId, featureKey);
  if (effective.booleanValue === true) return;
  const subscription = await findSubscription(organisationId);
  if (!isEntitledStatus(subscription)) throw managementSubscriptionRequired(subscription?.status ?? "NOT_ACTIVATED", featureKey);
  const upgradeReady = await upgradeWouldHelp(subscription!.planId, featureKey, effective);
  throw entitlementFeatureDisabled(featureKey, getEntitlementDefinition(featureKey)?.label ?? featureKey, upgradeReady);
}

/**
 * The property-management gate. Activates property management on first use (which starts the
 * one free trial, or records that a paid plan is required) unless `activate` is false, then
 * requires the plan to be in force. Read access, billing, support, settings, export and the
 * marketplace never go through this gate.
 */
export async function assertManagementAccess(organisationId: string, actorUserId: string | null, options: { activate?: boolean } = {}) {
  let subscription: { status: string; trialEndsAt: Date | null } | null = await findSubscription(organisationId);
  if (!subscription && options.activate !== false) {
    const { activatePropertyManagement } = await import("@/modules/subscriptions/activation");
    subscription = await activatePropertyManagement(organisationId, actorUserId);
  }
  if (!isEntitledStatus(subscription)) throw managementSubscriptionRequired(subscription?.status ?? "NOT_ACTIVATED");
  return subscription!;
}

/** Kept for existing callers: the management gate without activation. */
export async function assertWritableOrganisation(organisationId: string) {
  return assertManagementAccess(organisationId, null, { activate: false });
}

/**
 * Combines the management gate with a limit/feature check. Allowances in the marketplace baseline
 * (messages, storage, documents, listings) are checked against that baseline for organisations
 * without an active plan instead of being refused, so marketplace activity is never blocked.
 */
export async function assertOperational(organisationId: string, featureKey: string, increment = 1) {
  if (MARKETPLACE_BASELINE[featureKey] === undefined) await assertWritableOrganisation(organisationId);
  const definition = getEntitlementDefinition(featureKey);
  if (definition?.kind === "BOOLEAN") {
    await assertFeatureEnabled(organisationId, featureKey);
    return null;
  }
  return assertWithinLimit(organisationId, featureKey, increment);
}

/** Non-throwing check for background jobs and WhatsApp handlers that need a fallback path. */
export async function hasFeature(organisationId: string, featureKey: string) {
  const effective = await resolveEntitlement(organisationId, featureKey);
  return effective.kind === "BOOLEAN" ? effective.booleanValue === true : effective.isUnlimited || (effective.limitValue ?? 0) > 0;
}

/** Non-throwing allowance check: true while `increment` more still fits the allowance. */
export async function hasAllowance(organisationId: string, featureKey: string, increment = 1) {
  try {
    await assertWithinLimit(organisationId, featureKey, increment);
    return true;
  } catch (error) {
    if (error instanceof AppError && (error.code === "ENTITLEMENT_LIMIT_REACHED")) return false;
    throw error;
  }
}

/**
 * Runs `create` inside one transaction that holds a per-organisation advisory lock while it counts
 * managed units and creates `increment` more, so two concurrent requests can never both pass the
 * check and push the organisation over its plan's unit capacity. Activates property management
 * (the trial) on the organisation's first unit. The unit count is recomputed inside the lock from
 * the database, never taken from the request.
 */
export async function withUnitCapacity<T>(organisationId: string, actorUserId: string | null, increment: number, create: (tx: Tx) => Promise<T>): Promise<T> {
  if (increment <= 0) return db.$transaction((tx) => create(tx));
  await assertManagementAccess(organisationId, actorUserId);
  const effective = await resolveEntitlement(organisationId, ENTITLEMENTS.unitsMax.key);
  const subscription = await findSubscription(organisationId);
  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pm-units:${organisationId}`}))`;
    const current = await tx.unit.count({ where: { archivedAt: null, property: { organisationId, archivedAt: null } } });
    const limit = effective.isUnlimited ? Number.POSITIVE_INFINITY : effective.limitValue ?? 0;
    if (current + increment > limit) return { blocked: true as const, current, limit };
    return { blocked: false as const, value: await create(tx), current, limit };
  });
  if (outcome.blocked) {
    const upgradeReady = await upgradeWouldHelp(subscription?.planId ?? null, ENTITLEMENTS.unitsMax.key, effective);
    if (subscription) await notifyUnitLimit(organisationId, subscription.id, outcome.current, outcome.limit);
    throw entitlementLimitReached(ENTITLEMENTS.unitsMax.key, ENTITLEMENTS.unitsMax.label, outcome.current, outcome.limit, upgradeReady);
  }
  if (subscription && Number.isFinite(outcome.limit)) await notifyUsageThreshold(organisationId, subscription.id, ENTITLEMENTS.unitsMax.key, outcome.current + increment, outcome.limit, subscription.currentPeriodStart);
  return outcome.value;
}

async function notifyUnitLimit(organisationId: string, subscriptionId: string, current: number, limit: number) {
  const { notifySubscriptionEvent } = await import("@/modules/subscriptions/notifications");
  const { enqueueNotificationDelivery } = await import("@/modules/notifications/service");
  try {
    const notificationId = await db.$transaction((tx) => notifySubscriptionEvent(tx, organisationId, "SUBSCRIPTION_UNIT_LIMIT_REACHED", `${subscriptionId}:unit_limit:${limit}:${new Date().toISOString().slice(0, 10)}`));
    await enqueueNotificationDelivery({ id: notificationId, organisationId });
    await db.auditEvent.create({ data: { organisationId, action: "subscription.unit_limit_blocked", entityType: "organisation_subscription", entityId: subscriptionId, metadata: json({ current, limit }) } });
  } catch (error) {
    console.error("Failed to record unit-limit notification", error);
  }
}

/** Managed-unit usage for the "18 of 25 units used" display. */
export async function getUnitUsage(organisationId: string) {
  const [current, effective] = await Promise.all([
    db.unit.count({ where: { archivedAt: null, property: { organisationId, archivedAt: null } } }),
    resolveEntitlement(organisationId, ENTITLEMENTS.unitsMax.key),
  ]);
  return { current, limit: effective.isUnlimited ? null : effective.limitValue ?? 0 };
}

/** Full entitlement + usage snapshot for the billing page and the platform-admin organisation
 * view. Organisations that have not activated property management get a snapshot with no plan. */
export async function getEntitlementSnapshot(organisationId: string) {
  const subscription = await findSubscription(organisationId);
  const usage = await getUsageSnapshot(organisationId, billingPeriod(subscription));
  const features = await Promise.all(listEntitlementDefinitions().map(async (definition) => {
    const effective = await resolveEntitlement(organisationId, definition.key);
    const current = definition.kind === "LIMIT" ? usage[definition.key] ?? 0 : null;
    const limit = effective.kind === "LIMIT" ? effective.limitValue : null;
    const approaching = effective.kind === "LIMIT" && !effective.isUnlimited && limit !== null && limit > 0 && current !== null ? current / limit >= APPROACHING_RATIO && current < limit : false;
    // limit === 0 means the feature isn't included in the plan at all, not that a real allowance
    // was used up — that case is surfaced as "unavailable", never as a misleading "limit reached".
    const reached = effective.kind === "LIMIT" && !effective.isUnlimited && limit !== null && limit > 0 && current !== null ? current >= limit : false;
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
    subscriptionId: subscription?.id ?? null,
    status: subscription?.status ?? "NOT_ACTIVATED",
    entitled: isEntitledStatus(subscription),
    planKey: subscription?.plan.key ?? null,
    planName: subscription?.plan.name ?? null,
    selectedPlanId: subscription?.selectedPlanId ?? null,
    billingCycle: subscription?.billingCycle ?? "MONTHLY",
    currencyCode: subscription?.currencyCode ?? null,
    trialStartedAt: subscription?.trialStartedAt ?? null,
    trialEndsAt: subscription?.trialEndsAt ?? null,
    currentPeriodStart: subscription?.currentPeriodStart ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    gracePeriodEndsAt: subscription?.gracePeriodEndsAt ?? null,
    expiredAt: subscription?.expiredAt ?? null,
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
  const subscription = await findSubscription(organisationId);
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
