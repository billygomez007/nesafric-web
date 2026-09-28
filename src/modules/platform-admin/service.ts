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
import { createFeatureFlagSchema, listingPublishDecisionSchema, listingReturnDecisionSchema, organisationListQuerySchema, platformAuditQuerySchema, setFlagOverrideSchema, updateFeatureFlagSchema } from "./schemas";
import { applyListingTransition, applyListingVerification, REVIEW_TRANSACTION_OPTIONS } from "@/modules/listings/service";
import { listingReadinessProblems } from "@/modules/listings/readiness";
import { getEmailProviderStatus } from "@/modules/conversations/channels/email-providers";
import { runDueJobs, runPendingJobs } from "@/platform/jobs/runner";
import { jobHandlers } from "@/platform/jobs/handlers";

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
  const [jobsByStatus, failedJobs, notificationFailures, webhookIncidents, recentAccountEmailJobs] = await Promise.all([
    db.backgroundJob.groupBy({ by: ["status"], _count: { _all: true } }),
    db.backgroundJob.findMany({ where: { status: "FAILED" }, select: { id: true, organisationId: true, type: true, attempts: true, maxAttempts: true, lastError: true, runAt: true }, orderBy: { runAt: "desc" }, take: 50 }),
    db.notification.count({ where: { status: "FAILED" } }),
    db.billingWebhookEvent.findMany({ where: { status: { in: ["UNMATCHED", "MISMATCHED", "FAILED"] } }, select: { id: true, providerKey: true, eventType: true, status: true, failureReason: true, receivedAt: true }, orderBy: { receivedAt: "desc" }, take: 50 }),
    // Every status, not just failures — the payload's `template`/`dedupeKey` are never secrets
    // (no credentials, no email body), so this is safe to surface for diagnosing exactly which
    // welcome/onboarding/notification email a given job corresponds to.
    db.backgroundJob.findMany({
      where: { type: "account-email" },
      select: { id: true, type: true, status: true, attempts: true, maxAttempts: true, lastError: true, idempotencyKey: true, createdAt: true, completedAt: true, payload: true },
      orderBy: { createdAt: "desc" }, take: 20,
    }),
  ]);
  const emailJobFailures = failedJobs.filter((job) => job.type === "account-email" || job.type === "notification-delivery");
  return {
    jobsByStatus: Object.fromEntries(jobsByStatus.map((entry) => [entry.status, entry._count._all])),
    failedJobs,
    notificationFailureCount: notificationFailures,
    billingWebhookIncidents: webhookIncidents,
    recentAccountEmailJobs,
    // Secret-free — only which transport is active and how many recent email-related job
    // failures exist, never a credential or an email body.
    email: { ...getEmailProviderStatus(), recentFailureCount: emailJobFailures.length },
  };
}

/**
 * Manually drains due `BackgroundJob` rows using the exact same `runDueJobs`/`jobHandlers` the
 * external cron (`POST /api/jobs/run`, secret-gated) and the standalone worker process both
 * already use — no new job-processing logic, just an additional, platform-admin-authenticated
 * entry point to the same function. Exists for exactly the situation that motivated it: the
 * external scheduler being unavailable (rate-limited, billing-locked, not yet deployed) while an
 * admin still needs the queue to move. Uses the pre-existing, previously-unused `jobsManage`
 * permission (SUPER_ADMIN only).
 */
export async function runDueJobsForPlatform(principal: PlatformPrincipal) {
  requirePermission(principal, PLATFORM_PERMISSIONS.jobsManage);
  const result = await runDueJobs(jobHandlers);
  await recordPlatformAudit(principal, "platform_admin.jobs_drained", "background_job", "*", undefined, result);
  return result;
}

export async function runPendingJobsForPlatform(principal: PlatformPrincipal) {
  requirePermission(principal, PLATFORM_PERMISSIONS.jobsManage);
  const result = await runPendingJobs(jobHandlers);
  await recordPlatformAudit(
    principal,
    "platform_admin.pending_jobs_drained",
    "background_job",
    "*",
    undefined,
    result,
  );
  return result;
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

// SUPER ADMIN PHASE 1 — USERS + PROFESSIONALS
// ---------------------------------------------------------------------------

type PlatformDirectoryQuery = {
  search?: string;
  take?: number;
};

function boundedTake(value: unknown, fallback = 50, maximum = 100) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), maximum);
}

/**
 * Platform-wide user directory.
 *
 * Deliberately returns only operational account metadata. Password hashes, session tokens,
 * provider credentials and other secrets are never selected.
 */
export async function listUsersForPlatform(
  principal: PlatformPrincipal,
  input: PlatformDirectoryQuery = {},
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.usersRead);

  const search = input.search?.trim();
  const take = boundedTake(input.take);

  const users = await db.user.findMany({
    where: search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" } },
            { phoneE164: { contains: search.replace(/[^\d+]/g, "") || search } },
            { displayName: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    select: {
      id: true,
      email: true,
      displayName: true,
      emailVerifiedAt: true,
      phoneE164: true,
      phoneVerifiedAt: true,
      createdAt: true,
      platformPrincipal: {
        select: {
          role: true,
          status: true,
        },
      },
      memberships: {
        where: { archivedAt: null },
        select: {
          id: true,
          status: true,
          organisation: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          roles: {
            select: {
              role: {
                select: {
                  key: true,
                  name: true,
                },
              },
            },
          },
        },
        take: 20,
      },
      marketplaceProfessionalMemberships: {
        where: { status: { in: ["ACTIVE", "INVITED", "SUSPENDED"] } },
        select: {
          id: true,
          role: true,
          status: true,
          marketplaceProfessional: {
            select: {
              id: true,
              displayName: true,
              type: true,
              status: true,
              verificationStatus: true,
            },
          },
        },
        take: 20,
      },
      _count: {
        select: {
          memberships: true,
          marketplaceProfessionalMemberships: true,
          sessions: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take,
  });

  await recordPlatformAudit(
    principal,
    "platform_admin.users_listed",
    "user",
    "*",
    undefined,
    { count: users.length, search: search ?? null },
  );

  return users;
}

/**
 * Platform-wide Marketplace Professional directory for the NesAfric operations team.
 *
 * This is intentionally separate from PropertyOS organisations: MarketplaceProfessional is its
 * own account family and the hidden backing organisation is not exposed here.
 */
export async function listMarketplaceProfessionalsForPlatform(
  principal: PlatformPrincipal,
  input: PlatformDirectoryQuery = {},
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.marketplaceRead);

  const search = input.search?.trim();
  const take = boundedTake(input.take);

  const professionals = await db.marketplaceProfessional.findMany({
    where: {
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: "insensitive" } },
              { legalName: { contains: search, mode: "insensitive" } },
              { contactEmail: { contains: search, mode: "insensitive" } },
              { slug: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      type: true,
      displayName: true,
      legalName: true,
      slug: true,
      logoUrl: true,
      contactEmail: true,
      contactPhone: true,
      countryCode: true,
      specialities: true,
      servicesOffered: true,
      serviceAreas: true,
      status: true,
      verificationStatus: true,
      createdAt: true,
      archivedAt: true,
      homepageCompanyLogos: { select: { id: true, isPublished: true, sortOrder: true } },
      subscription: {
        select: {
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          plan: {
            select: {
              key: true,
              name: true,
            },
          },
        },
      },
      members: {
        where: { status: { in: ["ACTIVE", "INVITED", "SUSPENDED"] } },
        select: {
          id: true,
          role: true,
          status: true,
          user: {
            select: {
              id: true,
              displayName: true,
              email: true,
            },
          },
        },
        take: 20,
      },
      _count: {
        select: {
          members: true,
          listings: true,
          developments: true,
          campaigns: true,
          aiemployees: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take,
  });

  await recordPlatformAudit(
    principal,
    "platform_admin.marketplace_professionals_listed",
    "marketplace_professional",
    "*",
    undefined,
    { count: professionals.length, search: search ?? null },
  );

  return professionals;
}


// SUPER ADMIN PHASE 2 — SUBSCRIPTIONS + PAYMENTS
// ---------------------------------------------------------------------------

const PLATFORM_SUBSCRIPTION_STATUSES = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE_PERIOD",
  "SUSPENDED",
  "CANCELLED",
] as const;

const PLATFORM_PAYMENT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REVERSED",
] as const;

const PLATFORM_RECONCILIATION_STATUSES = [
  "UNMATCHED",
  "PENDING",
  "MATCHED",
  "MISMATCHED",
  "DUPLICATE",
] as const;

type PlatformSubscriptionStatus =
  (typeof PLATFORM_SUBSCRIPTION_STATUSES)[number];

type PlatformPaymentStatus =
  (typeof PLATFORM_PAYMENT_STATUSES)[number];

type PlatformReconciliationStatus =
  (typeof PLATFORM_RECONCILIATION_STATUSES)[number];

function parsePlatformEnum<T extends string>(
  value: unknown,
  values: readonly T[],
): T | undefined {
  if (typeof value !== "string") return undefined;
  return values.includes(value as T) ? (value as T) : undefined;
}

type PlatformSubscriptionDirectoryQuery = {
  search?: string;
  status?: string;
  take?: number;
};

export async function listSubscriptionsForPlatform(
  principal: PlatformPrincipal,
  input: PlatformSubscriptionDirectoryQuery = {},
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.subscriptionsRead);

  const search = input.search?.trim();
  const status = parsePlatformEnum<PlatformSubscriptionStatus>(
    input.status,
    PLATFORM_SUBSCRIPTION_STATUSES,
  );
  const take = boundedTake(input.take, 50, 100);

  const where: Prisma.OrganisationSubscriptionWhereInput = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          organisation: {
            name: { contains: search, mode: "insensitive" },
          },
        }
      : {}),
  };

  const [subscriptions, statusGroups, totalSubscriptions, failedInvoices] =
    await Promise.all([
      db.organisationSubscription.findMany({
        where,
        select: {
          id: true,
          organisationId: true,
          status: true,
          billingCycle: true,
          currencyCode: true,
          billingProviderKey: true,
          trialEndsAt: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          cancelledAt: true,
          suspendedAt: true,
          gracePeriodEndsAt: true,
          pastDueSince: true,
          createdAt: true,
          updatedAt: true,
          organisation: {
            select: {
              id: true,
              name: true,
              type: true,
              countryCode: true,
            },
          },
          plan: {
            select: {
              id: true,
              key: true,
              name: true,
              isActive: true,
              isPublic: true,
            },
          },
          _count: {
            select: {
              invoices: true,
              statusHistory: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take,
      }),
      db.organisationSubscription.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      db.organisationSubscription.count(),
      db.subscriptionInvoice.count({ where: { status: "FAILED" } }),
    ]);

  await recordPlatformAudit(
    principal,
    "platform_admin.subscriptions_listed",
    "organisation_subscription",
    "*",
    undefined,
    {
      count: subscriptions.length,
      status: status ?? null,
      search: search ?? null,
    },
  );

  return {
    summary: {
      total: totalSubscriptions,
      byStatus: Object.fromEntries(
        statusGroups.map((entry) => [entry.status, entry._count._all]),
      ),
      failedInvoices,
    },
    subscriptions,
  };
}

type PlatformPaymentDirectoryQuery = {
  search?: string;
  status?: string;
  reconciliationStatus?: string;
  take?: number;
};

export async function listPaymentsForPlatform(
  principal: PlatformPrincipal,
  input: PlatformPaymentDirectoryQuery = {},
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.paymentsRead);

  const search = input.search?.trim();
  const status = parsePlatformEnum<PlatformPaymentStatus>(
    input.status,
    PLATFORM_PAYMENT_STATUSES,
  );
  const reconciliationStatus =
    parsePlatformEnum<PlatformReconciliationStatus>(
      input.reconciliationStatus,
      PLATFORM_RECONCILIATION_STATUSES,
    );
  const take = boundedTake(input.take, 50, 100);

  const where: Prisma.PaymentWhereInput = {
    ...(status ? { status } : {}),
    ...(reconciliationStatus ? { reconciliationStatus } : {}),
    ...(search
      ? {
          OR: [
            {
              internalReference: {
                contains: search,
                mode: "insensitive",
              },
            },
            {
              externalReference: {
                contains: search,
                mode: "insensitive",
              },
            },
            {
              providerTransactionRef: {
                contains: search,
                mode: "insensitive",
              },
            },
            {
              organisation: {
                name: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
          ],
        }
      : {}),
  };

  const [
    payments,
    paymentStatusGroups,
    reconciliationGroups,
    totalPayments,
    failedPayments,
    reconciliationExceptions,
  ] = await Promise.all([
    db.payment.findMany({
      where,
      select: {
        id: true,
        organisationId: true,
        internalReference: true,
        amountMinor: true,
        currencyCode: true,
        method: true,
        source: true,
        status: true,
        paidAt: true,
        externalReference: true,
        providerKey: true,
        providerTransactionRef: true,
        reconciliationStatus: true,
        failureReason: true,
        confirmedAt: true,
        reversedAt: true,
        reversalReason: true,
        createdAt: true,
        organisation: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            reconciliationEvents: true,
            ledgerEntries: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take,
    }),
    db.payment.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.payment.groupBy({
      by: ["reconciliationStatus"],
      _count: { _all: true },
    }),
    db.payment.count(),
    db.payment.count({ where: { status: "FAILED" } }),
    db.paymentReconciliationEvent.count({
      where: {
        status: {
          in: ["UNMATCHED", "MISMATCHED"],
        },
      },
    }),
  ]);

  const serializablePayments = payments.map((payment) => ({
    ...payment,
    amountMinor: payment.amountMinor.toString(),
  }));

  await recordPlatformAudit(
    principal,
    "platform_admin.payments_listed",
    "payment",
    "*",
    undefined,
    {
      count: serializablePayments.length,
      status: status ?? null,
      reconciliationStatus: reconciliationStatus ?? null,
      search: search ?? null,
    },
  );

  return {
    summary: {
      total: totalPayments,
      failed: failedPayments,
      reconciliationExceptions,
      byStatus: Object.fromEntries(
        paymentStatusGroups.map((entry) => [
          entry.status,
          entry._count._all,
        ]),
      ),
      byReconciliationStatus: Object.fromEntries(
        reconciliationGroups.map((entry) => [
          entry.reconciliationStatus,
          entry._count._all,
        ]),
      ),
    },
    payments: serializablePayments,
  };
}

export async function listPaymentReconciliationForPlatform(
  principal: PlatformPrincipal,
  input: {
    status?: string;
    take?: number;
  } = {},
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.paymentsRead);

  const status = parsePlatformEnum<PlatformReconciliationStatus>(
    input.status,
    PLATFORM_RECONCILIATION_STATUSES,
  );
  const take = boundedTake(input.take, 50, 100);

  const events = await db.paymentReconciliationEvent.findMany({
    where: status ? { status } : undefined,
    select: {
      id: true,
      organisationId: true,
      paymentId: true,
      securityDepositId: true,
      providerKey: true,
      eventKey: true,
      transactionRef: true,
      status: true,
      receivedAt: true,
      processedAt: true,
      organisation: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { receivedAt: "desc" },
    take,
  });

  await recordPlatformAudit(
    principal,
    "platform_admin.payment_reconciliation_listed",
    "payment_reconciliation_event",
    "*",
    undefined,
    {
      count: events.length,
      status: status ?? null,
    },
  );

  return events;
}

// SUPER ADMIN PHASE 3 — LISTINGS + MARKETPLACE + VERIFICATION
// ---------------------------------------------------------------------------

const PLATFORM_LISTING_STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "PUBLISHED",
  "PAUSED",
  "RESERVED",
  "RENTED",
  "ARCHIVED",
  "REJECTED",
] as const;

const PLATFORM_LISTING_VERIFICATION_STATUSES = [
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
] as const;

type PlatformListingStatus =
  (typeof PLATFORM_LISTING_STATUSES)[number];

type PlatformListingVerificationStatus =
  (typeof PLATFORM_LISTING_VERIFICATION_STATUSES)[number];

type PlatformListingDirectoryQuery = {
  search?: string;
  status?: string;
  verificationStatus?: string;
  take?: number;
};

export async function listListingsForPlatform(
  principal: PlatformPrincipal,
  input: PlatformListingDirectoryQuery = {},
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.listingsRead);

  const search = input.search?.trim();
  const status = parsePlatformEnum<PlatformListingStatus>(
    input.status,
    PLATFORM_LISTING_STATUSES,
  );
  const verificationStatus =
    parsePlatformEnum<PlatformListingVerificationStatus>(
      input.verificationStatus,
      PLATFORM_LISTING_VERIFICATION_STATUSES,
    );
  const take = boundedTake(input.take, 50, 100);

  const where: Prisma.ListingWhereInput = {
    ...(status ? { status } : {}),
    ...(verificationStatus ? { verificationStatus } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { city: { contains: search, mode: "insensitive" } },
            { district: { contains: search, mode: "insensitive" } },
            {
              organisation: {
                name: { contains: search, mode: "insensitive" },
              },
            },
            {
              marketplaceProfessional: {
                displayName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
          ],
        }
      : {}),
  };

  const [
    listings,
    total,
    statusGroups,
    verificationGroups,
    pendingVerification,
  ] = await Promise.all([
    db.listing.findMany({
      where,
      select: {
        id: true,
        organisationId: true,
        listingType: true,
        category: true,
        title: true,
        askingAmountMinor: true,
        rentAmountMinor: true,
        currencyCode: true,
        frequency: true,
        availableFrom: true,
        countryCode: true,
        region: true,
        city: true,
        district: true,
        locality: true,
        publicLocationLabel: true,
        status: true,
        verificationStatus: true,
        evidenceReady: true,
        listingAuthority: true,
        marketplaceProfessionalId: true,
        submittedAt: true,
        publishedAt: true,
        pausedAt: true,
        rejectedAt: true,
        createdAt: true,
        updatedAt: true,
        organisation: {
          select: {
            id: true,
            name: true,
            type: true,
            countryCode: true,
          },
        },
        marketplaceProfessional: {
          select: {
            id: true,
            displayName: true,
            slug: true,
            type: true,
            verificationStatus: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
        _count: {
          select: {
            media: true,
            verificationEvidence: true,
            leads: true,
            viewingRequests: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    db.listing.count(),
    db.listing.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.listing.groupBy({
      by: ["verificationStatus"],
      _count: { _all: true },
    }),
    db.listing.count({
      where: { verificationStatus: "PENDING" },
    }),
  ]);

  const serializable = listings.map((listing) => ({
    ...listing,
    askingAmountMinor: listing.askingAmountMinor?.toString() ?? null,
    rentAmountMinor: listing.rentAmountMinor?.toString() ?? null,
  }));

  await recordPlatformAudit(
    principal,
    "platform_admin.listings_listed",
    "listing",
    "*",
    undefined,
    {
      count: serializable.length,
      status: status ?? null,
      verificationStatus: verificationStatus ?? null,
      search: search ?? null,
    },
  );

  return {
    summary: {
      total,
      pendingVerification,
      byStatus: Object.fromEntries(
        statusGroups.map((entry) => [
          entry.status,
          entry._count._all,
        ]),
      ),
      byVerificationStatus: Object.fromEntries(
        verificationGroups.map((entry) => [
          entry.verificationStatus,
          entry._count._all,
        ]),
      ),
    },
    listings: serializable,
  };
}

export async function getMarketplaceOverviewForPlatform(
  principal: PlatformPrincipal,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.marketplaceRead);

  const [
    professionals,
    verifiedProfessionals,
    pendingProfessionals,
    listings,
    publishedListings,
    pendingListingVerification,
    providers,
    verifiedProviders,
    suspendedProviders,
  ] = await Promise.all([
    db.marketplaceProfessional.count({
      where: { archivedAt: null },
    }),
    db.marketplaceProfessional.count({
      where: {
        archivedAt: null,
        verificationStatus: "VERIFIED",
      },
    }),
    db.marketplaceProfessional.count({
      where: {
        archivedAt: null,
        verificationStatus: "PENDING",
      },
    }),
    db.listing.count(),
    db.listing.count({
      where: {
        status: "PUBLISHED",
        verificationStatus: "VERIFIED",
      },
    }),
    db.listing.count({
      where: { verificationStatus: "PENDING" },
    }),
    db.serviceProvider.count({
      where: { archivedAt: null },
    }),
    db.serviceProvider.count({
      where: {
        archivedAt: null,
        suspendedAt: null,
        verificationStatus: "VERIFIED",
      },
    }),
    db.serviceProvider.count({
      where: {
        archivedAt: null,
        suspendedAt: { not: null },
      },
    }),
  ]);

  const result = {
    professionals: {
      total: professionals,
      verified: verifiedProfessionals,
      pendingVerification: pendingProfessionals,
    },
    listings: {
      total: listings,
      publishedAndVerified: publishedListings,
      pendingVerification: pendingListingVerification,
    },
    providers: {
      total: providers,
      verified: verifiedProviders,
      suspended: suspendedProviders,
    },
  };

  await recordPlatformAudit(
    principal,
    "platform_admin.marketplace_overview_viewed",
    "marketplace",
    "*",
    undefined,
    result,
  );

  return result;
}

export async function getVerificationQueueForPlatform(
  principal: PlatformPrincipal,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.listingsRead);

  const [listingQueue, professionalQueue, providerCount] =
    await Promise.all([
      db.listing.findMany({
        // Everything a reviewer may need to decide: pending verification, and anything sitting in
        // review (including legacy in-review listings whose verification was never submitted).
        where: { OR: [{ verificationStatus: "PENDING" }, { status: "PENDING_REVIEW" }] },
        select: {
          id: true,
          title: true,
          listingType: true,
          category: true,
          status: true,
          verificationStatus: true,
          evidenceReady: true,
          submittedAt: true,
          createdAt: true,
          updatedAt: true,
          publicDescription: true,
          askingAmountMinor: true,
          rentAmountMinor: true,
          currencyCode: true,
          frequency: true,
          city: true,
          district: true,
          locality: true,
          region: true,
          publicLocationLabel: true,
          countryCode: true,
          listingAuthority: true,
          organisation: {
            select: {
              id: true,
              name: true,
            },
          },
          marketplaceProfessional: {
            select: {
              id: true,
              displayName: true,
              slug: true,
              verificationStatus: true,
            },
          },
          media: {
            select: { id: true, type: true, publicUrl: true, isCover: true, altText: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          verificationEvidence: {
            select: { id: true, type: true, privateReference: true, createdAt: true, expiresAt: true },
            orderBy: { createdAt: "asc" },
          },
          _count: {
            select: {
              verificationEvidence: true,
              media: true,
            },
          },
        },
        orderBy: { updatedAt: "asc" },
        take: 100,
      }),
      db.marketplaceProfessional.findMany({
        where: {
          archivedAt: null,
          verificationStatus: "PENDING",
        },
        select: {
          id: true,
          displayName: true,
          legalName: true,
          type: true,
          countryCode: true,
          verificationStatus: true,
          verificationEvidenceReferences: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "asc" },
        take: 100,
      }),
      db.serviceProvider.count({
        where: {
          archivedAt: null,
          verificationStatus: {
            in: ["PENDING", "REQUIRES_MORE_INFORMATION"],
          },
        },
      }),
    ]);

  await recordPlatformAudit(
    principal,
    "platform_admin.verification_queue_viewed",
    "verification_queue",
    "*",
    undefined,
    {
      listingCount: listingQueue.length,
      professionalCount: professionalQueue.length,
      providerCount,
    },
  );

  // Private evidence references are only shown to principals who can decide on them.
  const canDecide = platformRoleHasPermission(principal.role, PLATFORM_PERMISSIONS.listingsVerify);
  const listings = listingQueue.map(({ publicDescription, media, verificationEvidence, ...listing }) => {
    const photos = media.filter(({ type }) => type === "PHOTO");
    const cover = photos.find(({ isCover }) => isCover) ?? photos[0] ?? null;
    return {
      ...listing,
      askingAmountMinor: listing.askingAmountMinor?.toString() ?? null,
      rentAmountMinor: listing.rentAmountMinor?.toString() ?? null,
      updatedAt: listing.updatedAt.toISOString(),
      cover: cover ? { publicUrl: cover.publicUrl, altText: cover.altText } : null,
      photoCount: photos.length,
      readinessProblems: listingReadinessProblems({ ...listing, publicDescription, media }),
      evidence: canDecide ? verificationEvidence : verificationEvidence.map(({ privateReference: _hidden, ...evidence }) => evidence),
    };
  });

  return {
    listings,
    professionals: professionalQueue,
    providerCount,
    canDecideListings: canDecide,
  };
}

const PLATFORM_LISTING_REVIEW_TRANSITIONS: Record<
  PlatformListingVerificationStatus,
  PlatformListingVerificationStatus[]
> = {
  UNVERIFIED: ["PENDING"],
  PENDING: ["VERIFIED", "REJECTED", "SUSPENDED"],
  VERIFIED: ["SUSPENDED"],
  REJECTED: ["PENDING"],
  SUSPENDED: ["PENDING"],
};

export async function reviewListingVerificationForPlatform(
  principal: PlatformPrincipal,
  listingId: string,
  input: unknown,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.listingsVerify);

  const raw =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  const status = parsePlatformEnum<PlatformListingVerificationStatus>(
    raw.status,
    PLATFORM_LISTING_VERIFICATION_STATUSES,
  );

  if (!status || !["VERIFIED", "REJECTED", "SUSPENDED"].includes(status)) {
    throw new AppError(
      "INVALID_LISTING_VERIFICATION_STATUS",
      422,
      "Platform review status must be VERIFIED, REJECTED, or SUSPENDED.",
    );
  }

  const note =
    typeof raw.note === "string" && raw.note.trim()
      ? raw.note.trim().slice(0, 2000)
      : undefined;

  const listing = await db.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      organisationId: true,
      title: true,
      status: true,
      verificationStatus: true,
    },
  });

  if (!listing) throw notFound();

  if (
    !PLATFORM_LISTING_REVIEW_TRANSITIONS[
      listing.verificationStatus
    ].includes(status)
  ) {
    throw new AppError(
      "INVALID_VERIFICATION_TRANSITION",
      409,
      "The listing verification cannot transition to that status.",
    );
  }

  const pause =
    status === "SUSPENDED" && listing.status === "PUBLISHED";
  const now = new Date();

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.listing.update({
      where: { id: listing.id },
      data: {
        verificationStatus: status,
        evidenceReady:
          status === "VERIFIED" ||
          listing.verificationStatus === "PENDING",
        ...(pause
          ? {
              status: "PAUSED",
              pausedAt: now,
            }
          : {}),
      },
    });

    await tx.listingVerificationHistory.create({
      data: {
        listingId: listing.id,
        actorUserId: principal.userId,
        fromStatus: listing.verificationStatus,
        toStatus: status,
        note,
      },
    });

    if (pause) {
      await tx.listingStatusHistory.create({
        data: {
          listingId: listing.id,
          actorUserId: principal.userId,
          fromStatus: "PUBLISHED",
          toStatus: "PAUSED",
          note: "Verification suspended by NesAfric platform administration.",
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        organisationId: listing.organisationId,
        actorUserId: principal.userId,
        action: `listing.verification_${status.toLowerCase()}`,
        entityType: "listing",
        entityId: listing.id,
        metadata: {
          authority: "PLATFORM",
          fromStatus: listing.verificationStatus,
          toStatus: status,
          note: note ?? null,
        },
      },
    });

    if (pause) {
      await tx.auditEvent.create({
        data: {
          organisationId: listing.organisationId,
          actorUserId: principal.userId,
          action: "listing.status_changed",
          entityType: "listing",
          entityId: listing.id,
          metadata: {
            authority: "PLATFORM",
            fromStatus: "PUBLISHED",
            toStatus: "PAUSED",
            reason: "verification_suspended",
          },
        },
      });
    }

    return result;
  });

  await recordPlatformAudit(
    principal,
    `platform_admin.listing_verification_${status.toLowerCase()}`,
    "listing",
    listing.id,
    listing.organisationId,
    {
      title: listing.title,
      fromStatus: listing.verificationStatus,
      toStatus: status,
      note: note ?? null,
      listingPaused: pause,
    },
  );

  return updated;
}

// SUPER ADMIN PHASE 4 — MAINTENANCE + COMMUNICATIONS + AI OPERATIONS
// ---------------------------------------------------------------------------

const PLATFORM_MAINTENANCE_STATUSES = [
  "REPORTED",
  "TRIAGED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
] as const;

const PLATFORM_CONVERSATION_STATUSES = [
  "OPEN",
  "AI_ACTIVE",
  "HUMAN_REQUIRED",
  "HUMAN_ACTIVE",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
] as const;

type PlatformMaintenanceStatus =
  (typeof PLATFORM_MAINTENANCE_STATUSES)[number];

type PlatformConversationStatus =
  (typeof PLATFORM_CONVERSATION_STATUSES)[number];

export async function listMaintenanceOperationsForPlatform(
  principal: PlatformPrincipal,
  input: {
    search?: string;
    status?: string;
    take?: number;
  } = {},
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.maintenanceRead);

  const search = input.search?.trim();
  const status = parsePlatformEnum<PlatformMaintenanceStatus>(
    input.status,
    PLATFORM_MAINTENANCE_STATUSES,
  );
  const take = boundedTake(input.take, 50, 100);

  const where: Prisma.MaintenanceRequestWhereInput = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { category: { contains: search, mode: "insensitive" } },
            {
              organisation: {
                name: { contains: search, mode: "insensitive" },
              },
            },
            {
              property: {
                name: { contains: search, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };

  const [
    requests,
    total,
    statusGroups,
    priorityGroups,
    openWorkOrders,
    overdueWorkOrders,
  ] = await Promise.all([
    db.maintenanceRequest.findMany({
      where,
      select: {
        id: true,
        organisationId: true,
        title: true,
        category: true,
        priority: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        closedAt: true,
        organisation: {
          select: {
            id: true,
            name: true,
          },
        },
        property: {
          select: {
            id: true,
            name: true,
          },
        },
        unit: {
          select: {
            id: true,
            name: true,
          },
        },
        reportedBy: {
          select: {
            id: true,
            displayName: true,
          },
        },
        _count: {
          select: {
            workOrders: true,
            approvals: true,
            attachments: true,
            conversations: true,
            dispatchAttempts: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    db.maintenanceRequest.count(),
    db.maintenanceRequest.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.maintenanceRequest.groupBy({
      by: ["priority"],
      _count: { _all: true },
    }),
    db.workOrder.count({
      where: {
        status: {
          in: ["OPEN", "ASSIGNED", "IN_PROGRESS"],
        },
      },
    }),
    db.workOrder.count({
      where: {
        dueAt: { lt: new Date() },
        status: {
          in: ["OPEN", "ASSIGNED", "IN_PROGRESS"],
        },
      },
    }),
  ]);

  await recordPlatformAudit(
    principal,
    "platform_admin.maintenance_listed",
    "maintenance_request",
    "*",
    undefined,
    {
      count: requests.length,
      status: status ?? null,
      search: search ?? null,
    },
  );

  return {
    summary: {
      total,
      openWorkOrders,
      overdueWorkOrders,
      byStatus: Object.fromEntries(
        statusGroups.map((entry) => [
          entry.status,
          entry._count._all,
        ]),
      ),
      byPriority: Object.fromEntries(
        priorityGroups.map((entry) => [
          entry.priority,
          entry._count._all,
        ]),
      ),
    },
    requests,
  };
}

export async function listCommunicationsForPlatform(
  principal: PlatformPrincipal,
  input: {
    search?: string;
    status?: string;
    take?: number;
  } = {},
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.communicationsRead);

  const search = input.search?.trim();
  const status = parsePlatformEnum<PlatformConversationStatus>(
    input.status,
    PLATFORM_CONVERSATION_STATUSES,
  );
  const take = boundedTake(input.take, 50, 100);

  const where: Prisma.ConversationWhereInput = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { subject: { contains: search, mode: "insensitive" } },
            {
              organisation: {
                name: { contains: search, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };

  const [
    conversations,
    total,
    statusGroups,
    channelGroups,
    handoffRequired,
    aiActive,
  ] = await Promise.all([
    db.conversation.findMany({
      where,
      select: {
        id: true,
        organisationId: true,
        channel: true,
        status: true,
        subject: true,
        identityLevel: true,
        lastMessageAt: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        resolvedAt: true,
        closedAt: true,
        createdAt: true,
        updatedAt: true,
        organisation: {
          select: {
            id: true,
            name: true,
          },
        },
        assignedAIEmployee: {
          select: {
            id: true,
            name: true,
            role: true,
            status: true,
          },
        },
        assignedMember: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
        _count: {
          select: {
            messages: true,
            assignments: true,
            participants: true,
            voiceCalls: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    db.conversation.count(),
    db.conversation.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.conversation.groupBy({
      by: ["channel"],
      _count: { _all: true },
    }),
    db.conversation.count({
      where: { status: "HUMAN_REQUIRED" },
    }),
    db.conversation.count({
      where: { status: "AI_ACTIVE" },
    }),
  ]);

  await recordPlatformAudit(
    principal,
    "platform_admin.communications_listed",
    "conversation",
    "*",
    undefined,
    {
      count: conversations.length,
      status: status ?? null,
      search: search ?? null,
    },
  );

  return {
    summary: {
      total,
      handoffRequired,
      aiActive,
      byStatus: Object.fromEntries(
        statusGroups.map((entry) => [
          entry.status,
          entry._count._all,
        ]),
      ),
      byChannel: Object.fromEntries(
        channelGroups.map((entry) => [
          entry.channel,
          entry._count._all,
        ]),
      ),
    },
    conversations,
  };
}

export async function getAIOperationsForPlatform(
  principal: PlatformPrincipal,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.aiOperationsRead);

  const [
    totalEmployees,
    activeEmployees,
    employees,
    recentActivities,
    handoffs,
    openHandoffs,
    escalations,
    openEscalations,
    criticalEscalations,
  ] = await Promise.all([
    db.aIEmployee.count({
      where: { archivedAt: null },
    }),
    db.aIEmployee.count({
      where: {
        archivedAt: null,
        status: "ACTIVE",
      },
    }),
    db.aIEmployee.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        organisationId: true,
        marketplaceProfessionalId: true,
        name: true,
        role: true,
        status: true,
        scope: true,
        timezone: true,
        providerKey: true,
        modelKey: true,
        createdAt: true,
        updatedAt: true,
        organisation: {
          select: {
            id: true,
            name: true,
          },
        },
        marketplaceProfessional: {
          select: {
            id: true,
            displayName: true,
            type: true,
          },
        },
        _count: {
          select: {
            activities: true,
            handoffs: true,
            conversations: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    db.aIEmployeeActivity.findMany({
      select: {
        id: true,
        organisationId: true,
        marketplaceProfessionalId: true,
        aiEmployeeId: true,
        type: true,
        status: true,
        actionKey: true,
        policyDecision: true,
        reason: true,
        failureCode: true,
        failureMessage: true,
        createdAt: true,
        completedAt: true,
        aiEmployee: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
        organisation: {
          select: {
            id: true,
            name: true,
          },
        },
        marketplaceProfessional: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.aIEmployeeHandoff.findMany({
      where: {
        status: {
          in: ["OPEN", "ASSIGNED"],
        },
      },
      select: {
        id: true,
        organisationId: true,
        marketplaceProfessionalId: true,
        aiEmployeeId: true,
        reason: true,
        urgency: true,
        status: true,
        contextSummary: true,
        createdAt: true,
        updatedAt: true,
        aiEmployee: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
        organisation: {
          select: {
            id: true,
            name: true,
          },
        },
        marketplaceProfessional: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.aIEmployeeHandoff.count({
      where: {
        status: {
          in: ["OPEN", "ASSIGNED"],
        },
      },
    }),
    db.aIEscalation.findMany({
      where: {
        status: {
          not: "RESOLVED",
        },
      },
      select: {
        id: true,
        activityId: true,
        status: true,
        level: true,
        reason: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        activity: {
          select: {
            organisationId: true,
            type: true,
            status: true,
            severity: true,
            conditionKey: true,
            actionKey: true,
            autonomyLevel: true,
            policyDecision: true,
            reason: true,
            createdAt: true,
            organisation: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.aIEscalation.count({
      where: {
        status: {
          not: "RESOLVED",
        },
      },
    }),
    db.aIEscalation.count({
      where: {
        status: {
          not: "RESOLVED",
        },
        activity: {
          severity: "CRITICAL",
        },
      },
    }),
  ]);

  const result = {
    summary: {
      totalEmployees,
      activeEmployees,
      openHandoffs,
      openEscalations,
      criticalEscalations,
    },
    employees,
    recentActivities,
    handoffs,
    escalations,
  };

  await recordPlatformAudit(
    principal,
    "platform_admin.ai_operations_viewed",
    "ai_operations",
    "*",
    undefined,
    result.summary,
  );

  return result;
}

// SUPER ADMIN PHASE 5 — EXECUTIVE OVERVIEW + PLATFORM SETTINGS
// ---------------------------------------------------------------------------

export async function getPlatformOverviewDashboard(
  principal: PlatformPrincipal,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.analyticsRead);

  const [
    totalUsers,
    totalOrganisations,
    activeSubscriptions,
    totalProperties,
    totalUnits,
    activeLeases,
    publishedListings,
    verifiedProfessionals,
    verifiedProviders,
    openMaintenance,
    unresolvedAIEscalations,
    criticalAIEscalations,
    failedPayments,
    pastDueSubscriptions,
    recentAudit,
  ] = await Promise.all([
    db.user.count(),

    // MarketplaceProfessional backing organisations are technical shells and
    // must not inflate the PropertyOS organisation KPI.
    db.organisation.count({
      where: {
        archivedAt: null,
        marketplaceProfessional: null,
      },
    }),

    db.organisationSubscription.count({
      where: { status: "ACTIVE" },
    }),

    db.property.count({
      where: { archivedAt: null },
    }),

    db.unit.count({
      where: { archivedAt: null },
    }),

    db.lease.count({
      where: {
        archivedAt: null,
        status: "ACTIVE",
      },
    }),

    db.listing.count({
      where: { status: "PUBLISHED" },
    }),

    db.marketplaceProfessional.count({
      where: {
        archivedAt: null,
        verificationStatus: "VERIFIED",
      },
    }),

    db.serviceProvider.count({
      where: {
        archivedAt: null,
        suspendedAt: null,
        verificationStatus: "VERIFIED",
      },
    }),

    db.maintenanceRequest.count({
      where: {
        status: {
          in: [
            "REPORTED",
            "TRIAGED",
            "AWAITING_APPROVAL",
            "APPROVED",
            "ASSIGNED",
            "IN_PROGRESS",
          ],
        },
      },
    }),

    db.aIEscalation.count({
      where: {
        status: { not: "RESOLVED" },
      },
    }),

    db.aIEscalation.count({
      where: {
        status: { not: "RESOLVED" },
        activity: {
          severity: "CRITICAL",
        },
      },
    }),

    db.payment.count({
      where: { status: "FAILED" },
    }),

    db.organisationSubscription.count({
      where: {
        status: {
          in: ["PAST_DUE", "GRACE_PERIOD"],
        },
      },
    }),

    db.platformAuditEvent.findMany({
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        organisationId: true,
        createdAt: true,
        platformPrincipal: {
          select: {
            role: true,
            user: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  const result = {
    kpis: {
      totalUsers,
      totalOrganisations,
      activeSubscriptions,
      totalProperties,
      totalUnits,
      activeLeases,
      publishedListings,
      verifiedProfessionals,
      verifiedProviders,
      openMaintenance,
      unresolvedAIEscalations,
      criticalAIEscalations,
      failedPayments,
      pastDueSubscriptions,
    },
    recentAudit,
  };

  await recordPlatformAudit(
    principal,
    "platform_admin.overview_viewed",
    "platform_overview",
    "*",
    undefined,
    {
      totalOrganisations,
      totalUsers,
    },
  );

  return result;
}

export async function getPlatformSettingsSummary(
  principal: PlatformPrincipal,
) {
  requirePermission(principal, PLATFORM_PERMISSIONS.orgsRead);

  const [
    featureFlags,
    featureFlagOverrides,
    subscriptionPlans,
    publicSubscriptionPlans,
    marketplacePlans,
    publicMarketplacePlans,
    activeCountries,
    activeCurrencies,
    principalStatusGroups,
    principalRoleGroups,
  ] = await Promise.all([
    db.featureFlag.count(),
    db.organisationFeatureFlagOverride.count(),

    db.subscriptionPlan.count({
      where: { isActive: true },
    }),

    db.subscriptionPlan.count({
      where: {
        isActive: true,
        isPublic: true,
      },
    }),

    db.marketplacePlan.count({
      where: { isActive: true },
    }),

    db.marketplacePlan.count({
      where: {
        isActive: true,
        isPublic: true,
      },
    }),

    db.country.count({
      where: { isActive: true },
    }),

    db.currency.count({
      where: { isActive: true },
    }),

    db.platformPrincipal.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),

    db.platformPrincipal.groupBy({
      by: ["role"],
      _count: { _all: true },
    }),
  ]);

  const result = {
    configuration: {
      featureFlags,
      featureFlagOverrides,
      subscriptionPlans,
      publicSubscriptionPlans,
      marketplacePlans,
      publicMarketplacePlans,
      activeCountries,
      activeCurrencies,
    },
    platformAccess: {
      byStatus: Object.fromEntries(
        principalStatusGroups.map((entry) => [
          entry.status,
          entry._count._all,
        ]),
      ),
      byRole: Object.fromEntries(
        principalRoleGroups.map((entry) => [
          entry.role,
          entry._count._all,
        ]),
      ),
    },
  };

  await recordPlatformAudit(
    principal,
    "platform_admin.settings_summary_viewed",
    "platform_settings",
    "*",
    undefined,
    result.configuration,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Listing review decisions (Verify & publish, Request changes, Reject)
// ---------------------------------------------------------------------------

type ListingReviewTx = Prisma.TransactionClient;

/** Locks the listing row for the decision and refuses when it changed since the reviewer loaded it. */
async function lockListingForReview(tx: ListingReviewTx, listingId: string, expectedUpdatedAt: Date) {
  if (!isUuid(listingId)) throw notFound();
  await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${listingId}::uuid FOR UPDATE`;
  const listing = await tx.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true, organisationId: true, marketplaceProfessionalId: true, status: true, verificationStatus: true, updatedAt: true,
      title: true, publicDescription: true, listingType: true, askingAmountMinor: true, rentAmountMinor: true,
      city: true, locality: true, publicLocationLabel: true,
      media: { select: { type: true } },
    },
  });
  if (!listing) throw notFound();
  if (listing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw new AppError("LISTING_CHANGED", 409, "This listing changed since you opened it. Reload and review it again.");
  }
  if (listing.status !== "PENDING_REVIEW") {
    throw new AppError("LISTING_NOT_IN_REVIEW", 409, "Only a listing that is in review can be decided.");
  }
  return listing;
}

async function recordListingDecision(tx: ListingReviewTx, principal: PlatformPrincipal, action: string, listing: { id: string; organisationId: string; marketplaceProfessionalId: string | null }, metadata: Record<string, unknown>) {
  await tx.platformAuditEvent.create({
    data: { platformPrincipalId: principal.id, action, entityType: "listing", entityId: listing.id, organisationId: listing.organisationId, metadata: json({ marketplaceProfessionalId: listing.marketplaceProfessionalId, ...metadata }) },
  });
}

/**
 * Verify & publish: the one explicit platform action that makes a reviewed listing public. It
 * verifies the listing (when verification is pending) and publishes it in the same transaction,
 * through the listing lifecycle's own transition, so every publication rule — photo, asset
 * availability, duplicate active listing — runs against the now-verified listing. If any rule
 * fails the whole decision rolls back: a listing is never left verified-but-unpublished by this
 * action.
 */
export async function verifyAndPublishListingForPlatform(principal: PlatformPrincipal, listingId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.listingsVerify);
  const data = listingPublishDecisionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const listing = await lockListingForReview(tx, listingId, data.expectedUpdatedAt);
    if (listing.verificationStatus !== "PENDING" && listing.verificationStatus !== "VERIFIED") {
      throw new AppError("LISTING_VERIFICATION_NOT_SUBMITTED", 409, "This listing's authority verification has not been submitted.");
    }
    const problems = listingReadinessProblems(listing);
    if (problems.length) {
      throw new AppError("LISTING_INCOMPLETE", 422, `This listing is not ready to publish: ${problems.map(({ message }) => message).join(" ")}`, { problems });
    }
    const via = { authority: "PLATFORM", via: "verify_and_publish" };
    const verifiedNow = listing.verificationStatus === "PENDING";
    if (verifiedNow) {
      await applyListingVerification(tx, principal.userId, listing.organisationId, listing.id, { status: "VERIFIED", note: data.note }, via);
    }
    const published = await applyListingTransition(tx, principal.userId, listing.organisationId, listing.id, { status: "PUBLISHED", note: data.note ?? "Verified and published by NesAfric." }, via);
    await recordListingDecision(tx, principal, "platform_admin.listing_verified_and_published", listing, { verifiedNow, note: data.note ?? null });
    return published;
  }, REVIEW_TRANSACTION_OPTIONS);
}

/**
 * Request changes: returns a listing in review to DRAFT so the professional can edit and resubmit
 * it. The note is kept on the status history (shown to the professional) and in audit. Verification
 * evidence is untouched; a still-pending verification rides along with the resubmission.
 */
export async function requestListingChangesForPlatform(principal: PlatformPrincipal, listingId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.listingsVerify);
  const data = listingReturnDecisionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const listing = await lockListingForReview(tx, listingId, data.expectedUpdatedAt);
    const returned = await applyListingTransition(tx, principal.userId, listing.organisationId, listing.id, { status: "DRAFT", note: data.note }, { authority: "PLATFORM", via: "request_changes" });
    await recordListingDecision(tx, principal, "platform_admin.listing_changes_requested", listing, { note: data.note });
    return returned;
  }, REVIEW_TRANSACTION_OPTIONS);
}

/**
 * Reject: the listing is not acceptable as submitted (e.g. the authority evidence does not check
 * out). Listing → REJECTED and a pending verification → REJECTED, both with the note. Evidence is
 * kept; the professional can still edit and resubmit, which re-opens verification.
 */
export async function rejectListingForPlatform(principal: PlatformPrincipal, listingId: string, input: unknown) {
  requirePermission(principal, PLATFORM_PERMISSIONS.listingsVerify);
  const data = listingReturnDecisionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const listing = await lockListingForReview(tx, listingId, data.expectedUpdatedAt);
    const via = { authority: "PLATFORM", via: "reject" };
    if (listing.verificationStatus === "PENDING") {
      await applyListingVerification(tx, principal.userId, listing.organisationId, listing.id, { status: "REJECTED", note: data.note }, via);
    }
    const rejected = await applyListingTransition(tx, principal.userId, listing.organisationId, listing.id, { status: "REJECTED", note: data.note }, via);
    await recordListingDecision(tx, principal, "platform_admin.listing_rejected", listing, { note: data.note });
    return rejected;
  }, REVIEW_TRANSACTION_OPTIONS);
}
