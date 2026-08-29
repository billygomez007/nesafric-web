import { Prisma, type PlatformPrincipal } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { isUuid } from "@/platform/validation/uuid";
import { PLATFORM_PERMISSIONS, type PlatformPermission } from "@/platform/platform-admin/permissions";
import { platformRoleHasPermission } from "@/platform/platform-admin/permissions";
import { platformSetSubscriptionStatus } from "@/modules/subscriptions/lifecycle";
import { getEntitlementSnapshot, previewPlanChangeConflicts } from "@/modules/entitlements/service";
import { isKnownFeatureKey } from "@/modules/entitlements/catalog";
import {
  createEntitlementOverrideSchema,
  createPlanSchema,
  createSupportSessionSchema,
  platformForcePlanSchema,
  platformSuspendSchema,
  updatePlanSchema,
} from "@/modules/subscriptions/schemas";
import { createFeatureFlagSchema, organisationListQuerySchema, platformAuditQuerySchema, setFlagOverrideSchema, updateFeatureFlagSchema } from "./schemas";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const MAX_ACTIVE_SUPPORT_SESSIONS_PER_PRINCIPAL = 3;

// `limitValue` on plan entitlements and entitlement overrides is stored as `BigInt` (schema-
// enforced, since some limits could in principle exceed safe-integer range). Every value actually
// configured is a small business number (listing counts, team members, ...), so normalizing to a
// plain JS number here is safe — without it, `NextResponse.json()` throws "Do not know how to
// serialize a BigInt" and the platform-admin surface returning this record 500s on every request.
function withPlainLimitValue<T extends { limitValue: bigint | null }>(record: T) {
  return { ...record, limitValue: record.limitValue === null ? null : Number(record.limitValue) };
}

function requirePermission(principal: PlatformPrincipal, permission: PlatformPermission) {
  if (!platformRoleHasPermission(principal.role, permission)) throw new AppError("FORBIDDEN", 403, "You do not have permission to perform this action.");
}

export async function recordPlatformAudit(principal: PlatformPrincipal | null, action: string, entityType: string, entityId: string, organisationId?: string, metadata?: Record<string, unknown>) {
  await db.platformAuditEvent.create({ data: { platformPrincipalId: principal?.id, action, entityType, entityId, organisationId, metadata: metadata ? json(metadata) : undefined } });
}

// ---------------------------------------------------------------------------
// Organisations (safe aggregate projections only — item 8)
// ---------------------------------------------------------------------------

export async function listOrganisationsForPlatform(principal: PlatformPrincipal, input: unknown = {}) {
  requirePermission(principal, PLATFORM_PERMISSIONS.orgsRead);
  const query = organisationListQuerySchema.parse(input);
  const organisations = await db.organisation.findMany({
    where: {
      archivedAt: null,
      ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
      ...(query.status ? { subscription: { status: query.status } } : {}),
    },
    select: {
      id: true, name: true, type: true, countryCode: true, defaultCurrencyCode: true, createdAt: true,
      subscription: { select: { status: true, currentPeriodEnd: true, trialEndsAt: true, plan: { select: { key: true, name: true } } } },
      _count: { select: { members: true, properties: true } },
    },
    orderBy: { createdAt: "desc" },
    take: query.take,
  });
  await recordPlatformAudit(principal, "platform_admin.organisations_listed", "organisation", "*", undefined, { count: organisations.length, status: query.status ?? null });
  return organisations;
}

async function requireActiveSupportSession(platformPrincipalId: string, organisationId: string) {
  if (!isUuid(organisationId)) throw notFound();
  const now = new Date();
  const session = await db.platformSupportSession.findFirst({
    where: { platformPrincipalId, organisationId, expiresAt: { gt: now }, endedAt: null, revokedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!session) throw new AppError("SUPPORT_SESSION_REQUIRED", 403, "An active, reasoned support session is required before viewing this organisation's details.");
  return session;
}

/** Full organisation detail for the platform-admin drill-down (item 8): subscription, plan,
 * entitlement overrides, usage, invoices, active support session — every field here is either a
 * safe aggregate (counts) or already-non-secret configuration; never a raw credential. Requires
 * an active, reasoned support session (item 9) — the audited justification for viewing this
 * specific organisation's data. */
export async function getOrganisationDetailForPlatform(principal: PlatformPrincipal, organisationId: string) {
  requirePermission(principal, PLATFORM_PERMISSIONS.orgsRead);
  const supportSession = await requireActiveSupportSession(principal.id, organisationId);
  const organisation = await db.organisation.findUnique({
    where: { id: organisationId },
    include: {
      subscription: { include: { plan: { include: { entitlements: true, prices: true } } } },
      _count: { select: { members: true, properties: true } },
    },
  });
  if (!organisation) throw notFound();
  // A PropertyOS organisation shell can exist without ever having a subscription — e.g. a user
  // who registered and completed Marketplace Professional onboarding but never set up PropertyOS
  // management. `getEntitlementSnapshot` requires an active subscription, so it's skipped (not
  // treated as an error) rather than crashing the entire admin view for such an organisation.
  const [invoices, overrides, statusHistory, supportSessions, entitlements] = await Promise.all([
    db.subscriptionInvoice.findMany({ where: { organisationId }, orderBy: { periodStart: "desc" }, take: 24 }),
    db.organisationEntitlementOverride.findMany({ where: { organisationId }, orderBy: { createdAt: "desc" } }),
    db.subscriptionStatusHistory.findMany({ where: { organisationId }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.platformSupportSession.findMany({ where: { organisationId }, orderBy: { startedAt: "desc" }, take: 20 }),
    organisation.subscription ? getEntitlementSnapshot(organisationId) : Promise.resolve(null),
  ]);
  await recordPlatformAudit(principal, "platform_admin.organisation_viewed", "organisation", organisationId, organisationId, { supportSessionId: supportSession.id });
  const serializableOrganisation = {
    ...organisation,
    subscription: organisation.subscription && { ...organisation.subscription, plan: serializablePlan(organisation.subscription.plan) },
  };
  return { organisation: serializableOrganisation, invoices, overrides: overrides.map(withPlainLimitValue), statusHistory, supportSessions, entitlements, viewingUnderSupportSessionId: supportSession.id };
}

// ---------------------------------------------------------------------------
// Support sessions (item 9: audited, time-bound, read-only, visible to the organisation)
// ---------------------------------------------------------------------------

export async function createSupportSession(principal: PlatformPrincipal, organisationId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.supportSessionCreate);
  if (!isUuid(organisationId)) throw notFound();
  const data = createSupportSessionSchema.parse(input);
  const organisation = await db.organisation.findUnique({ where: { id: organisationId }, select: { id: true } });
  if (!organisation) throw notFound();
  const now = new Date();
  const activeCount = await db.platformSupportSession.count({ where: { platformPrincipalId: principal.id, expiresAt: { gt: now }, endedAt: null, revokedAt: null } });
  if (activeCount >= MAX_ACTIVE_SUPPORT_SESSIONS_PER_PRINCIPAL) {
    throw new AppError("SUPPORT_SESSION_LIMIT_REACHED", 429, `A platform principal may have at most ${MAX_ACTIVE_SUPPORT_SESSIONS_PER_PRINCIPAL} active support sessions at once.`);
  }
  const session = await db.platformSupportSession.create({
    data: { platformPrincipalId: principal.id, organisationId, reason: data.reason, expiresAt: new Date(now.getTime() + data.durationMinutes * 60_000) },
  });
  await recordPlatformAudit(principal, "platform_admin.support_session_started", "platform_support_session", session.id, organisationId, { reason: data.reason, expiresAt: session.expiresAt.toISOString() });
  return session;
}

export async function endSupportSession(principal: PlatformPrincipal, sessionId: string) {
  const session = await db.platformSupportSession.findUnique({ where: { id: sessionId } });
  if (!session) throw notFound();
  if (session.platformPrincipalId !== principal.id && principal.role !== "SUPER_ADMIN") throw new AppError("FORBIDDEN", 403, "You do not have permission to perform this action.");
  if (session.endedAt || session.revokedAt) return session;
  const ended = await db.platformSupportSession.update({ where: { id: sessionId }, data: { endedAt: new Date() } });
  await recordPlatformAudit(principal, "platform_admin.support_session_ended", "platform_support_session", session.id, session.organisationId);
  return ended;
}

/** The same list an organisation sees at `/settings/billing` (item 9's "visible session") — used
 * to render support-session history on the platform-admin side too, from one query shape. */
export async function listSupportSessionsForOrganisation(organisationId: string) {
  return db.platformSupportSession.findMany({ where: { organisationId }, orderBy: { startedAt: "desc" } });
}

// ---------------------------------------------------------------------------
// Plans (item 1's "configurable plans/prices")
// ---------------------------------------------------------------------------

function serializablePlan<T extends { entitlements: Array<{ limitValue: bigint | null }> }>(plan: T) {
  return { ...plan, entitlements: plan.entitlements.map(withPlainLimitValue) };
}

export async function listPlansForPlatform(principal: PlatformPrincipal) {
  requirePermission(principal, PLATFORM_PERMISSIONS.plansManage);
  const plans = await db.subscriptionPlan.findMany({ include: { prices: true, entitlements: true }, orderBy: { sortOrder: "asc" } });
  return plans.map(serializablePlan);
}

function assertKnownFeatureKeys(entitlements: Array<{ featureKey: string }>) {
  const unknown = entitlements.find((entry) => !isKnownFeatureKey(entry.featureKey));
  if (unknown) throw new AppError("ENTITLEMENT_UNKNOWN_FEATURE", 422, `'${unknown.featureKey}' is not a recognised entitlement feature key.`);
}

export async function createPlan(principal: PlatformPrincipal, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.plansManage);
  const data = createPlanSchema.parse(input);
  assertKnownFeatureKeys(data.entitlements);
  const plan = await db.$transaction(async (tx) => {
    const created = await tx.subscriptionPlan.create({
      data: {
        key: data.key, name: data.name, description: data.description, isActive: data.isActive, isPublic: data.isPublic, sortOrder: data.sortOrder,
        prices: { create: data.prices.map((price) => ({ currencyCode: price.currencyCode, billingCycle: price.billingCycle, amountMinor: price.amountMinor })) },
        entitlements: { create: data.entitlements.map((entry) => ({ featureKey: entry.featureKey, kind: entry.kind, booleanValue: entry.booleanValue, limitValue: entry.limitValue, isUnlimited: entry.isUnlimited })) },
      },
      include: { prices: true, entitlements: true },
    });
    return created;
  });
  await recordPlatformAudit(principal, "platform_admin.plan_created", "subscription_plan", plan.id, undefined, { key: plan.key });
  return serializablePlan(plan);
}

export async function updatePlan(principal: PlatformPrincipal, planId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.plansManage);
  const data = updatePlanSchema.parse(input);
  assertKnownFeatureKeys(data.entitlements ?? []);
  const existing = await db.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!existing) throw notFound();
  const plan = await db.$transaction(async (tx) => {
    await tx.subscriptionPlan.update({
      where: { id: planId },
      data: {
        name: data.name, description: data.description, isActive: data.isActive, isPublic: data.isPublic, sortOrder: data.sortOrder,
      },
    });
    if (data.prices) {
      for (const price of data.prices) {
        await tx.planPrice.upsert({
          where: { planId_currencyCode_billingCycle: { planId, currencyCode: price.currencyCode, billingCycle: price.billingCycle } },
          create: { planId, currencyCode: price.currencyCode, billingCycle: price.billingCycle, amountMinor: price.amountMinor },
          update: { amountMinor: price.amountMinor, isActive: true },
        });
      }
    }
    if (data.entitlements) {
      for (const entry of data.entitlements) {
        await tx.planEntitlement.upsert({
          where: { planId_featureKey: { planId, featureKey: entry.featureKey } },
          create: { planId, featureKey: entry.featureKey, kind: entry.kind, booleanValue: entry.booleanValue, limitValue: entry.limitValue, isUnlimited: entry.isUnlimited },
          update: { kind: entry.kind, booleanValue: entry.booleanValue, limitValue: entry.limitValue, isUnlimited: entry.isUnlimited },
        });
      }
    }
    return tx.subscriptionPlan.findUniqueOrThrow({ where: { id: planId }, include: { prices: true, entitlements: true } });
  });
  await recordPlatformAudit(principal, "platform_admin.plan_updated", "subscription_plan", plan.id, undefined, { key: plan.key });
  return serializablePlan(plan);
}

// ---------------------------------------------------------------------------
// Organisation entitlement overrides (item 2's "org/promotional overrides")
// ---------------------------------------------------------------------------

export async function createEntitlementOverride(principal: PlatformPrincipal, organisationId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.entitlementsOverride);
  const data = createEntitlementOverrideSchema.parse(input);
  if (!isKnownFeatureKey(data.featureKey)) throw new AppError("ENTITLEMENT_UNKNOWN_FEATURE", 422, `'${data.featureKey}' is not a recognised entitlement feature key.`);
  const organisation = await db.organisation.findUnique({ where: { id: organisationId }, select: { id: true } });
  if (!organisation) throw notFound();
  const override = await db.organisationEntitlementOverride.create({
    data: {
      organisationId, featureKey: data.featureKey, kind: data.kind, booleanValue: data.booleanValue, limitValue: data.limitValue, isUnlimited: data.isUnlimited,
      reason: data.reason, expiresAt: data.expiresAt ? new Date(data.expiresAt) : null, createdByPlatformPrincipalId: principal.id,
    },
  });
  await recordPlatformAudit(principal, "platform_admin.entitlement_override_created", "organisation_entitlement_override", override.id, organisationId, { featureKey: data.featureKey, reason: data.reason });
  return withPlainLimitValue(override);
}

export async function revokeEntitlementOverride(principal: PlatformPrincipal, organisationId: string, overrideId: string) {
  requirePermission(principal, PLATFORM_PERMISSIONS.entitlementsOverride);
  const override = await db.organisationEntitlementOverride.findFirst({ where: { id: overrideId, organisationId } });
  if (!override) throw notFound();
  if (override.revokedAt) return withPlainLimitValue(override);
  const updated = await db.organisationEntitlementOverride.update({ where: { id: overrideId }, data: { revokedAt: new Date(), revokedByPlatformPrincipalId: principal.id } });
  await recordPlatformAudit(principal, "platform_admin.entitlement_override_revoked", "organisation_entitlement_override", override.id, organisationId);
  return withPlainLimitValue(updated);
}

// ---------------------------------------------------------------------------
// Subscription admin actions (item 4 + item 8) — force any status/plan, unlike self-service
// ---------------------------------------------------------------------------

export async function previewForcedPlanChange(principal: PlatformPrincipal, organisationId: string, planKey: string) {
  requirePermission(principal, PLATFORM_PERMISSIONS.orgsManage);
  const plan = await db.subscriptionPlan.findUnique({ where: { key: planKey } });
  if (!plan) throw notFound();
  return previewPlanChangeConflicts(organisationId, plan.id);
}

export async function forcePlanChange(principal: PlatformPrincipal, organisationId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.orgsManage);
  const data = platformForcePlanSchema.parse(input);
  const plan = await db.subscriptionPlan.findUnique({ where: { key: data.planKey } });
  if (!plan) throw notFound();
  const subscription = await db.organisationSubscription.findUnique({ where: { organisationId } });
  if (!subscription) throw notFound();
  const conflicts = await previewPlanChangeConflicts(organisationId, plan.id);
  const updated = await db.$transaction(async (tx) => {
    const result = await tx.organisationSubscription.update({ where: { id: subscription.id }, data: { planId: plan.id } });
    await tx.auditEvent.create({ data: { organisationId, action: "subscription.plan_forced", entityType: "organisation_subscription", entityId: subscription.id, metadata: json({ toPlanId: plan.id, reason: data.reason, conflicts }) } });
    await tx.domainEvent.create({ data: { organisationId, name: "subscription.plan_forced", aggregateType: "organisation_subscription", aggregateId: subscription.id, payload: json({ planKey: plan.key }) } });
    return result;
  });
  await recordPlatformAudit(principal, "platform_admin.plan_forced", "organisation_subscription", subscription.id, organisationId, { planKey: plan.key, reason: data.reason, conflicts });
  return { subscription: updated, conflicts };
}

export async function suspendOrganisationSubscription(principal: PlatformPrincipal, organisationId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.orgsManage);
  const data = platformSuspendSchema.parse(input);
  const updated = await platformSetSubscriptionStatus(principal.id, organisationId, "SUSPENDED", data.reason);
  await recordPlatformAudit(principal, "platform_admin.subscription_suspended", "organisation_subscription", updated.id, organisationId, { reason: data.reason });
  return updated;
}

export async function resumeOrganisationSubscription(principal: PlatformPrincipal, organisationId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.orgsManage);
  const data = platformSuspendSchema.parse(input);
  const updated = await platformSetSubscriptionStatus(principal.id, organisationId, "ACTIVE", data.reason);
  await recordPlatformAudit(principal, "platform_admin.subscription_resumed", "organisation_subscription", updated.id, organisationId, { reason: data.reason });
  return updated;
}

export async function cancelOrganisationSubscriptionAsPlatform(principal: PlatformPrincipal, organisationId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.orgsManage);
  const data = platformSuspendSchema.parse(input);
  const updated = await platformSetSubscriptionStatus(principal.id, organisationId, "CANCELLED", data.reason);
  await recordPlatformAudit(principal, "platform_admin.subscription_cancelled", "organisation_subscription", updated.id, organisationId, { reason: data.reason });
  return updated;
}

// ---------------------------------------------------------------------------
// Feature flags (item 10)
// ---------------------------------------------------------------------------

export async function listFeatureFlagsForPlatform(principal: PlatformPrincipal) {
  requirePermission(principal, PLATFORM_PERMISSIONS.flagsManage);
  return db.featureFlag.findMany({ orderBy: { key: "asc" }, include: { organisationOverrides: true } });
}

export async function createFeatureFlag(principal: PlatformPrincipal, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.flagsManage);
  const data = createFeatureFlagSchema.parse(input);
  const flag = await db.featureFlag.upsert({
    where: { key: data.key },
    update: { description: data.description, isEnabled: data.isEnabled, rolloutPercentage: data.rolloutPercentage, emergencyDisabled: data.emergencyDisabled, updatedByPlatformPrincipalId: principal.id },
    create: { key: data.key, description: data.description, isEnabled: data.isEnabled, rolloutPercentage: data.rolloutPercentage, emergencyDisabled: data.emergencyDisabled, updatedByPlatformPrincipalId: principal.id },
  });
  await recordPlatformAudit(principal, "platform_admin.feature_flag_upserted", "feature_flag", flag.id, undefined, { key: flag.key });
  return flag;
}

export async function updateFeatureFlag(principal: PlatformPrincipal, flagKey: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.flagsManage);
  const data = updateFeatureFlagSchema.parse(input);
  const existing = await db.featureFlag.findUnique({ where: { key: flagKey } });
  if (!existing) throw notFound();
  const flag = await db.featureFlag.update({ where: { key: flagKey }, data: { ...data, updatedByPlatformPrincipalId: principal.id } });
  await recordPlatformAudit(principal, "platform_admin.feature_flag_updated", "feature_flag", flag.id, undefined, { key: flag.key, ...data });
  return flag;
}

export async function setOrganisationFeatureFlagOverride(principal: PlatformPrincipal, organisationId: string, flagKey: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.flagsManage);
  const data = setFlagOverrideSchema.parse(input);
  const flag = await db.featureFlag.findUnique({ where: { key: flagKey } });
  if (!flag) throw notFound();
  const override = await db.organisationFeatureFlagOverride.upsert({
    where: { organisationId_flagKey: { organisationId, flagKey } },
    create: { organisationId, flagKey, enabled: data.enabled, createdByPlatformPrincipalId: principal.id },
    update: { enabled: data.enabled, createdByPlatformPrincipalId: principal.id },
  });
  await recordPlatformAudit(principal, "platform_admin.feature_flag_override_set", "organisation_feature_flag_override", override.id, organisationId, { flagKey, enabled: data.enabled });
  return override;
}

// ---------------------------------------------------------------------------
// Platform health / jobs / incidents (item 8's "safe aggregate projections")
// ---------------------------------------------------------------------------

export async function getPlatformHealth(principal: PlatformPrincipal) {
  requirePermission(principal, PLATFORM_PERMISSIONS.orgsRead);
  const [jobsByStatus, failedJobs, notificationFailures, webhookIncidents] = await Promise.all([
    db.backgroundJob.groupBy({ by: ["status"], _count: { _all: true } }),
    db.backgroundJob.findMany({ where: { status: "FAILED" }, select: { id: true, organisationId: true, type: true, attempts: true, maxAttempts: true, lastError: true, runAt: true }, orderBy: { runAt: "desc" }, take: 50 }),
    db.notification.count({ where: { status: "FAILED" } }),
    db.billingWebhookEvent.findMany({ where: { status: { in: ["UNMATCHED", "MISMATCHED", "FAILED"] } }, select: { id: true, providerKey: true, eventType: true, status: true, failureReason: true, receivedAt: true }, orderBy: { receivedAt: "desc" }, take: 50 }),
  ]);
  return {
    jobsByStatus: Object.fromEntries(jobsByStatus.map((entry) => [entry.status, entry._count._all])),
    failedJobs,
    notificationFailureCount: notificationFailures,
    billingWebhookIncidents: webhookIncidents,
  };
}

export async function getPlatformAuditLog(principal: PlatformPrincipal, input: unknown = {}) {
  requirePermission(principal, PLATFORM_PERMISSIONS.auditRead);
  const query = platformAuditQuerySchema.parse(input);
  return db.platformAuditEvent.findMany({
    where: query.organisationId ? { organisationId: query.organisationId } : {},
    orderBy: { createdAt: "desc" },
    take: query.take,
  });
}
