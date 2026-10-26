import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation, inviteMember } from "@/modules/organisations/service";
import { createProperty, createUnit } from "@/modules/assets/service";
import { activatePropertyManagement } from "@/modules/subscriptions/activation";
import { PM_PLANS, PM_TRIAL_PLAN } from "@/modules/subscriptions/plan-catalog";
import { createTenant } from "@/modules/tenants/service";
import { createLease } from "./helpers/lease";
import { generateLeaseAgreementPdf } from "@/modules/documents/generation";
import { upsertDocumentTemplate } from "@/modules/documents/templates";
import { upsertIntegrationConfig } from "@/modules/integrations/service";
import {
  assertFeatureEnabled,
  getEntitlementSnapshot,
  previewPlanChangeConflicts,
  resolveEntitlement,
} from "@/modules/entitlements/service";
import { getCurrentUsage } from "@/modules/entitlements/usage";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import {
  advanceOverdueSubscriptions,
  GRACE_PERIOD_DAYS,
  PAST_DUE_TO_GRACE_DAYS,
  recordSubscriptionPaymentFailure,
  recordSubscriptionPaymentSuccess,
} from "@/modules/subscriptions/lifecycle";
import { cancelOrganisationSubscription, changeOrganisationPlan, reactivateScheduledCancellation } from "@/modules/subscriptions/service";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

async function addMember(organisationId: string, userId: string, roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const member = await db.organisationMember.create({ data: { organisationId, userId } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
  return member;
}

const days = (count: number) => count * 24 * 60 * 60 * 1000;

describe("PostgreSQL Phase 20 subscriptions and entitlements", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("creates no subscription when an organisation is created; activation starts a trial on the trial plan", async () => {
    const owner = await registerUser({ displayName: "Sub Owner", email: "sub-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Sub Organisation", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    expect(await db.organisationSubscription.count({ where: { organisationId: organisation.id } })).toBe(0);
    await activatePropertyManagement(organisation.id, owner.id);
    const subscription = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id }, include: { plan: true } });
    expect(subscription.status).toBe("TRIALING");
    expect(subscription.plan.key).toBe("pm_trial");
    expect(subscription.currencyCode).toBe("GHS");
    expect(subscription.trialEndsAt).not.toBeNull();
    expect(await db.organisationSubscription.count({ where: { organisationId: organisation.id } })).toBe(1);
    const history = await db.subscriptionStatusHistory.findMany({ where: { organisationId: organisation.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: null, toStatus: "TRIALING" });
  });

  it("enforces a numeric plan limit, reports a typed error with upgrade readiness, and never deletes existing records on a blocked attempt", async () => {
    const owner = await registerUser({ displayName: "Limit Owner", email: "limit-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Limit Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const capacity = PM_TRIAL_PLAN.allowances.units;
    await createProperty(owner.id, organisation.id, { name: "Full house", referenceNumber: "LIM-000", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: Array.from({ length: capacity }, (_, index) => ({ name: `U${index}` })) });
    await expect(createProperty(owner.id, organisation.id, { name: "One too many", referenceNumber: "LIM-004", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "X" }] }))
      .rejects.toMatchObject({
        code: "ENTITLEMENT_LIMIT_REACHED",
        status: 402,
        details: { feature: ENTITLEMENTS.unitsMax.key, current: capacity, limit: capacity, upgradeReady: true },
      });
    expect(await db.unit.count({ where: { property: { organisationId: organisation.id } } })).toBe(capacity);
    expect(await db.property.count({ where: { organisationId: organisation.id } })).toBe(1);
  });

  it("applies an active organisation-specific override ahead of the plan, and stops applying it once revoked or expired", async () => {
    const owner = await registerUser({ displayName: "Override Owner", email: "override-owner@example.com", password: "secure-password-123" });
    const platformUser = await registerUser({ displayName: "Override Platform", email: "override-platform@example.com", password: "secure-password-123" });
    const platformPrincipal = await db.platformPrincipal.create({ data: { userId: platformUser.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
    const organisation = await createOrganisation(owner.id, { name: "Override Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const capacity = PM_TRIAL_PLAN.allowances.units;
    const property = await createProperty(owner.id, organisation.id, { name: "Override block", referenceNumber: "OVR-000", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: Array.from({ length: capacity }, (_, index) => ({ name: `U${index}` })) });
    await expect(createUnit(owner.id, organisation.id, property.id, { name: "Blocked" })).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED" });

    // An Enterprise-style capacity override (always a number, never unlimited).
    const override = await db.organisationEntitlementOverride.create({
      data: { organisationId: organisation.id, featureKey: ENTITLEMENTS.unitsMax.key, kind: "LIMIT", limitValue: capacity + 5, reason: "Configured capacity", createdByPlatformPrincipalId: platformPrincipal.id },
    });
    await expect(resolveEntitlement(organisation.id, ENTITLEMENTS.unitsMax.key)).resolves.toMatchObject({ limitValue: capacity + 5, source: "override" });
    await expect(createUnit(owner.id, organisation.id, property.id, { name: "Allowed by override" })).resolves.toBeTruthy();

    // Revoking the override falls back to the plan limit — existing units are untouched, but a new one is blocked again.
    await db.organisationEntitlementOverride.update({ where: { id: override.id }, data: { revokedAt: new Date(), revokedByPlatformPrincipalId: platformPrincipal.id } });
    await expect(resolveEntitlement(organisation.id, ENTITLEMENTS.unitsMax.key)).resolves.toMatchObject({ limitValue: capacity, source: "plan" });
    await expect(createUnit(owner.id, organisation.id, property.id, { name: "Blocked again" })).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED" });
    expect(await db.unit.count({ where: { propertyId: property.id } })).toBe(capacity + 1);

    // An expired override is also ignored.
    await db.organisationEntitlementOverride.create({
      data: { organisationId: organisation.id, featureKey: ENTITLEMENTS.unitsMax.key, kind: "LIMIT", limitValue: 500, reason: "Already expired", createdByPlatformPrincipalId: platformPrincipal.id, expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(resolveEntitlement(organisation.id, ENTITLEMENTS.unitsMax.key)).resolves.toMatchObject({ limitValue: capacity, source: "plan" });
  });

  it("enforces a boolean plan entitlement (third-party integrations) and lifts it via an override", async () => {
    const owner = await registerUser({ displayName: "Bool Owner", email: "bool-owner@example.com", password: "secure-password-123" });
    const platformUser = await registerUser({ displayName: "Bool Platform", email: "bool-platform@example.com", password: "secure-password-123" });
    const platformPrincipal = await db.platformPrincipal.create({ data: { userId: platformUser.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
    const organisation = await createOrganisation(owner.id, { name: "Bool Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await activatePropertyManagement(organisation.id, owner.id);
    await expect(assertFeatureEnabled(organisation.id, ENTITLEMENTS.integrationsEnabled.key)).rejects.toMatchObject({ code: "ENTITLEMENT_FEATURE_DISABLED" });
    await expect(upsertIntegrationConfig(owner.id, organisation.id, { integrationType: "ESIGNATURE", enabled: true })).rejects.toMatchObject({ code: "ENTITLEMENT_FEATURE_DISABLED", details: { feature: ENTITLEMENTS.integrationsEnabled.key } });
    // Disabling is always allowed even when the boolean entitlement is off.
    await expect(upsertIntegrationConfig(owner.id, organisation.id, { integrationType: "ESIGNATURE", enabled: false })).resolves.toMatchObject({ enabled: false });

    await db.organisationEntitlementOverride.create({
      data: { organisationId: organisation.id, featureKey: ENTITLEMENTS.integrationsEnabled.key, kind: "BOOLEAN", booleanValue: true, reason: "Comped integration access", createdByPlatformPrincipalId: platformPrincipal.id },
    });
    await expect(upsertIntegrationConfig(owner.id, organisation.id, { integrationType: "ESIGNATURE", enabled: true })).resolves.toMatchObject({ enabled: true });
  });

  it("computes deterministic, idempotent generated-document usage — an unchanged snapshot never counts twice", async () => {
    const owner = await registerUser({ displayName: "Doc Owner", email: "p20-doc-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Doc Usage Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, { name: "Doc House", referenceNumber: "P20DOC-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const { relationship } = await createTenant(owner.id, organisation.id, { legalName: "Doc Usage Tenant", email: "p20-doc-tenant@example.com", countryCode: "GH" });
    const lease = await createLease(owner.id, organisation.id, {
      referenceNumber: "P20DOC-LEASE-001", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id],
      startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "150000", depositAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE",
    });
    const subscription = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id } });
    const period = { start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd };

    expect(await getCurrentUsage(organisation.id, ENTITLEMENTS.documentsMonthlyMax.key, period)).toBe(0);
    const first = await generateLeaseAgreementPdf(owner.id, organisation.id, lease.id);
    expect(await getCurrentUsage(organisation.id, ENTITLEMENTS.documentsMonthlyMax.key, period)).toBe(1);
    // Regenerating identical source data returns the same document and must not count again.
    const again = await generateLeaseAgreementPdf(owner.id, organisation.id, lease.id);
    expect(again.generatedDocument.id).toBe(first.generatedDocument.id);
    expect(await getCurrentUsage(organisation.id, ENTITLEMENTS.documentsMonthlyMax.key, period)).toBe(1);
    // A genuine change (a template appears) creates a new version and does count.
    await upsertDocumentTemplate(owner.id, organisation.id, { documentType: "LEASE_AGREEMENT", name: "Standard lease", bodyTemplate: "Lease for {{property_name}}." });
    await generateLeaseAgreementPdf(owner.id, organisation.id, lease.id);
    expect(await getCurrentUsage(organisation.id, ENTITLEMENTS.documentsMonthlyMax.key, period)).toBe(2);
  });

  it("blocks growing the team past its plan seat limit without deleting any existing membership", async () => {
    const owner = await registerUser({ displayName: "Team Owner", email: "team-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Team Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await activatePropertyManagement(organisation.id, owner.id);
    // The owner plus two members fill the trial's three seats.
    const memberA = await registerUser({ displayName: "Member A", email: "team-a@example.com", password: "secure-password-123" });
    const memberB = await registerUser({ displayName: "Member B", email: "team-b@example.com", password: "secure-password-123" });
    await addMember(organisation.id, memberA.id, "property_manager");
    await addMember(organisation.id, memberB.id, "property_manager");
    expect(await db.organisationMember.count({ where: { organisationId: organisation.id, status: "ACTIVE" } })).toBe(PM_TRIAL_PLAN.allowances.staff);
    await expect(inviteMember(owner.id, organisation.id, { email: "team-overflow@example.com", roleKey: "viewer" })).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED", details: { feature: ENTITLEMENTS.teamMembersMax.key, current: 3, limit: 3 } });
    expect(await db.organisationMember.count({ where: { organisationId: organisation.id, status: "ACTIVE" } })).toBe(3);
  });

  it("reports downgrade conflicts without deleting any existing record", async () => {
    const owner = await registerUser({ displayName: "Downgrade Owner", email: "downgrade-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Downgrade Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await createProperty(owner.id, organisation.id, { name: "Downgrade block", referenceNumber: "DWN-000", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: Array.from({ length: 20 }, (_, index) => ({ name: `U${index}` })) });
    await db.planEntitlement.updateMany({ where: { plan: { key: "essential" }, featureKey: ENTITLEMENTS.unitsMax.key }, data: { limitValue: 10 } });
    try {
      const essential = await db.subscriptionPlan.findUniqueOrThrow({ where: { key: "essential" } });
      expect(await previewPlanChangeConflicts(organisation.id, essential.id)).toContainEqual({ featureKey: ENTITLEMENTS.unitsMax.key, label: ENTITLEMENTS.unitsMax.label, current: 20, newLimit: 10 });
      const { conflicts, effect } = await changeOrganisationPlan(owner.id, organisation.id, { planKey: "essential" });
      expect(effect).toBe("SELECTED");
      expect(conflicts.some((conflict) => conflict.featureKey === ENTITLEMENTS.unitsMax.key)).toBe(true);
      expect(await db.unit.count({ where: { property: { organisationId: organisation.id } } })).toBe(20);
    } finally {
      await db.planEntitlement.updateMany({ where: { plan: { key: "essential" }, featureKey: ENTITLEMENTS.unitsMax.key }, data: { limitValue: PM_PLANS.essential.allowances.units } });
    }
  });

  it("refuses a recurring renewal event for an organisation that never paid, and moves a paid plan through past due and grace", async () => {
    const owner = await registerUser({ displayName: "Lifecycle Owner", email: "lifecycle-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Lifecycle Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await activatePropertyManagement(organisation.id, owner.id);
    // A trial is never turned into a paid plan by an invoice event: only a confirmed checkout does that.
    await expect(recordSubscriptionPaymentSuccess(organisation.id, { amountMinor: "24900", currencyCode: "GHS", billingProviderKey: "test" })).rejects.toMatchObject({ code: "BILLING_EVENT_NOT_APPLICABLE" });

    const essential = await db.subscriptionPlan.findUniqueOrThrow({ where: { key: "essential" } });
    const periodEnd = new Date(Date.now() + days(10));
    await db.organisationSubscription.update({ where: { organisationId: organisation.id }, data: { status: "ACTIVE", planId: essential.id, currentPeriodStart: new Date(), currentPeriodEnd: periodEnd } });
    // The wrong amount for the plan grants nothing.
    await expect(recordSubscriptionPaymentSuccess(organisation.id, { amountMinor: "1", currencyCode: "GHS", billingProviderKey: "test" })).rejects.toMatchObject({ code: "BILLING_AMOUNT_MISMATCH" });
    const renewed = await recordSubscriptionPaymentSuccess(organisation.id, { amountMinor: String(PM_PLANS.essential.monthlyPriceMinor), currencyCode: "GHS", billingProviderKey: "test", providerInvoiceRef: "inv_test_1" });
    expect(renewed.status).toBe("ACTIVE");
    expect(renewed.currentPeriodStart.getTime()).toBe(periodEnd.getTime());

    const pastDue = await recordSubscriptionPaymentFailure(organisation.id, "Card declined", { billingProviderKey: "test" });
    expect(pastDue.status).toBe("PAST_DUE");
    expect(pastDue.pastDueSince).not.toBeNull();
    await db.organisationSubscription.update({ where: { organisationId: organisation.id }, data: { pastDueSince: new Date(Date.now() - days(PAST_DUE_TO_GRACE_DAYS + 1)) } });
    await advanceOverdueSubscriptions();
    expect((await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id } })).status).toBe("GRACE_PERIOD");
    await advanceOverdueSubscriptions();
    expect((await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id } })).status).toBe("GRACE_PERIOD");
    await db.organisationSubscription.update({ where: { organisationId: organisation.id }, data: { gracePeriodEndsAt: new Date(Date.now() - days(GRACE_PERIOD_DAYS + 1)) } });
    await advanceOverdueSubscriptions();
    const expired = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id } });
    expect(expired.status).toBe("EXPIRED");
    await expect(createTenant(owner.id, organisation.id, { legalName: "Blocked tenant", countryCode: "GH" })).rejects.toMatchObject({ code: "PM_SUBSCRIPTION_REQUIRED", status: 402 });
  });

  it("supports self-service cancel-at-period-end, immediate cancel, and reversing a scheduled cancellation", async () => {
    const owner = await registerUser({ displayName: "Cancel Owner", email: "cancel-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Cancel Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await activatePropertyManagement(organisation.id, owner.id);

    const scheduled = await cancelOrganisationSubscription(owner.id, organisation.id, { immediate: false, reason: "Trying immediate cancel first" });
    expect(scheduled.cancelAtPeriodEnd).toBe(true);
    expect(scheduled.status).toBe("TRIALING");
    await expect(createTenant(owner.id, organisation.id, { legalName: "Still allowed", countryCode: "GH" })).resolves.toBeTruthy();

    const reactivated = await reactivateScheduledCancellation(owner.id, organisation.id);
    expect(reactivated.cancelAtPeriodEnd).toBe(false);

    const cancelledNow = await cancelOrganisationSubscription(owner.id, organisation.id, { immediate: true, reason: "Closing the account" });
    expect(cancelledNow.status).toBe("CANCELLED");
    expect(cancelledNow.cancelledAt).not.toBeNull();
    await expect(createTenant(owner.id, organisation.id, { legalName: "Blocked after cancel", countryCode: "GH" })).rejects.toMatchObject({ code: "PM_SUBSCRIPTION_REQUIRED" });
    expect(await db.tenantOrganisation.count({ where: { organisationId: organisation.id } })).toBe(1);
  });

  it("finalizes a scheduled cancellation and expires a lapsed trial during the sweep without charging", async () => {
    const cancelOwner = await registerUser({ displayName: "Sweep Cancel Owner", email: "sweep-cancel-owner@example.com", password: "secure-password-123" });
    const cancelOrg = await createOrganisation(cancelOwner.id, { name: "Sweep Cancel Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await activatePropertyManagement(cancelOrg.id, cancelOwner.id);
    await cancelOrganisationSubscription(cancelOwner.id, cancelOrg.id, { immediate: false });
    await db.organisationSubscription.update({ where: { organisationId: cancelOrg.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });

    const lapsedOwner = await registerUser({ displayName: "Sweep Lapsed Owner", email: "sweep-lapsed-owner@example.com", password: "secure-password-123" });
    const lapsedOrg = await createOrganisation(lapsedOwner.id, { name: "Sweep Lapsed Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await activatePropertyManagement(lapsedOrg.id, lapsedOwner.id);
    await db.organisationSubscription.update({ where: { organisationId: lapsedOrg.id }, data: { trialEndsAt: new Date(Date.now() - 1000), currentPeriodEnd: new Date(Date.now() - 1000) } });

    const summary = await advanceOverdueSubscriptions();
    expect(summary.cancelled).toBeGreaterThanOrEqual(1);
    expect(summary.trialsExpired).toBeGreaterThanOrEqual(1);
    expect((await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: cancelOrg.id } })).status).toBe("CANCELLED");
    expect((await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: lapsedOrg.id } })).status).toBe("EXPIRED");
    expect(await db.subscriptionInvoice.count({ where: { organisationId: lapsedOrg.id } })).toBe(0);
    const again = await advanceOverdueSubscriptions();
    expect(again.trialsExpired).toBe(0);
    expect(again.cancelled).toBe(0);
  });

  it("raises commercial notifications distinct from rent reminders, deliverable through the existing notification pipeline", async () => {
    const owner = await registerUser({ displayName: "Notify Owner", email: "notify-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Notify Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await activatePropertyManagement(organisation.id, owner.id);
    const notification = await db.notification.findFirstOrThrow({ where: { organisationId: organisation.id, eventType: "SUBSCRIPTION_TRIAL_STARTED" } });
    expect(notification.leaseId).toBeNull();
    expect(notification.tenantOrganisationId).toBeNull();
    expect(notification.channel).toBe("IN_APP");
    expect(["LEASE_EXPIRY", "RENT_DUE", "RENT_OVERDUE", "DOCUMENT_EXPIRY", "INSPECTION_DUE", "MAINTENANCE_FOLLOWUP", "PAYMENT_RECEIVED", "PAYMENT_FAILED"]).not.toContain(notification.eventType);
  });

  it("returns a full organisation billing snapshot including plan, usage and limits", async () => {
    const owner = await registerUser({ displayName: "Snapshot Owner", email: "snapshot-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Snapshot Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    expect((await getEntitlementSnapshot(organisation.id)).status).toBe("NOT_ACTIVATED");
    await createProperty(owner.id, organisation.id, { name: "Snapshot property", referenceNumber: "SNP-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A" }, { name: "B" }] });
    const snapshot = await getEntitlementSnapshot(organisation.id);
    expect(snapshot.planKey).toBe("pm_trial");
    expect(snapshot.status).toBe("TRIALING");
    const unitsFeature = snapshot.features.find((feature) => feature.featureKey === ENTITLEMENTS.unitsMax.key)!;
    expect(unitsFeature).toMatchObject({ current: 2, limit: PM_TRIAL_PLAN.allowances.units, isUnlimited: false, reached: false });
  });
});
