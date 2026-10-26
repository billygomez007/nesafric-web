import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation, inviteMember } from "@/modules/organisations/service";
import { createBuilding, createPortfolio, createProperty, createUnit } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import { NETWORK_CATEGORY_KEYS } from "@/modules/provider-network/categories";
import { createMaintenanceRequest } from "@/modules/maintenance/service";
import { createRoutingRule } from "@/modules/maintenance-routing/rules";
import { routeMaintenanceRequest } from "@/modules/maintenance-routing/dispatch";
import { getPortfolioReport } from "@/modules/reporting/service";
import { upsertIntegrationConfig } from "@/modules/integrations/service";
import { createReminderPolicy, scheduleExpiryReminders } from "@/modules/reminders/service";
import { assertManagementAccess, assertOperational, getEntitlementSnapshot, getUnitUsage } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import { activatePropertyManagement } from "@/modules/subscriptions/activation";
import { advanceOverdueSubscriptions, dueTrialReminder, platformSetSubscriptionStatus, processBillingWebhookEvent } from "@/modules/subscriptions/lifecycle";
import { applyCheckoutPaid, startPlanCheckout } from "@/modules/subscriptions/checkout";
import { cancelOrganisationSubscription, changeOrganisationPlan, getOrganisationBillingSnapshot } from "@/modules/subscriptions/service";
import { PM_BILLING_RULES, PM_PLANS, PM_TRIAL_PLAN } from "@/modules/subscriptions/plan-catalog";
import { billingProviders } from "@/modules/billing/gateways";
import { POST as billingWebhook } from "@/app/api/webhooks/billing/[providerKey]/route";

const DAY = 24 * 60 * 60 * 1000;
const TEST_SECRET = "nesafric-test-billing-webhook-secret";
let sequence = 0;

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

async function owner(label = "owner") {
  sequence += 1;
  return registerUser({ displayName: `PM ${label} ${sequence}`, email: `pm-${label}-${sequence}@example.com`, password: "secure-password-123" });
}

async function landlordOrganisation(label = "landlord") {
  const user = await owner(label);
  const organisation = await createOrganisation(user.id, { name: `PM ${label} ${sequence}`, type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  return { user, organisation };
}

async function addMember(organisationId: string, userId: string, roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const member = await db.organisationMember.create({ data: { organisationId, userId } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
  return member;
}

const units = (count: number, prefix = "U") => Array.from({ length: count }, (_, index) => ({ name: `${prefix}${index + 1}` }));

async function propertyWithUnits(userId: string, organisationId: string, count: number) {
  sequence += 1;
  return createProperty(userId, organisationId, { name: `Block ${sequence}`, referenceNumber: `REF-${sequence}`, category: "Residential", countryCode: "GH", currencyCode: "GHS", units: units(count) });
}

async function subscriptionOf(organisationId: string) {
  return db.organisationSubscription.findUniqueOrThrow({ where: { organisationId }, include: { plan: true } });
}

/** Moves an organisation's trial clock into the past, as if it started `daysAgo` days ago. */
async function ageTrial(organisationId: string, daysAgo: number) {
  const startedAt = new Date(Date.now() - daysAgo * DAY);
  const endsAt = new Date(startedAt.getTime() + PM_BILLING_RULES.trialDays * DAY);
  await db.organisationSubscription.update({ where: { organisationId }, data: { trialStartedAt: startedAt, trialEndsAt: endsAt, currentPeriodStart: startedAt, currentPeriodEnd: endsAt } });
}

async function expireTrial(organisationId: string) {
  await ageTrial(organisationId, PM_BILLING_RULES.trialDays + 1);
  await advanceOverdueSubscriptions();
}

function signed(body: string) {
  return createHmac("sha256", TEST_SECRET).update(body).digest("hex");
}

async function payCheckout(checkoutId: string) {
  const checkout = await db.subscriptionCheckout.findUniqueOrThrow({ where: { id: checkoutId } });
  return processBillingWebhookEvent("test", { eventId: `evt_${checkout.id}`, eventType: "CHECKOUT_PAID", checkoutRef: checkout.providerCheckoutRef, providerInvoiceRef: `inv_${checkout.id}`, amountMinor: checkout.amountMinor.toString(), currencyCode: checkout.currencyCode });
}

async function buyPlan(userId: string, organisationId: string, planKey: string) {
  sequence += 1;
  const { checkout } = await startPlanCheckout(userId, organisationId, { planKey, idempotencyKey: `key-${planKey}-${sequence}` });
  await payCheckout(checkout.id);
  return checkout;
}

describe("Property-management subscriptions, trial and entitlements", () => {
  beforeEach(cleanDatabase);
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  // --- Role eligibility and the marketplace ------------------------------------------------

  it("does not start a trial or create a subscription when an account or organisation is created", async () => {
    const { organisation } = await landlordOrganisation();
    expect(await db.organisationSubscription.count({ where: { organisationId: organisation.id } })).toBe(0);
    expect(await db.managementTrialGrant.count()).toBe(0);
  });

  it("keeps agents and listing-only accounts free: a property without units never triggers a subscription", async () => {
    const user = await owner("agent");
    const agency = await createOrganisation(user.id, { name: "Agency", type: "REAL_ESTATE", countryCode: "GH" });
    await createProperty(user.id, agency.id, { name: "Listing source", referenceNumber: "AG-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    expect(await db.organisationSubscription.count({ where: { organisationId: agency.id } })).toBe(0);
    // Marketplace allowances work without any plan.
    await expect(assertOperational(agency.id, ENTITLEMENTS.listingsMax.key)).resolves.toMatchObject({ isUnlimited: false });
    await expect(assertOperational(agency.id, ENTITLEMENTS.messagesMonthlyMax.key)).resolves.toBeTruthy();
    // A marketplace team can still invite colleagues without a management plan.
    await expect(inviteMember(user.id, agency.id, { email: "colleague@example.com", roleKey: "organisation_owner" })).resolves.toBeTruthy();
  });

  it("never lets a Marketplace professional's backing organisation activate property management", async () => {
    const user = await owner("pro");
    const professional = await createMarketplaceProfessional(user.id, { type: "INDIVIDUAL_AGENT", displayName: "Pro Agent", countryCode: "GH" });
    await expect(activatePropertyManagement(professional.backingOrganisationId, user.id)).rejects.toMatchObject({ code: "PM_NOT_AVAILABLE" });
    expect(await db.organisationSubscription.count({ where: { organisationId: professional.backingOrganisationId } })).toBe(0);
  });

  // --- Trial start, dates and one trial per person ------------------------------------------

  it("starts the 30-day trial on the first managed unit, with exact start and end timestamps and an audit trail", async () => {
    const { user, organisation } = await landlordOrganisation();
    const before = Date.now();
    await propertyWithUnits(user.id, organisation.id, 2);
    const subscription = await subscriptionOf(organisation.id);
    expect(subscription.status).toBe("TRIALING");
    expect(subscription.plan.key).toBe("pm_trial");
    expect(subscription.trialStartedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(subscription.trialEndsAt!.getTime() - subscription.trialStartedAt!.getTime()).toBe(PM_BILLING_RULES.trialDays * DAY);
    expect(await db.managementTrialGrant.count({ where: { organisationId: organisation.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { organisationId: organisation.id, action: "subscription.trial_started" } })).toBe(1);
    expect(await db.subscriptionStatusHistory.count({ where: { organisationId: organisation.id, toStatus: "TRIALING" } })).toBe(1);
    expect(await db.notification.count({ where: { organisationId: organisation.id, eventType: "SUBSCRIPTION_TRIAL_STARTED" } })).toBe(1);
  });

  it("never grants a second trial: repeated activation, a second organisation, staff, or re-registration with the same phone", async () => {
    const { user, organisation } = await landlordOrganisation();
    await db.user.update({ where: { id: user.id }, data: { phoneE164: "+233241110001", phoneVerifiedAt: new Date() } });
    const first = await activatePropertyManagement(organisation.id, user.id);
    const again = await activatePropertyManagement(organisation.id, user.id);
    expect(again.id).toBe(first.id);
    expect(await db.managementTrialGrant.count()).toBe(1);

    // Same owner, second organisation: no new trial.
    const second = await createOrganisation(user.id, { name: "Second org", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    expect((await activatePropertyManagement(second.id, user.id)).status).toBe("EXPIRED");

    // Adding staff never creates a trial; a staff member activating another org they own is matched too.
    const staff = await owner("staff");
    await addMember(organisation.id, staff.id, "property_manager");
    expect(await db.managementTrialGrant.count()).toBe(1);

    // Re-registration: the phone moves to a brand-new account, which opens a new organisation.
    await db.user.update({ where: { id: user.id }, data: { phoneE164: null } });
    const reborn = await owner("reborn");
    await db.user.update({ where: { id: reborn.id }, data: { phoneE164: "+233241110001", phoneVerifiedAt: new Date() } });
    const third = await createOrganisation(reborn.id, { name: "Third org", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const denied = await activatePropertyManagement(third.id, reborn.id);
    expect(denied.status).toBe("EXPIRED");
    expect(await db.auditEvent.count({ where: { action: "subscription.trial_denied" } })).toBe(2);
  });

  it("serialises concurrent activations: one subscription, one trial grant", async () => {
    const { user, organisation } = await landlordOrganisation();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => activatePropertyManagement(organisation.id, user.id)));
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await db.organisationSubscription.count({ where: { organisationId: organisation.id } })).toBe(1);
    expect(await db.managementTrialGrant.count({ where: { organisationId: organisation.id } })).toBe(1);
  });

  // --- Managed units -----------------------------------------------------------------------

  it("counts a 50-flat block as 50 units, ignores archived units and other organisations, and reports usage", async () => {
    const a = await landlordOrganisation("a");
    const b = await landlordOrganisation("b");
    await db.planEntitlement.updateMany({ where: { plan: { key: "pm_trial" }, featureKey: ENTITLEMENTS.unitsMax.key }, data: { limitValue: 60 } });
    try {
      const property = await propertyWithUnits(a.user.id, a.organisation.id, 0);
      await createBuilding(a.user.id, a.organisation.id, property.id, { name: "Block A", units: units(50, "A") });
      await propertyWithUnits(b.user.id, b.organisation.id, 7);
      const archived = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
      await db.unit.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
      expect(await getUnitUsage(a.organisation.id)).toEqual({ current: 49, limit: 60 });
      expect(await getUnitUsage(b.organisation.id)).toEqual({ current: 7, limit: 60 });
    } finally {
      await db.planEntitlement.updateMany({ where: { plan: { key: "pm_trial" }, featureKey: ENTITLEMENTS.unitsMax.key }, data: { limitValue: PM_TRIAL_PLAN.allowances.units } });
    }
  });

  it("blocks the unit past capacity with an upgrade prompt, keeps existing units, and ignores tampered request fields", async () => {
    const { user, organisation } = await landlordOrganisation();
    const property = await propertyWithUnits(user.id, organisation.id, PM_TRIAL_PLAN.allowances.units);
    await expect(createUnit(user.id, organisation.id, property.id, { name: "One more", limit: 1000, planKey: "enterprise", organisationId: "x" } as never))
      .rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED", status: 402, details: { feature: ENTITLEMENTS.unitsMax.key, current: PM_TRIAL_PLAN.allowances.units, limit: PM_TRIAL_PLAN.allowances.units, upgradeReady: true } });
    expect(await db.unit.count({ where: { propertyId: property.id } })).toBe(PM_TRIAL_PLAN.allowances.units);
    expect(await db.notification.count({ where: { organisationId: organisation.id, eventType: "SUBSCRIPTION_UNIT_LIMIT_REACHED" } })).toBe(1);
    // A bulk create that would cross the limit creates nothing.
    await expect(createBuilding(user.id, organisation.id, property.id, { name: "Annex", units: units(3, "X") })).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED" });
    expect(await db.building.count({ where: { name: "Annex" } })).toBe(0);
  });

  it("enforces unit capacity under concurrency: only one of several parallel creates fits the last slot", async () => {
    const { user, organisation } = await landlordOrganisation();
    const property = await propertyWithUnits(user.id, organisation.id, PM_TRIAL_PLAN.allowances.units - 1);
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => createUnit(user.id, organisation.id, property.id, { name: `Race ${index}` })));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(await db.unit.count({ where: { propertyId: property.id, archivedAt: null } })).toBe(PM_TRIAL_PLAN.allowances.units);
  });

  // --- Staff, permissions and plan features ------------------------------------------------

  it("lets staff use the organisation's entitlements within their own role permissions", async () => {
    const { user, organisation } = await landlordOrganisation();
    const property = await propertyWithUnits(user.id, organisation.id, 1);
    const manager = await owner("manager");
    await addMember(organisation.id, manager.id, "property_manager");
    await expect(createUnit(manager.id, organisation.id, property.id, { name: "Staff unit" })).resolves.toBeTruthy();
    // Without billing.manage a staff member cannot buy or change the plan.
    await expect(startPlanCheckout(manager.id, organisation.id, { planKey: "growth", idempotencyKey: "staff-checkout-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(changeOrganisationPlan(manager.id, organisation.id, { planKey: "growth" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("restricts Essential to one admin, one branch and no Growth or Enterprise features", async () => {
    const { user, organisation } = await landlordOrganisation();
    await propertyWithUnits(user.id, organisation.id, 2);
    await buyPlan(user.id, organisation.id, "essential");
    expect((await subscriptionOf(organisation.id)).plan.key).toBe("essential");

    await expect(inviteMember(user.id, organisation.id, { email: "second@example.com", roleKey: "property_manager" })).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED" });
    await createPortfolio(user.id, organisation.id, { name: "Main" });
    await expect(createPortfolio(user.id, organisation.id, { name: "Second branch" })).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED", details: { feature: ENTITLEMENTS.pmBranchesMax.key } });
    await expect(createRoutingRule(user.id, organisation.id, { name: "Plumbing", category: NETWORK_CATEGORY_KEYS[0] })).rejects.toMatchObject({ code: "ENTITLEMENT_FEATURE_DISABLED", details: { feature: ENTITLEMENTS.pmEscalationRulesEnabled.key, upgradeReady: true } });
    await expect(getPortfolioReport(user.id, organisation.id)).rejects.toMatchObject({ code: "ENTITLEMENT_FEATURE_DISABLED" });
    await expect(upsertIntegrationConfig(user.id, organisation.id, { integrationType: "ESIGNATURE", enabled: true })).rejects.toMatchObject({ code: "ENTITLEMENT_FEATURE_DISABLED" });
  });

  it("gives Growth staff, branches and reports but not Enterprise-only integrations", async () => {
    const { user, organisation } = await landlordOrganisation();
    await propertyWithUnits(user.id, organisation.id, 2);
    await buyPlan(user.id, organisation.id, "growth");
    await expect(inviteMember(user.id, organisation.id, { email: "staff@example.com", roleKey: "property_manager" })).resolves.toBeTruthy();
    await createPortfolio(user.id, organisation.id, { name: "Accra" });
    await expect(createPortfolio(user.id, organisation.id, { name: "Kumasi" })).resolves.toBeTruthy();
    await expect(getPortfolioReport(user.id, organisation.id)).resolves.toBeTruthy();
    await expect(upsertIntegrationConfig(user.id, organisation.id, { integrationType: "ESIGNATURE", enabled: true })).rejects.toMatchObject({ code: "ENTITLEMENT_FEATURE_DISABLED", details: { feature: ENTITLEMENTS.integrationsEnabled.key } });
  });

  // --- Trial reminders and expiry ------------------------------------------------------------

  it("picks one reminder per threshold (7, 3, 1 days) and never a burst after a late sweep", () => {
    const now = new Date("2026-11-01T09:00:00Z");
    const at = (days: number) => new Date(now.getTime() + days * DAY);
    expect(dueTrialReminder(at(10), now)).toBeNull();
    expect(dueTrialReminder(at(7), now)).toBe(7);
    expect(dueTrialReminder(at(5), now)).toBe(7);
    expect(dueTrialReminder(at(2.5), now)).toBe(3);
    expect(dueTrialReminder(at(0.5), now)).toBe(1);
    expect(dueTrialReminder(at(-1), now)).toBeNull();
  });

  it("sends each trial reminder once, and none after the owner has paid", async () => {
    const { user, organisation } = await landlordOrganisation();
    await propertyWithUnits(user.id, organisation.id, 1);
    await ageTrial(organisation.id, PM_BILLING_RULES.trialDays - 6);
    await advanceOverdueSubscriptions();
    await advanceOverdueSubscriptions();
    const reminders = () => db.notification.count({ where: { organisationId: organisation.id, eventType: "SUBSCRIPTION_TRIAL_REMINDER" } });
    expect(await reminders()).toBe(1);
    await ageTrial(organisation.id, PM_BILLING_RULES.trialDays - 2);
    await advanceOverdueSubscriptions();
    expect(await reminders()).toBe(2);
    await buyPlan(user.id, organisation.id, "essential");
    await ageTrial(organisation.id, PM_BILLING_RULES.trialDays - 1);
    await db.organisationSubscription.update({ where: { organisationId: organisation.id }, data: { currentPeriodEnd: new Date(Date.now() + 20 * DAY) } });
    await advanceOverdueSubscriptions();
    expect(await reminders()).toBe(2);
  });

  it("expires an unpaid trial without charging, keeps all data, and pauses only management features", async () => {
    const { user, organisation } = await landlordOrganisation();
    const property = await propertyWithUnits(user.id, organisation.id, 3);
    const tenant = await createTenant(user.id, organisation.id, { legalName: "Ama Tenant", countryCode: "GH" });
    await expireTrial(organisation.id);
    const subscription = await subscriptionOf(organisation.id);
    expect(subscription.status).toBe("EXPIRED");
    expect(subscription.expiredAt).not.toBeNull();
    expect(await db.subscriptionInvoice.count({ where: { organisationId: organisation.id } })).toBe(0);
    expect(await db.notification.count({ where: { organisationId: organisation.id, eventType: "SUBSCRIPTION_EXPIRED" } })).toBe(1);

    // Data kept and readable.
    expect(await db.unit.count({ where: { propertyId: property.id } })).toBe(3);
    expect(await db.tenantOrganisation.count({ where: { id: tenant.relationship.id } })).toBe(1);
    // Management operations need a plan.
    await expect(createUnit(user.id, organisation.id, property.id, { name: "New" })).rejects.toMatchObject({ code: "PM_SUBSCRIPTION_REQUIRED", status: 402 });
    await expect(createTenant(user.id, organisation.id, { legalName: "Kofi", countryCode: "GH" })).rejects.toMatchObject({ code: "PM_SUBSCRIPTION_REQUIRED" });
    await expect(createReminderPolicy(user.id, organisation.id, { daysOffset: 30, channels: ["IN_APP"], enabled: true })).rejects.toMatchObject({ code: "PM_SUBSCRIPTION_REQUIRED" });
    // Billing, maintenance capture and the marketplace stay available.
    await expect(getOrganisationBillingSnapshot(user.id, organisation.id)).resolves.toMatchObject({ status: "EXPIRED", entitled: false });
    await expect(createMaintenanceRequest(user.id, organisation.id, { propertyId: property.id, title: "Leaking tap", description: "Tap leaking in kitchen", category: "plumbing", priority: "URGENT" })).resolves.toBeTruthy();
    await expect(createProperty(user.id, organisation.id, { name: "For sale", referenceNumber: "SALE-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" })).resolves.toBeTruthy();
    await expect(assertOperational(organisation.id, ENTITLEMENTS.listingsMax.key)).resolves.toBeTruthy();
  });

  it("pauses automatic dispatch and rent reminders without a plan, and tells the owner instead", async () => {
    const { user, organisation } = await landlordOrganisation();
    const property = await propertyWithUnits(user.id, organisation.id, 1);
    await expireTrial(organisation.id);
    const request = await createMaintenanceRequest(user.id, organisation.id, { propertyId: property.id, title: "No water", description: "No water since morning", category: "plumbing", priority: "URGENT" }) as { id: string };
    await routeMaintenanceRequest(organisation.id, request.id);
    expect(await db.maintenanceRoutingDecision.findFirst({ where: { maintenanceRequestId: request.id }, select: { outcome: true } })).toMatchObject({ outcome: "PLAN_INACTIVE" });
    expect(await db.maintenanceEscalation.count({ where: { maintenanceRequestId: request.id, reason: "PLAN_INACTIVE" } })).toBe(1);
    expect(await db.workOrder.count({ where: { maintenanceRequestId: request.id } })).toBe(0);
    expect(await scheduleExpiryReminders(user.id, organisation.id)).toBe(0);
  });

  // --- Checkout, payment confirmation and failures ------------------------------------------

  it("activates a paid plan only from a verified webhook, never from starting checkout, and prices it on the server", async () => {
    const { user, organisation } = await landlordOrganisation();
    await propertyWithUnits(user.id, organisation.id, 1);
    await expireTrial(organisation.id);
    await expect(startPlanCheckout(user.id, organisation.id, { planKey: "growth", idempotencyKey: "tamper-1", amountMinor: "1" })).rejects.toThrow();
    const { checkout } = await startPlanCheckout(user.id, organisation.id, { planKey: "growth", idempotencyKey: "pay-growth-1" });
    expect(checkout.amountMinor.toString()).toBe(String(PM_PLANS.growth.monthlyPriceMinor));
    expect(checkout.checkoutUrl).toContain(checkout.id);
    const pending = await subscriptionOf(organisation.id);
    expect(pending.status).toBe("PAYMENT_PENDING");
    await expect(assertManagementAccess(organisation.id, user.id)).rejects.toMatchObject({ code: "PM_SUBSCRIPTION_REQUIRED" });

    // The same idempotency key returns the same checkout.
    const again = await startPlanCheckout(user.id, organisation.id, { planKey: "growth", idempotencyKey: "pay-growth-1" });
    expect(again.checkout.id).toBe(checkout.id);

    // A webhook reporting a different amount grants nothing.
    const mismatched = await processBillingWebhookEvent("test", { eventId: "evt-mismatch", eventType: "CHECKOUT_PAID", checkoutRef: checkout.providerCheckoutRef, amountMinor: "100", currencyCode: "GHS" });
    expect(mismatched.status).toBe("MISMATCHED");
    expect((await subscriptionOf(organisation.id)).status).toBe("PAYMENT_PENDING");

    // The real confirmation, delivered through the signed route, activates the plan once.
    const body = JSON.stringify({ eventId: "evt-paid-growth", eventType: "CHECKOUT_PAID", checkoutRef: checkout.providerCheckoutRef, providerInvoiceRef: "inv-growth-1", amountMinor: checkout.amountMinor.toString(), currencyCode: "GHS" });
    const unsigned = await billingWebhook(new Request("http://localhost/api/webhooks/billing/test", { method: "POST", body }), { params: Promise.resolve({ providerKey: "test" }) });
    expect(unsigned.status).toBe(401);
    const response = await billingWebhook(new Request("http://localhost/api/webhooks/billing/test", { method: "POST", body, headers: { "x-billing-signature": signed(body) } }), { params: Promise.resolve({ providerKey: "test" }) });
    expect(response.status).toBe(200);
    const replay = await billingWebhook(new Request("http://localhost/api/webhooks/billing/test", { method: "POST", body, headers: { "x-billing-signature": signed(body) } }), { params: Promise.resolve({ providerKey: "test" }) });
    expect(replay.status).toBe(200);
    const active = await subscriptionOf(organisation.id);
    expect(active.status).toBe("ACTIVE");
    expect(active.plan.key).toBe("growth");
    expect(await db.subscriptionInvoice.count({ where: { organisationId: organisation.id, status: "PAID" } })).toBe(1);
    expect(await applyCheckoutPaid(checkout.id, { amountMinor: checkout.amountMinor.toString(), currencyCode: "GHS" })).toBe("ALREADY_APPLIED");
    expect(await db.auditEvent.count({ where: { organisationId: organisation.id, action: "subscription.activated" } })).toBe(1);
  });

  it("grants nothing on a failed payment and allows a safe retry", async () => {
    const { user, organisation } = await landlordOrganisation();
    await propertyWithUnits(user.id, organisation.id, 1);
    await expireTrial(organisation.id);
    const { checkout } = await startPlanCheckout(user.id, organisation.id, { planKey: "essential", idempotencyKey: "fail-1-checkout" });
    await processBillingWebhookEvent("test", { eventId: "evt-fail-1", eventType: "CHECKOUT_FAILED", checkoutRef: checkout.providerCheckoutRef, failureReason: "Declined by the wallet." });
    expect((await db.subscriptionCheckout.findUniqueOrThrow({ where: { id: checkout.id } })).status).toBe("FAILED");
    expect((await subscriptionOf(organisation.id)).status).toBe("EXPIRED");
    expect(await db.notification.count({ where: { organisationId: organisation.id, eventType: "SUBSCRIPTION_PAYMENT_FAILED" } })).toBe(1);
    const retry = await startPlanCheckout(user.id, organisation.id, { planKey: "essential", idempotencyKey: "fail-2-checkout" });
    await payCheckout(retry.checkout.id);
    expect((await subscriptionOf(organisation.id)).status).toBe("ACTIVE");
  });

  it("expires an unconfirmed checkout and returns the organisation to payment required", async () => {
    const { user, organisation } = await landlordOrganisation();
    await propertyWithUnits(user.id, organisation.id, 1);
    await expireTrial(organisation.id);
    const { checkout } = await startPlanCheckout(user.id, organisation.id, { planKey: "essential", idempotencyKey: "stale-1-checkout" });
    await advanceOverdueSubscriptions(new Date(Date.now() + (PM_BILLING_RULES.checkoutExpiryHours + 1) * 60 * 60 * 1000));
    expect((await db.subscriptionCheckout.findUniqueOrThrow({ where: { id: checkout.id } })).status).toBe("EXPIRED");
    expect((await subscriptionOf(organisation.id)).status).toBe("EXPIRED");
  });

  it("keeps the remaining trial days when the owner pays during the trial", async () => {
    const { user, organisation } = await landlordOrganisation();
    await propertyWithUnits(user.id, organisation.id, 1);
    const trialEndsAt = (await subscriptionOf(organisation.id)).trialEndsAt!;
    await changeOrganisationPlan(user.id, organisation.id, { planKey: "growth" });
    expect((await subscriptionOf(organisation.id)).selectedPlanId).not.toBeNull();
    expect((await subscriptionOf(organisation.id)).status).toBe("TRIALING");
    await buyPlan(user.id, organisation.id, "growth");
    const active = await subscriptionOf(organisation.id);
    expect(active.status).toBe("ACTIVE");
    const expectedEnd = new Date(trialEndsAt);
    expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + 1);
    expect(active.currentPeriodEnd.getTime()).toBe(expectedEnd.getTime());
  });

  // --- Renewal, grace, cancellation, upgrade and downgrade ----------------------------------

  it("moves an unpaid renewal through past due and grace to expired, and a renewal payment during grace restores it", async () => {
    const { user, organisation } = await landlordOrganisation();
    await propertyWithUnits(user.id, organisation.id, 1);
    await expireTrial(organisation.id);
    await buyPlan(user.id, organisation.id, "essential");
    const periodEnd = (await subscriptionOf(organisation.id)).currentPeriodEnd;
    await advanceOverdueSubscriptions(new Date(periodEnd.getTime() + 1000));
    expect((await subscriptionOf(organisation.id)).status).toBe("PAST_DUE");
    await assertManagementAccess(organisation.id, user.id); // still working while past due
    await advanceOverdueSubscriptions(new Date(periodEnd.getTime() + (PM_BILLING_RULES.pastDueDays + 1) * DAY));
    expect((await subscriptionOf(organisation.id)).status).toBe("GRACE_PERIOD");
    await buyPlan(user.id, organisation.id, "essential");
    const renewed = await subscriptionOf(organisation.id);
    expect(renewed.status).toBe("ACTIVE");
    expect(renewed.currentPeriodStart.getTime()).toBe(periodEnd.getTime());

    // And without payment the grace period ends in EXPIRED, never SUSPENDED.
    const second = await landlordOrganisation("grace");
    await propertyWithUnits(second.user.id, second.organisation.id, 1);
    await expireTrial(second.organisation.id);
    await buyPlan(second.user.id, second.organisation.id, "essential");
    const end = (await subscriptionOf(second.organisation.id)).currentPeriodEnd;
    await advanceOverdueSubscriptions(new Date(end.getTime() + 1000));
    await advanceOverdueSubscriptions(new Date(end.getTime() + (PM_BILLING_RULES.pastDueDays + 1) * DAY));
    const graceEnds = (await subscriptionOf(second.organisation.id)).gracePeriodEndsAt!;
    const summary = await advanceOverdueSubscriptions(new Date(graceEnds.getTime() + 1000));
    expect(summary.expired).toBeGreaterThanOrEqual(1);
    expect((await subscriptionOf(second.organisation.id)).status).toBe("EXPIRED");
    // A repeated sweep is a no-op.
    const repeat = await advanceOverdueSubscriptions(new Date(graceEnds.getTime() + 2000));
    expect(repeat.expired).toBe(0);
  });

  it("cancels at the end of the period with access until then and data kept afterwards", async () => {
    const { user, organisation } = await landlordOrganisation();
    const property = await propertyWithUnits(user.id, organisation.id, 2);
    await expireTrial(organisation.id);
    await buyPlan(user.id, organisation.id, "essential");
    await cancelOrganisationSubscription(user.id, organisation.id, { immediate: false });
    await assertManagementAccess(organisation.id, user.id);
    const end = (await subscriptionOf(organisation.id)).currentPeriodEnd;
    await advanceOverdueSubscriptions(new Date(end.getTime() + 1000));
    const cancelled = await subscriptionOf(organisation.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(await db.unit.count({ where: { propertyId: property.id } })).toBe(2);
    await expect(assertManagementAccess(organisation.id, user.id)).rejects.toMatchObject({ code: "PM_SUBSCRIPTION_REQUIRED" });
  });

  it("upgrades on payment and schedules a downgrade for renewal, keeping data and blocking new units over the limit", async () => {
    const { user, organisation } = await landlordOrganisation();
    await propertyWithUnits(user.id, organisation.id, PM_TRIAL_PLAN.allowances.units);
    await expireTrial(organisation.id);
    await buyPlan(user.id, organisation.id, "essential");
    await expect(changeOrganisationPlan(user.id, organisation.id, { planKey: "growth" })).rejects.toMatchObject({ code: "PLAN_UPGRADE_REQUIRES_PAYMENT" });
    await buyPlan(user.id, organisation.id, "growth");
    expect((await subscriptionOf(organisation.id)).plan.key).toBe("growth");
    const property = await propertyWithUnits(user.id, organisation.id, 10);

    const scheduled = await changeOrganisationPlan(user.id, organisation.id, { planKey: "essential" });
    expect(scheduled.effect).toBe("SCHEDULED");
    expect(scheduled.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ featureKey: ENTITLEMENTS.unitsMax.key, current: PM_TRIAL_PLAN.allowances.units + 10, newLimit: PM_PLANS.essential.allowances.units })]));
    expect((await subscriptionOf(organisation.id)).plan.key).toBe("growth");
    await expect(startPlanCheckout(user.id, organisation.id, { planKey: "essential", idempotencyKey: "early-downgrade" })).rejects.toMatchObject({ code: "PLAN_DOWNGRADE_SCHEDULED_ONLY" });

    // At renewal (paid by checkout for the scheduled plan) the downgrade takes effect.
    const end = (await subscriptionOf(organisation.id)).currentPeriodEnd;
    await advanceOverdueSubscriptions(new Date(end.getTime() + 1000));
    await buyPlan(user.id, organisation.id, "essential");
    const downgraded = await subscriptionOf(organisation.id);
    expect(downgraded.plan.key).toBe("essential");
    expect(await db.unit.count({ where: { property: { organisationId: organisation.id } } })).toBe(PM_TRIAL_PLAN.allowances.units + 10);
    await expect(createUnit(user.id, organisation.id, property.id, { name: "Over" })).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT_REACHED" });
  });

  // --- Isolation, providers and platform controls ---------------------------------------------

  it("isolates organisations: a user of one organisation cannot read or buy plans for another", async () => {
    const a = await landlordOrganisation("iso-a");
    const b = await landlordOrganisation("iso-b");
    await propertyWithUnits(b.user.id, b.organisation.id, 1);
    await expect(getOrganisationBillingSnapshot(a.user.id, b.organisation.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startPlanCheckout(a.user.id, b.organisation.id, { planKey: "growth", idempotencyKey: "cross-org" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(propertyWithUnits(a.user.id, b.organisation.id, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses the deterministic test billing provider in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const adapter = billingProviders.get("test");
    expect(adapter.isConfigured()).toBe(false);
    const body = JSON.stringify({ eventId: "x", eventType: "CHECKOUT_PAID", checkoutRef: "chk" });
    expect(adapter.verifyWebhookSignature(body, { "x-billing-signature": signed(body) })).toMatchObject({ verified: false });
  });

  it("never grants a paid plan when a platform operator resumes a suspended trial-expired organisation", async () => {
    const { user, organisation } = await landlordOrganisation();
    await propertyWithUnits(user.id, organisation.id, 1);
    await expireTrial(organisation.id);
    const principalUser = await owner("operator");
    const principal = await db.platformPrincipal.create({ data: { userId: principalUser.id, role: "SUPER_ADMIN", createdVia: "MANUAL" } });
    await platformSetSubscriptionStatus(principal.id, organisation.id, "SUSPENDED", "Abuse review");
    const resumed = await platformSetSubscriptionStatus(principal.id, organisation.id, "RESUME", "Review closed");
    expect(resumed.status).toBe("EXPIRED");
  });

  it("shows the billing snapshot with plans from configuration, unit usage and trial dates", async () => {
    const { user, organisation } = await landlordOrganisation();
    await propertyWithUnits(user.id, organisation.id, 18);
    const snapshot = await getOrganisationBillingSnapshot(user.id, organisation.id);
    expect(snapshot.units).toEqual({ current: 18, limit: PM_TRIAL_PLAN.allowances.units });
    expect(snapshot.plans.map((plan) => plan.key)).toEqual(["essential", "growth", "enterprise"]);
    expect(snapshot.plans.find((plan) => plan.key === "growth")).toMatchObject({ recommended: true, units: PM_PLANS.growth.allowances.units, monthlyPriceMinor: String(PM_PLANS.growth.monthlyPriceMinor) });
    expect(snapshot.trialEndsAt).not.toBeNull();
    const entitlements = await getEntitlementSnapshot(organisation.id);
    expect(entitlements.features.every((feature) => !feature.isUnlimited)).toBe(true);
  });
});
