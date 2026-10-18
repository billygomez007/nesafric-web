import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createMaintenanceRequest } from "@/modules/maintenance/service";
import { createServiceProvider } from "@/modules/providers/service";
import { inviteNetworkProvider, respondToInvitation } from "@/modules/provider-network/service";
import { createRoutingRule } from "@/modules/maintenance-routing/rules";
import { manualDispatch } from "@/modules/maintenance-routing/oversight";
import { routeMaintenanceRequest } from "@/modules/maintenance-routing/dispatch";
import { advanceReport } from "@/modules/whatsapp-assistant/maintenance/report";
import { setWhatsAppOptOut } from "@/modules/whatsapp-assistant/identity";
import { assistantStateSchema } from "@/modules/whatsapp-assistant/schemas";
import { reviewPortfolioVerificationForPlatform } from "@/modules/platform-admin/service";
import { db } from "@/platform/database/client";
import { createLease } from "./helpers/lease";
import { connectWhatsAppChannel } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge" CASCADE');
  await db.tenant.deleteMany();
}

/** A member holding exactly these permissions (a custom role). */
async function memberWith(organisationId: string, email: string, keys: string[]) {
  const user = await registerUser({ displayName: email, email, password: "secure-password-123" });
  const member = await db.organisationMember.create({ data: { organisationId, userId: user.id } });
  const permissions = await db.permission.findMany({ where: { key: { in: keys } } });
  const role = await db.role.create({ data: { key: `test_${email.replace(/\W/g, "_")}`, name: email, isSystem: false, permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) } } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
  return user;
}

async function fixture() {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
  const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  // The number must be assigned to the organisation already named official.
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
  await connectWhatsAppChannel(staff.id, official.id, { enabled: true, config: { phoneNumberId: "100200300", businessAccountId: "555", marketplaceAssistantEnabled: true } });
  const landlord = await registerUser({ displayName: "Ama Owusu", email: "ama@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(landlord.id, { name: "Owusu Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  const property = await createProperty(landlord.id, organisation.id, { name: "Palm Court", referenceNumber: "PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
  const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
  const plumber = (await respondToInvitation((await inviteNetworkProvider(landlord.id, organisation.id, { displayName: "Kwame Plumbing", phone: "+233201234567", scopeCategories: ["plumbing"], autoDispatchAllowed: true })).id, "+233201234567", true)).providerOrganisationId!;
  // Tables in roles are global; drop roles made by an earlier test of this file.
  await db.role.deleteMany({ where: { key: { startsWith: "test_" }, isSystem: false, memberRoles: { none: {} } } });
  return { staff, official, landlord, organisation, property, unit, plumber };
}

describe("PostgreSQL fixes for the #37 review findings", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_TEMPLATE_WORK_ORDER", "nesafric_work_order:en");
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("requires maintenance.approve to pre-authorise spend in a manual dispatch", async () => {
    const context = await fixture();
    const dispatcher = await memberWith(context.organisation.id, "dispatcher@example.com", ["maintenance.assign", "maintenance.read"]);
    const request = await createMaintenanceRequest(context.landlord.id, context.organisation.id, { propertyId: context.property.id, title: "Leak", description: "Pipe leak", category: "plumbing" }) as { id: string };
    await expect(manualDispatch(dispatcher.id, context.organisation.id, request.id, { providerOrganisationId: context.plumber, authorizationMode: "PRE_AUTHORIZED", authorizedSpendMinor: "9900000" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.maintenanceDispatchAttempt.count()).toBe(0);
    await expect(manualDispatch(dispatcher.id, context.organisation.id, request.id, { providerOrganisationId: context.plumber, authorizationMode: "QUOTE_REQUIRED" })).resolves.toBeTruthy();
  });

  it("requires maintenance.approve to create a rule that pre-authorises spend", async () => {
    const context = await fixture();
    const manager = await memberWith(context.organisation.id, "manager@example.com", ["maintenance.manage", "maintenance.assign", "maintenance.read"]);
    await expect(createRoutingRule(manager.id, context.organisation.id, { name: "Plumbing", category: "plumbing", primaryProviderOrganisationId: context.plumber, authorizationMode: "PRE_AUTHORIZED", spendingCapMinor: "9900000" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.maintenanceRoutingRule.count()).toBe(0);
    await expect(createRoutingRule(manager.id, context.organisation.id, { name: "Plumbing", category: "plumbing", primaryProviderOrganisationId: context.plumber, authorizationMode: "QUOTE_REQUIRED" })).resolves.toBeTruthy();
  });

  it("creates one ticket per confirming message even when two passes run at once", async () => {
    const context = await fixture();
    const tenantUser = await registerUser({ displayName: "Kofi", email: "kofi@example.com", password: "secure-password-123" });
    const { relationship } = await createTenant(context.landlord.id, context.organisation.id, { legalName: "Kofi" });
    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });
    await createLease(context.landlord.id, context.organisation.id, { referenceNumber: "L-1", propertyId: context.property.id, unitId: context.unit.id, tenantOrganisationIds: [relationship.id], startDate: "2026-01-01", rentAmountMinor: "100000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE" });
    const state = assistantStateSchema.parse({ workflow: "report", report: {
      step: "confirm", selected: 0, description: "The kitchen pipe is leaking", media: [],
      choices: [{ tenantOrganisationId: relationship.id, organisationId: context.organisation.id, organisationName: "Owusu Homes", propertyId: context.property.id, propertyName: "Palm Court", unitId: context.unit.id, unitName: "A1" }],
      classification: { category: "plumbing", priority: "URGENT", safetyHazard: false, title: "Kitchen pipe leaking", source: "rules" },
    } });
    const linked = { user: { id: tenantUser.id, displayName: "Kofi" } };
    const reset = () => assistantStateSchema.parse({});
    for (const messageId of ["wamid.race.1", "wamid.race.2", "wamid.race.3"]) {
      const confirm = () => advanceReport({ body: "confirm", kind: "text", messageId }, linked, state, reset);
      const replies = await Promise.all([confirm(), confirm(), confirm()]);
      expect(replies.every((reply) => reply?.reply.includes("is logged with Owusu Homes"))).toBe(true);
      expect(await db.maintenanceRequest.count({ where: { classification: { path: ["sourceMessageId"], equals: messageId } } })).toBe(1);
    }
    expect(await db.maintenanceRequest.count()).toBe(3);
  });

  it("dispatches to, and checks opt-out for, the provider's E.164 number even when the profile stores a local one", async () => {
    const context = await fixture();
    const owner = await registerUser({ displayName: "Yaw", email: "yaw@example.com", password: "secure-password-123" });
    const provider = await createServiceProvider(owner.id, { type: "INDIVIDUAL", displayName: "Yaw Pipes", contactPhone: "0241112223" });
    const accepted = await respondToInvitation((await inviteNetworkProvider(context.landlord.id, context.organisation.id, { displayName: "Yaw Pipes", phone: "+233241112223", existingProviderId: provider.id, scopeCategories: ["hvac"], autoDispatchAllowed: true })).id, "+233241112223", true);
    await createRoutingRule(context.landlord.id, context.organisation.id, { name: "AC", category: "hvac", primaryProviderOrganisationId: accepted.providerOrganisationId, authorizationMode: "QUOTE_REQUIRED" });
    const report = async (title: string) => (await createMaintenanceRequest(context.landlord.id, context.organisation.id, { propertyId: context.property.id, title, description: "The AC is not cooling", category: "air conditioning" }) as { id: string }).id;

    const first = await report("AC not cooling");
    await routeMaintenanceRequest(context.organisation.id, first);
    const firstAttempt = await db.maintenanceDispatchAttempt.findFirstOrThrow({ where: { maintenanceRequestId: first } });
    expect({ status: firstAttempt.status, reason: firstAttempt.reason }).toEqual({ status: "CONTACTED", reason: null });
    expect((await db.messageDelivery.findFirstOrThrow({ where: { message: { externalMessageId: { startsWith: "work-order:" } } } })).recipientAddress).toBe("233241112223");

    await setWhatsAppOptOut(db, "233241112223", true);
    const second = await report("AC noisy");
    await routeMaintenanceRequest(context.organisation.id, second);
    expect(await db.maintenanceDispatchAttempt.findFirstOrThrow({ where: { maintenanceRequestId: second } })).toMatchObject({ status: "CONTACT_FAILED", reason: expect.stringContaining("opted out") });
  });

  it("accepts exactly one decision for a portfolio claim, with its audit records, when two reviewers race", async () => {
    const context = await fixture();
    const reviewers = await Promise.all(["one", "two"].map(async (name) => {
      const user = await registerUser({ displayName: name, email: `${name}@nesafric.example`, password: "secure-password-123" });
      return db.platformPrincipal.create({ data: { userId: user.id, role: "SUPPORT_AGENT", status: "ACTIVE", createdVia: "MANUAL" } });
    }));
    for (let round = 0; round < 3; round += 1) {
      const claim = await db.portfolioVerification.create({ data: { organisationId: context.organisation.id, propertyId: round === 0 ? context.property.id : null, claimedByUserId: context.landlord.id, claim: "OWNER", source: "TEST" } });
      const results = await Promise.allSettled([
        reviewPortfolioVerificationForPlatform(reviewers[0], claim.id, { status: "VERIFIED", note: "Deed checked." }),
        reviewPortfolioVerificationForPlatform(reviewers[1], claim.id, { status: "REJECTED", note: "Deed missing." }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "ALREADY_REVIEWED" } });
      const decided = await db.portfolioVerification.findUniqueOrThrow({ where: { id: claim.id } });
      expect(await db.auditEvent.count({ where: { entityId: claim.id } })).toBe(1);
      expect(await db.platformAuditEvent.count({ where: { entityId: claim.id } })).toBe(1);
      expect((await db.platformAuditEvent.findFirstOrThrow({ where: { entityId: claim.id } })).action).toBe(`platform_admin.portfolio_${decided.status.toLowerCase()}`);
    }
  });
});
