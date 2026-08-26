import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { PLATFORM_PERMISSIONS } from "@/platform/platform-admin/permissions";
import {
  createEntitlementOverride,
  createFeatureFlag,
  createPlan,
  createSupportSession,
  endSupportSession,
  getOrganisationDetailForPlatform,
  getPlatformAuditLog,
  listOrganisationsForPlatform,
  revokeEntitlementOverride,
  setOrganisationFeatureFlagOverride,
  updateFeatureFlag,
  updatePlan,
} from "@/modules/platform-admin/service";
import { getCommercialAnalytics } from "@/modules/platform-admin/analytics";
import { isFeatureEnabled } from "@/modules/feature-flags/service";
import { resolveEntitlement } from "@/modules/entitlements/service";
import { listVisibleSupportSessions } from "@/modules/subscriptions/service";
import { recordSubscriptionPaymentSuccess } from "@/modules/subscriptions/lifecycle";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
  // FeatureFlag/SubscriptionPlan (unlike Country/Currency/Role/Permission) are not seed-only
  // reference data — this suite creates its own test plans/flags, so clear anything this suite
  // created (never the three permanently seeded commercial plans) for a clean, repeatable run.
  await db.featureFlag.deleteMany();
  await db.subscriptionPlan.deleteMany({ where: { key: { notIn: ["starter", "growth", "scale"] } } });
}

async function makePrincipal(email: string, role: "SUPER_ADMIN" | "BILLING_ADMIN" | "SUPPORT_AGENT" | "READ_ONLY" = "SUPER_ADMIN") {
  const user = await registerUser({ displayName: email, email, password: "secure-password-123" });
  const principal = await db.platformPrincipal.create({ data: { userId: user.id, role, status: "ACTIVE", createdVia: "MANUAL" } });
  return { user, principal };
}

describe("PostgreSQL Phase 20 platform administration (independent of organisation RBAC)", () => {
  beforeEach(cleanDatabase);
  afterEach(() => { delete process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAILS; });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("bootstraps a platform principal from the environment variable, and denies a landlord organisation owner with no platform principal", async () => {
    const bootstrapUser = await registerUser({ displayName: "Bootstrap Candidate", email: "bootstrap-candidate@example.com", password: "secure-password-123" });
    process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAILS = `someone-else@example.com, ${bootstrapUser.email.toUpperCase()} `;
    const principal = await requirePlatformPrincipal(bootstrapUser);
    expect(principal).toMatchObject({ role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "ENV_BOOTSTRAP" });
    // Idempotent: calling it again does not create a second principal or change the existing one.
    await requirePlatformPrincipal(bootstrapUser);
    expect(await db.platformPrincipal.count({ where: { userId: bootstrapUser.id } })).toBe(1);

    const landlord = await registerUser({ displayName: "Landlord Owner", email: "landlord-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(landlord.id, { name: "Landlord Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const membership = await db.organisationMember.findFirstOrThrow({ where: { organisationId: organisation.id, userId: landlord.id }, include: { roles: { include: { role: true } } } });
    expect(membership.roles.some((entry) => entry.role.key === "organisation_owner")).toBe(true);
    // Being an organisation_owner grants nothing at the platform layer.
    await expect(requirePlatformPrincipal(landlord)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(requirePlatformPrincipal(null)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("enforces platform role permissions independently of organisation membership", async () => {
    const { user: supportUser, principal: supportPrincipal } = await makePrincipal("support-agent@example.com", "SUPPORT_AGENT");
    await expect(requirePlatformPrincipal(supportUser, PLATFORM_PERMISSIONS.orgsRead)).resolves.toMatchObject({ id: supportPrincipal.id });
    await expect(requirePlatformPrincipal(supportUser, PLATFORM_PERMISSIONS.plansManage)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createPlan(supportPrincipal, { key: "denied-plan", name: "Denied", prices: [], entitlements: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { user: readOnlyUser, principal: readOnlyPrincipal } = await makePrincipal("read-only@example.com", "READ_ONLY");
    await expect(requirePlatformPrincipal(readOnlyUser, PLATFORM_PERMISSIONS.analyticsRead)).resolves.toMatchObject({ id: readOnlyPrincipal.id });
    await expect(requirePlatformPrincipal(readOnlyUser, PLATFORM_PERMISSIONS.supportSessionCreate)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists organisations with safe aggregate projections across tenants and requires a support session to view a specific organisation's detail", async () => {
    const { principal } = await makePrincipal("orgs-admin@example.com");
    const ownerA = await registerUser({ displayName: "Org A Owner", email: "org-a-owner@example.com", password: "secure-password-123" });
    const ownerB = await registerUser({ displayName: "Org B Owner", email: "org-b-owner@example.com", password: "secure-password-123" });
    const orgA = await createOrganisation(ownerA.id, { name: "Platform Org A", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const orgB = await createOrganisation(ownerB.id, { name: "Platform Org B", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });

    const listed = await listOrganisationsForPlatform(principal);
    const ids = listed.map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining([orgA.id, orgB.id])); // cross-tenant visibility is expected for platform admins.
    for (const entry of listed) {
      expect(entry).not.toHaveProperty("billingCustomerRef");
      expect(entry.subscription).toMatchObject({ status: "TRIALING", plan: { key: "starter" } });
    }

    await expect(getOrganisationDetailForPlatform(principal, orgA.id)).rejects.toMatchObject({ code: "SUPPORT_SESSION_REQUIRED", status: 403 });
    await createSupportSession(principal, orgA.id, { reason: "Investigating a billing question", durationMinutes: 30 });
    const detail = await getOrganisationDetailForPlatform(principal, orgA.id);
    expect(detail.organisation.id).toBe(orgA.id);
    expect(detail.entitlements.planKey).toBe("starter");
    // Still requires its own support session for a different organisation.
    await expect(getOrganisationDetailForPlatform(principal, orgB.id)).rejects.toMatchObject({ code: "SUPPORT_SESSION_REQUIRED" });

    const auditActions = (await getPlatformAuditLog(principal)).map((entry) => entry.action);
    expect(auditActions).toEqual(expect.arrayContaining(["platform_admin.organisations_listed", "platform_admin.support_session_started", "platform_admin.organisation_viewed"]));
  });

  it("audits and time-bounds support sessions, makes them visible to the organisation, and never grants membership or mutation", async () => {
    const { principal } = await makePrincipal("support-visibility@example.com");
    const owner = await registerUser({ displayName: "Visible Org Owner", email: "visible-org-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Support Visibility Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });

    const session = await createSupportSession(principal, organisation.id, { reason: "Reviewing a support ticket", durationMinutes: 15 });
    // No membership is ever created for the platform principal, on any organisation.
    expect(await db.organisationMember.count({ where: { organisationId: organisation.id, userId: principal.userId } })).toBe(0);

    // The organisation itself can see the access (item 9's "visible session").
    const visible = await listVisibleSupportSessions(owner.id, organisation.id);
    expect(visible.map((entry) => entry.id)).toContain(session.id);
    expect(visible[0]).toMatchObject({ reason: "Reviewing a support ticket" });

    // Expiry is enforced: an expired session no longer satisfies the requirement.
    await db.platformSupportSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(getOrganisationDetailForPlatform(principal, organisation.id)).rejects.toMatchObject({ code: "SUPPORT_SESSION_REQUIRED" });

    // A fresh session works again, and can be explicitly ended.
    const secondSession = await createSupportSession(principal, organisation.id, { reason: "Follow-up", durationMinutes: 15 });
    await expect(getOrganisationDetailForPlatform(principal, organisation.id)).resolves.toBeTruthy();
    const ended = await endSupportSession(principal, secondSession.id);
    expect(ended.endedAt).not.toBeNull();
    await expect(getOrganisationDetailForPlatform(principal, organisation.id)).rejects.toMatchObject({ code: "SUPPORT_SESSION_REQUIRED" });
  });

  it("limits concurrent active support sessions per platform principal", async () => {
    const { principal } = await makePrincipal("support-limit@example.com");
    const organisationIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const owner = await registerUser({ displayName: `Limit Owner ${index}`, email: `support-limit-owner-${index}@example.com`, password: "secure-password-123" });
      const organisation = await createOrganisation(owner.id, { name: `Support Limit Organisation ${index}`, type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
      organisationIds.push(organisation.id);
    }
    for (let index = 0; index < 3; index += 1) {
      await createSupportSession(principal, organisationIds[index]!, { reason: `Session ${index}`, durationMinutes: 30 });
    }
    await expect(createSupportSession(principal, organisationIds[3]!, { reason: "One too many", durationMinutes: 30 })).rejects.toMatchObject({ code: "SUPPORT_SESSION_LIMIT_REACHED", status: 429 });
  });

  it("creates and revokes organisation entitlement overrides via platform admin, and keeps overrides scoped to their own organisation", async () => {
    const { principal } = await makePrincipal("override-admin@example.com");
    const ownerA = await registerUser({ displayName: "Override Org A Owner", email: "override-org-a@example.com", password: "secure-password-123" });
    const ownerB = await registerUser({ displayName: "Override Org B Owner", email: "override-org-b@example.com", password: "secure-password-123" });
    const orgA = await createOrganisation(ownerA.id, { name: "Override Platform Org A", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const orgB = await createOrganisation(ownerB.id, { name: "Override Platform Org B", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });

    const override = await createEntitlementOverride(principal, orgA.id, { featureKey: "reporting.advanced", kind: "BOOLEAN", booleanValue: true, reason: "Beta access" });
    await expect(resolveEntitlement(orgA.id, "reporting.advanced")).resolves.toMatchObject({ booleanValue: true, source: "override" });
    // Org B is completely unaffected — overrides never leak across organisations.
    await expect(resolveEntitlement(orgB.id, "reporting.advanced")).resolves.toMatchObject({ booleanValue: false, source: "plan" });
    // An override cannot be revoked through the wrong organisation.
    await expect(revokeEntitlementOverride(principal, orgB.id, override.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await revokeEntitlementOverride(principal, orgA.id, override.id);
    await expect(resolveEntitlement(orgA.id, "reporting.advanced")).resolves.toMatchObject({ booleanValue: false, source: "plan" });
  });

  it("manages plans, evaluates feature flags (global/percentage-cohort/org-override/emergency-disable), and records platform audit events", async () => {
    const { principal } = await makePrincipal("plan-flag-admin@example.com");
    const ownerA = await registerUser({ displayName: "Flag Org A Owner", email: "flag-org-a@example.com", password: "secure-password-123" });
    const ownerB = await registerUser({ displayName: "Flag Org B Owner", email: "flag-org-b@example.com", password: "secure-password-123" });
    const orgA = await createOrganisation(ownerA.id, { name: "Flag Platform Org A", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const orgB = await createOrganisation(ownerB.id, { name: "Flag Platform Org B", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });

    const plan = await createPlan(principal, {
      key: "phase20-test-tier", name: "Phase 20 Test Tier",
      prices: [{ currencyCode: "GHS", billingCycle: "MONTHLY", amountMinor: "10000" }],
      entitlements: [{ featureKey: "listings.max", kind: "LIMIT", limitValue: 7 }],
    });
    expect(plan.prices[0]!.amountMinor.toString()).toBe("10000");
    const updated = await updatePlan(principal, plan.id, { prices: [{ currencyCode: "GHS", billingCycle: "MONTHLY", amountMinor: "12000" }] });
    expect(updated.prices.find((price) => price.billingCycle === "MONTHLY")!.amountMinor.toString()).toBe("12000");
    await expect(createPlan(principal, { key: "listings.max", name: "x", prices: [], entitlements: [{ featureKey: "not.a.real.feature", kind: "BOOLEAN", booleanValue: true }] })).rejects.toMatchObject({ code: "ENTITLEMENT_UNKNOWN_FEATURE" });

    const flag = await createFeatureFlag(principal, { key: "phase20.beta_dashboard", description: "Beta dashboard UI", isEnabled: true, rolloutPercentage: 0 });
    expect(await isFeatureEnabled(flag.key, orgA.id)).toBe(false); // 0% rollout always off, regardless of isEnabled.
    await updateFeatureFlag(principal, flag.key, { rolloutPercentage: 100 });
    expect(await isFeatureEnabled(flag.key, orgA.id)).toBe(true);
    await updateFeatureFlag(principal, flag.key, { emergencyDisabled: true });
    expect(await isFeatureEnabled(flag.key, orgA.id)).toBe(false); // emergency kill switch always wins.
    await updateFeatureFlag(principal, flag.key, { emergencyDisabled: false, isEnabled: false });
    await setOrganisationFeatureFlagOverride(principal, orgA.id, flag.key, { enabled: true });
    expect(await isFeatureEnabled(flag.key, orgA.id)).toBe(true); // org override wins over the global default.
    expect(await isFeatureEnabled(flag.key, orgB.id)).toBe(false); // org B has no override.

    const cohortFlag = await createFeatureFlag(principal, { key: "phase20.cohort_flag", description: "Cohort rollout", isEnabled: true, rolloutPercentage: 50 });
    const first = await isFeatureEnabled(cohortFlag.key, orgA.id);
    const second = await isFeatureEnabled(cohortFlag.key, orgA.id);
    expect(second).toBe(first); // deterministic — the same organisation always lands in the same cohort bucket.

    const auditActions = (await getPlatformAuditLog(principal)).map((entry) => entry.action);
    expect(auditActions).toEqual(expect.arrayContaining(["platform_admin.plan_created", "platform_admin.plan_updated", "platform_admin.feature_flag_upserted", "platform_admin.feature_flag_updated", "platform_admin.feature_flag_override_set"]));
  });

  it("computes deterministic commercial analytics with no fabricated revenue", async () => {
    const { principal } = await makePrincipal("analytics-admin@example.com");
    const ownerA = await registerUser({ displayName: "Analytics Org A Owner", email: "analytics-org-a@example.com", password: "secure-password-123" });
    const ownerB = await registerUser({ displayName: "Analytics Org B Owner", email: "analytics-org-b@example.com", password: "secure-password-123" });
    const orgA = await createOrganisation(ownerA.id, { name: "Analytics Platform Org A", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const orgB = await createOrganisation(ownerB.id, { name: "Analytics Platform Org B", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });

    const baseline = await getCommercialAnalytics(principal);
    expect(baseline.totalOrganisations).toBeGreaterThanOrEqual(2);
    expect(baseline.mrrByCurrency).toEqual({}); // both organisations are still trialing — never fabricate revenue for non-paying accounts.

    await recordSubscriptionPaymentSuccess(orgA.id, { amountMinor: "25000", currencyCode: "GHS", billingProviderKey: "test" }); // starter, monthly.
    const growthPlan = await db.subscriptionPlan.findUniqueOrThrow({ where: { key: "growth" } });
    await db.organisationSubscription.update({ where: { organisationId: orgB.id }, data: { planId: growthPlan.id } });
    await recordSubscriptionPaymentSuccess(orgB.id, { amountMinor: "75000", currencyCode: "GHS", billingProviderKey: "test" }); // growth, monthly.

    const withRevenue = await getCommercialAnalytics(principal);
    expect(withRevenue.mrrByCurrency.GHS).toBe("100000"); // 25000 (starter) + 75000 (growth), deterministic from real plan prices.
    expect(withRevenue.arrByCurrency.GHS).toBe("1200000");
    expect(withRevenue.statusCounts.ACTIVE).toBeGreaterThanOrEqual(2);
  });
});
