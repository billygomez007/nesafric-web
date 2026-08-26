import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation, inviteMember } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createLease } from "./helpers/lease";
import { generateLeaseAgreementPdf } from "@/modules/documents/generation";
import { upsertDocumentTemplate } from "@/modules/documents/templates";
import { upsertIntegrationConfig } from "@/modules/integrations/service";
import {
  assertFeatureEnabled,
  assertWithinLimit,
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

  it("creates a TRIALING subscription on the starter plan automatically when an organisation is created", async () => {
    const owner = await registerUser({ displayName: "Sub Owner", email: "sub-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Sub Organisation", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const subscription = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id }, include: { plan: true } });
    expect(subscription.status).toBe("TRIALING");
    expect(subscription.plan.key).toBe("starter");
    expect(subscription.currencyCode).toBe("GHS");
    expect(subscription.billingProviderKey).toBe("test");
    expect(subscription.trialEndsAt).not.toBeNull();
    expect(subscription.currentPeriodStart.getTime()).toBeLessThanOrEqual(Date.now());
    expect(subscription.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    // No duplicate identity: exactly one subscription per organisation.
    expect(await db.organisationSubscription.count({ where: { organisationId: organisation.id } })).toBe(1);
    const history = await db.subscriptionStatusHistory.findMany({ where: { organisationId: organisation.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: null, toStatus: "TRIALING" });
  });

  it("enforces a numeric plan limit, reports a typed error with upgrade readiness, and never deletes existing records on a blocked attempt", async () => {
    const owner = await registerUser({ displayName: "Limit Owner", email: "limit-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Limit Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    // Starter plan allows 3 properties.
    for (let index = 0; index < 3; index += 1) {
      await createProperty(owner.id, organisation.id, { name: `Property ${index}`, referenceNumber: `LIM-00${index}`, category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    }
    expect(await db.property.count({ where: { organisationId: organisation.id } })).toBe(3);
    await expect(createProperty(owner.id, organisation.id, { name: "One too many", referenceNumber: "LIM-004", category: "Residential", countryCode: "GH", currencyCode: "GHS" }))
      .rejects.toMatchObject({
        code: "ENTITLEMENT_LIMIT_REACHED",
        status: 402,
        details: { feature: ENTITLEMENTS.propertiesMax.key, current: 3, limit: 3, upgradeReady: true },
      });
    // Nothing was deleted by the blocked attempt.
    expect(await db.property.count({ where: { organisationId: organisation.id } })).toBe(3);

    // Upgrading resolves the limit without touching existing properties.
    await changeOrganisationPlan(owner.id, organisation.id, { planKey: "growth" });
    const fourth = await createProperty(owner.id, organisation.id, { name: "Fourth", referenceNumber: "LIM-005", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    expect(fourth).toBeTruthy();
    expect(await db.property.count({ where: { organisationId: organisation.id } })).toBe(4);
  });

  it("allows unlimited usage on a plan with an unlimited entitlement", async () => {
    const owner = await registerUser({ displayName: "Scale Owner", email: "scale-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Scale Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await changeOrganisationPlan(owner.id, organisation.id, { planKey: "scale" });
    const effective = await resolveEntitlement(organisation.id, ENTITLEMENTS.propertiesMax.key);
    expect(effective).toMatchObject({ isUnlimited: true, source: "plan" });
    for (let index = 0; index < 6; index += 1) {
      await createProperty(owner.id, organisation.id, { name: `Scale property ${index}`, referenceNumber: `SCL-00${index}`, category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    }
    expect(await db.property.count({ where: { organisationId: organisation.id } })).toBe(6);
    await expect(assertWithinLimit(organisation.id, ENTITLEMENTS.propertiesMax.key)).resolves.toMatchObject({ isUnlimited: true });
  });

  it("applies an active organisation-specific override ahead of the plan, and stops applying it once revoked or expired", async () => {
    const owner = await registerUser({ displayName: "Override Owner", email: "override-owner@example.com", password: "secure-password-123" });
    const platformUser = await registerUser({ displayName: "Override Platform", email: "override-platform@example.com", password: "secure-password-123" });
    const platformPrincipal = await db.platformPrincipal.create({ data: { userId: platformUser.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
    const organisation = await createOrganisation(owner.id, { name: "Override Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    for (let index = 0; index < 3; index += 1) {
      await createProperty(owner.id, organisation.id, { name: `Override property ${index}`, referenceNumber: `OVR-00${index}`, category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    }
    await expect(createProperty(owner.id, organisation.id, { name: "Blocked", referenceNumber: "OVR-004", category: "Residential", countryCode: "GH", currencyCode: "GHS" })).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED" });

    const override = await db.organisationEntitlementOverride.create({
      data: { organisationId: organisation.id, featureKey: ENTITLEMENTS.propertiesMax.key, kind: "LIMIT", isUnlimited: true, reason: "Promotional override", createdByPlatformPrincipalId: platformPrincipal.id },
    });
    await expect(resolveEntitlement(organisation.id, ENTITLEMENTS.propertiesMax.key)).resolves.toMatchObject({ isUnlimited: true, source: "override" });
    const fourth = await createProperty(owner.id, organisation.id, { name: "Allowed by override", referenceNumber: "OVR-005", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    expect(fourth).toBeTruthy();

    // Revoking the override falls back to the plan limit — existing properties are untouched, but a new one is blocked again.
    await db.organisationEntitlementOverride.update({ where: { id: override.id }, data: { revokedAt: new Date(), revokedByPlatformPrincipalId: platformPrincipal.id } });
    await expect(resolveEntitlement(organisation.id, ENTITLEMENTS.propertiesMax.key)).resolves.toMatchObject({ isUnlimited: false, source: "plan" });
    await expect(createProperty(owner.id, organisation.id, { name: "Blocked again", referenceNumber: "OVR-006", category: "Residential", countryCode: "GH", currencyCode: "GHS" })).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED" });
    expect(await db.property.count({ where: { organisationId: organisation.id } })).toBe(4);

    // An expired override is also ignored.
    await db.organisationEntitlementOverride.create({
      data: { organisationId: organisation.id, featureKey: ENTITLEMENTS.propertiesMax.key, kind: "LIMIT", isUnlimited: true, reason: "Already expired", createdByPlatformPrincipalId: platformPrincipal.id, expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(resolveEntitlement(organisation.id, ENTITLEMENTS.propertiesMax.key)).resolves.toMatchObject({ isUnlimited: false, source: "plan" });
  });

  it("enforces a boolean plan entitlement (third-party integrations) and lifts it via an override", async () => {
    const owner = await registerUser({ displayName: "Bool Owner", email: "bool-owner@example.com", password: "secure-password-123" });
    const platformUser = await registerUser({ displayName: "Bool Platform", email: "bool-platform@example.com", password: "secure-password-123" });
    const platformPrincipal = await db.platformPrincipal.create({ data: { userId: platformUser.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
    const organisation = await createOrganisation(owner.id, { name: "Bool Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
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
    // The owner already occupies 1 of the starter plan's 3 seats.
    const memberA = await registerUser({ displayName: "Member A", email: "team-a@example.com", password: "secure-password-123" });
    const memberB = await registerUser({ displayName: "Member B", email: "team-b@example.com", password: "secure-password-123" });
    await addMember(organisation.id, memberA.id, "property_manager");
    await addMember(organisation.id, memberB.id, "property_manager");
    expect(await db.organisationMember.count({ where: { organisationId: organisation.id, status: "ACTIVE" } })).toBe(3);
    await expect(inviteMember(owner.id, organisation.id, { email: "team-overflow@example.com", roleKey: "viewer" })).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED", details: { feature: ENTITLEMENTS.teamMembersMax.key, current: 3, limit: 3 } });
    expect(await db.organisationMember.count({ where: { organisationId: organisation.id, status: "ACTIVE" } })).toBe(3);
  });

  it("reports downgrade conflicts without deleting any existing record, and blocks further creation until resolved", async () => {
    const owner = await registerUser({ displayName: "Downgrade Owner", email: "downgrade-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Downgrade Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await changeOrganisationPlan(owner.id, organisation.id, { planKey: "growth" });
    for (let index = 0; index < 5; index += 1) {
      await createProperty(owner.id, organisation.id, { name: `Downgrade property ${index}`, referenceNumber: `DWN-00${index}`, category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    }
    const growthPlan = await db.subscriptionPlan.findUniqueOrThrow({ where: { key: "growth" } });
    const starterPlan = await db.subscriptionPlan.findUniqueOrThrow({ where: { key: "starter" } });
    const preview = await previewPlanChangeConflicts(organisation.id, starterPlan.id);
    expect(preview).toContainEqual({ featureKey: ENTITLEMENTS.propertiesMax.key, label: ENTITLEMENTS.propertiesMax.label, current: 5, newLimit: 3 });

    const { subscription, conflicts } = await changeOrganisationPlan(owner.id, organisation.id, { planKey: "starter" });
    expect(subscription.planId).toBe(starterPlan.id);
    expect(conflicts.some((conflict) => conflict.featureKey === ENTITLEMENTS.propertiesMax.key)).toBe(true);
    // Every existing property survives the downgrade untouched.
    expect(await db.property.count({ where: { organisationId: organisation.id } })).toBe(5);
    await expect(createProperty(owner.id, organisation.id, { name: "Still blocked", referenceNumber: "DWN-006", category: "Residential", countryCode: "GH", currencyCode: "GHS" })).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED" });
    expect(growthPlan.id).not.toBe(starterPlan.id);
  });

  it("moves a subscription through the full billing lifecycle: activation, past due, grace period, suspension, and read-only enforcement", async () => {
    const owner = await registerUser({ displayName: "Lifecycle Owner", email: "lifecycle-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Lifecycle Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await createProperty(owner.id, organisation.id, { name: "Existing property", referenceNumber: "LC-001", category: "Residential", countryCode: "GH", currencyCode: "GHS" });

    // Trial -> active, via a successful billing charge.
    const beforePeriodEnd = (await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id } })).currentPeriodEnd;
    const activated = await recordSubscriptionPaymentSuccess(organisation.id, { amountMinor: "25000", currencyCode: "GHS", billingProviderKey: "test", providerInvoiceRef: "inv_test_1" });
    expect(activated.status).toBe("ACTIVE");
    expect(activated.currentPeriodStart.getTime()).toBe(beforePeriodEnd.getTime());
    expect(activated.currentPeriodEnd.getTime()).toBeGreaterThan(beforePeriodEnd.getTime());
    const paidInvoice = await db.subscriptionInvoice.findFirstOrThrow({ where: { organisationId: organisation.id, status: "PAID" } });
    expect(paidInvoice.providerInvoiceRef).toBe("inv_test_1");

    // Active -> past due, via a failed charge.
    const pastDue = await recordSubscriptionPaymentFailure(organisation.id, "Card declined", { billingProviderKey: "test" });
    expect(pastDue.status).toBe("PAST_DUE");
    expect(pastDue.pastDueSince).not.toBeNull();
    expect(await db.subscriptionInvoice.count({ where: { organisationId: organisation.id, status: "FAILED" } })).toBe(1);

    // Past due -> grace period once the elapsed time exceeds the configured window.
    await db.organisationSubscription.update({ where: { organisationId: organisation.id }, data: { pastDueSince: new Date(Date.now() - days(PAST_DUE_TO_GRACE_DAYS + 1)) } });
    await advanceOverdueSubscriptions();
    const inGrace = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id } });
    expect(inGrace.status).toBe("GRACE_PERIOD");
    expect(inGrace.gracePeriodEndsAt).not.toBeNull();
    // Re-running the sweep immediately is a no-op (idempotent) — it does not re-transition an already-graced subscription.
    await advanceOverdueSubscriptions();
    expect((await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id } })).status).toBe("GRACE_PERIOD");

    // Grace period -> suspended once it elapses.
    await db.organisationSubscription.update({ where: { organisationId: organisation.id }, data: { gracePeriodEndsAt: new Date(Date.now() - days(GRACE_PERIOD_DAYS + 1)) } });
    await advanceOverdueSubscriptions();
    const suspended = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id } });
    expect(suspended.status).toBe("SUSPENDED");
    expect(suspended.suspendedAt).not.toBeNull();

    // Suspended is read-only for writes but never blocks reads — existing data is fully preserved.
    await expect(createProperty(owner.id, organisation.id, { name: "Blocked while suspended", referenceNumber: "LC-002", category: "Residential", countryCode: "GH", currencyCode: "GHS" }))
      .rejects.toMatchObject({ code: "ORGANISATION_READ_ONLY", status: 403 });
    expect(await db.property.count({ where: { organisationId: organisation.id } })).toBe(1);
    const stillReadable = await db.property.findMany({ where: { organisationId: organisation.id } });
    expect(stillReadable).toHaveLength(1);

    // A payment success while suspended reactivates the subscription (self-heal).
    const reactivated = await recordSubscriptionPaymentSuccess(organisation.id, { amountMinor: "25000", currencyCode: "GHS", billingProviderKey: "test" });
    expect(reactivated.status).toBe("ACTIVE");
    await expect(createProperty(owner.id, organisation.id, { name: "Allowed again", referenceNumber: "LC-003", category: "Residential", countryCode: "GH", currencyCode: "GHS" })).resolves.toBeTruthy();

    const transitions = (await db.subscriptionStatusHistory.findMany({ where: { organisationId: organisation.id }, orderBy: { createdAt: "asc" } })).map((entry) => `${entry.fromStatus}->${entry.toStatus}`);
    expect(transitions).toEqual(["null->TRIALING", "TRIALING->ACTIVE", "ACTIVE->PAST_DUE", "PAST_DUE->GRACE_PERIOD", "GRACE_PERIOD->SUSPENDED", "SUSPENDED->ACTIVE"]);
  });

  it("supports self-service cancel-at-period-end, immediate cancel, and reversing a scheduled cancellation, and a cancelled subscription is also read-only", async () => {
    const owner = await registerUser({ displayName: "Cancel Owner", email: "cancel-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Cancel Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });

    const scheduled = await cancelOrganisationSubscription(owner.id, organisation.id, { immediate: false, reason: "Trying immediate cancel first" });
    expect(scheduled.cancelAtPeriodEnd).toBe(true);
    expect(scheduled.status).toBe("TRIALING"); // still fully functional until the period ends.
    await expect(createProperty(owner.id, organisation.id, { name: "Still allowed", referenceNumber: "CNL-001", category: "Residential", countryCode: "GH", currencyCode: "GHS" })).resolves.toBeTruthy();

    const reactivated = await reactivateScheduledCancellation(owner.id, organisation.id);
    expect(reactivated.cancelAtPeriodEnd).toBe(false);

    const cancelledNow = await cancelOrganisationSubscription(owner.id, organisation.id, { immediate: true, reason: "Closing the account" });
    expect(cancelledNow.status).toBe("CANCELLED");
    expect(cancelledNow.cancelledAt).not.toBeNull();
    await expect(createProperty(owner.id, organisation.id, { name: "Blocked after cancel", referenceNumber: "CNL-002", category: "Residential", countryCode: "GH", currencyCode: "GHS" })).rejects.toMatchObject({ code: "ORGANISATION_READ_ONLY" });
    expect(await db.property.count({ where: { organisationId: organisation.id } })).toBe(1);
  });

  it("finalizes a scheduled cancellation and converts an ending trial during the deterministic lifecycle sweep, and warns before the trial ends", async () => {
    const cancelOwner = await registerUser({ displayName: "Sweep Cancel Owner", email: "sweep-cancel-owner@example.com", password: "secure-password-123" });
    const cancelOrg = await createOrganisation(cancelOwner.id, { name: "Sweep Cancel Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await cancelOrganisationSubscription(cancelOwner.id, cancelOrg.id, { immediate: false });
    await db.organisationSubscription.update({ where: { organisationId: cancelOrg.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });

    const noticeOwner = await registerUser({ displayName: "Sweep Notice Owner", email: "sweep-notice-owner@example.com", password: "secure-password-123" });
    const noticeOrg = await createOrganisation(noticeOwner.id, { name: "Sweep Notice Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await db.organisationSubscription.update({ where: { organisationId: noticeOrg.id }, data: { trialEndsAt: new Date(Date.now() + days(1)) } });

    const conversionOwner = await registerUser({ displayName: "Sweep Conversion Owner", email: "sweep-conversion-owner@example.com", password: "secure-password-123" });
    const conversionOrg = await createOrganisation(conversionOwner.id, { name: "Sweep Conversion Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await db.organisationSubscription.update({ where: { organisationId: conversionOrg.id }, data: { trialEndsAt: new Date(Date.now() - 1000), currentPeriodEnd: new Date(Date.now() - 1000) } });

    const summary = await advanceOverdueSubscriptions();
    expect(summary.cancelled).toBeGreaterThanOrEqual(1);
    expect(summary.trialNoticesSent).toBeGreaterThanOrEqual(1);
    expect(summary.trialConverted).toBeGreaterThanOrEqual(1);

    expect((await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: cancelOrg.id } })).status).toBe("CANCELLED");
    expect(await db.notification.count({ where: { organisationId: noticeOrg.id, eventType: "SUBSCRIPTION_TRIAL_ENDING" } })).toBe(1);
    // Running the sweep again the same day never sends a duplicate trial-ending notice (dedup).
    await advanceOverdueSubscriptions();
    expect(await db.notification.count({ where: { organisationId: noticeOrg.id, eventType: "SUBSCRIPTION_TRIAL_ENDING" } })).toBe(1);
    const converted = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: conversionOrg.id } });
    expect(converted.status).toBe("ACTIVE");
    expect(await db.subscriptionInvoice.count({ where: { organisationId: conversionOrg.id, status: "PAID" } })).toBe(1);
  });

  it("raises commercial notifications distinct from rent reminders, deliverable through the existing notification pipeline", async () => {
    const owner = await registerUser({ displayName: "Notify Owner", email: "notify-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Notify Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await recordSubscriptionPaymentFailure(organisation.id, "Insufficient funds", { billingProviderKey: "test" });
    const notification = await db.notification.findFirstOrThrow({ where: { organisationId: organisation.id, eventType: "SUBSCRIPTION_BILLING_ISSUE" } });
    expect(notification.leaseId).toBeNull();
    expect(notification.tenantOrganisationId).toBeNull();
    expect(notification.channel).toBe("IN_APP");
    // These commercial event types are distinct from (never mixed up with) rent-reminder event types.
    expect(["LEASE_EXPIRY", "RENT_DUE", "RENT_OVERDUE", "DOCUMENT_EXPIRY", "INSPECTION_DUE", "MAINTENANCE_FOLLOWUP", "PAYMENT_RECEIVED", "PAYMENT_FAILED"]).not.toContain(notification.eventType);
  });

  it("returns a full organisation billing snapshot including plan, usage, limits, and available plans", async () => {
    const owner = await registerUser({ displayName: "Snapshot Owner", email: "snapshot-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Snapshot Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await createProperty(owner.id, organisation.id, { name: "Snapshot property", referenceNumber: "SNP-001", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const snapshot = await getEntitlementSnapshot(organisation.id);
    expect(snapshot.planKey).toBe("starter");
    expect(snapshot.status).toBe("TRIALING");
    const propertiesFeature = snapshot.features.find((feature) => feature.featureKey === ENTITLEMENTS.propertiesMax.key)!;
    expect(propertiesFeature).toMatchObject({ current: 1, limit: 3, isUnlimited: false, reached: false });
  });
});
