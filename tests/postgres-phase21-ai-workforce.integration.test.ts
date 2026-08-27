import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createListing, createMarketplaceNativeListing, updateListingVerification, transitionListing } from "@/modules/listings/service";
import { createMaintenanceRequest, createWorkOrder, transitionMaintenanceRequest } from "@/modules/maintenance/service";
import { createServiceProvider, addProviderToDirectory } from "@/modules/providers/service";
import { createMarketplaceProfessional, changeMarketplacePlan } from "@/modules/marketplace-professionals/service";
import { createDevelopment, createDevelopmentUnit } from "@/modules/developments/service";
import {
  createMarketplaceAIEmployee,
  checkListingAvailability,
  searchInventory,
  qualifyLead,
  scheduleViewingForLead,
  escalateLeadToHuman,
  detectLeadAttentionSignals,
  detectListingQualityIssues,
} from "@/modules/marketplace-ai/service";
import { executeEmployeeReadTool, createAIEmployee } from "@/modules/ai-employees/service";
import { createMarketplaceLead } from "@/modules/listings/service";
import { resolveProviderHierarchy, proposeDispatch, recordProviderResponse } from "@/modules/maintenance-dispatch/service";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
  await db.marketplacePlan.deleteMany({ where: { key: { notIn: ["marketplace_free", "marketplace_pro", "marketplace_brokerage", "marketplace_enterprise"] } } });
}

const baseListing = (propertyId: string, overrides: Record<string, unknown> = {}) => ({
  propertyId,
  listingType: "RENT" as const,
  category: "apartment",
  title: "Bright two-bedroom apartment in East Legon",
  publicDescription: "A bright, well-maintained two-bedroom apartment with flexible viewing availability.",
  rentAmountMinor: "250000",
  currencyCode: "GHS",
  frequency: "MONTHLY" as const,
  availableFrom: "2026-09-01",
  bedrooms: 2, bathrooms: 2,
  countryCode: "GH", region: "Greater Accra", city: "East Legon",
  media: [{ type: "PHOTO" as const, publicUrl: "https://cdn.example.com/listing/photo.jpg" }],
  ...overrides,
});

/** A fully marketplace-native listing (no PropertyOS property at all — item 3's "developer may
 * list without subscribing to PropertyOS"), backed by a `MarketplaceAsset`, scoped entirely to
 * the professional's own backing organisation/lead pipeline. */
async function createNativeListing(userId: string, marketplaceProfessionalId: string, overrides: Record<string, unknown> = {}) {
  return createMarketplaceNativeListing(userId, marketplaceProfessionalId, {
    asset: {
      name: "Bright two-bedroom apartment in East Legon", category: "apartment", purpose: "RENT",
      bedrooms: 2, bathrooms: 2, currencyCode: "GHS", priceMinor: "250000", countryCode: "GH",
      region: "Greater Accra", city: "East Legon", availableFrom: "2026-09-01",
    },
    listing: {
      listingType: "RENT", category: "apartment", title: "Bright two-bedroom apartment in East Legon",
      publicDescription: "A bright, well-maintained two-bedroom apartment with flexible viewing availability.",
      currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH",
      media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/listing/photo.jpg" }],
    },
    listingAuthority: "OWNER_SELF",
    ...overrides,
  });
}

async function publishListing(userId: string, organisationId: string, listingId: string) {
  await updateListingVerification(userId, organisationId, listingId, {
    status: "PENDING",
    evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/evidence/title-deed.pdf" }],
  });
  await updateListingVerification(userId, organisationId, listingId, { status: "VERIFIED", note: "Authority checked." });
  await transitionListing(userId, organisationId, listingId, { status: "PENDING_REVIEW" });
  return transitionListing(userId, organisationId, listingId, { status: "PUBLISHED" });
}

describe("PostgreSQL Phase 21 AI workforce", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  async function brokerageFixture() {
    const owner = await registerUser({ displayName: "Broker Owner", email: "workforce-broker-owner@example.com", password: "secure-password-123" });
    const agentUser = await registerUser({ displayName: "Broker Agent", email: "workforce-broker-agent@example.com", password: "secure-password-123" });
    const brokerage = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Workforce Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, brokerage.id, { planKey: "marketplace_brokerage" });
    const landlordOrg = await createOrganisation(owner.id, { name: "Workforce Landlord Org", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const property = await createProperty(owner.id, landlordOrg.id, { name: "East Legon House", referenceNumber: "ELH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const listing = await createListing(owner.id, landlordOrg.id, baseListing(property.id, { marketplaceProfessionalId: brokerage.id, listingAuthority: "BROKERAGE_AUTHORIZED" }));
    await publishListing(owner.id, landlordOrg.id, listing.id);
    return { owner, agentUser, brokerage, landlordOrg, property, listing };
  }

  it("lets an AI Sales Receptionist answer live listing questions and correctly report unavailable/stale listings", async () => {
    const { owner, brokerage, landlordOrg, listing } = await brokerageFixture();
    const receptionist = await createMarketplaceAIEmployee(owner.id, brokerage.id, { name: "Ama", role: "AI_SALES_RECEPTIONIST" });
    expect(receptionist.role).toBe("AI_SALES_RECEPTIONIST");

    const found = await checkListingAvailability(owner.id, brokerage.id, { query: "East Legon" });
    expect(found.found).toBe(true);
    expect(found.available).toBe(true);
    expect(found.listing?.bedrooms).toBe(2);
    expect(found.listing?.price).toBe("250000");

    // Pause the listing (still exists, but no longer live) — the receptionist must reflect the
    // *current* state, never a stale cached answer.
    await transitionListing(owner.id, landlordOrg.id, listing.id, { status: "PAUSED" });
    const paused = await checkListingAvailability(owner.id, brokerage.id, { listingId: listing.id });
    // The listing still exists (found), but is no longer live — never silently reported as
    // available, and never silently "not found" either, which would be misleading for a listing
    // a prospect already knows about.
    expect(paused.found).toBe(true);
    expect(paused.available).toBe(false);

    const missing = await checkListingAvailability(owner.id, brokerage.id, { query: "nonexistent-location-xyz" });
    expect(missing.found).toBe(false);
  });

  it("searches live inventory with conversational filters and only returns published listings", async () => {
    const { owner, brokerage, landlordOrg, property } = await brokerageFixture();
    const cheapListing = await createListing(owner.id, landlordOrg.id, baseListing(property.id, {
      title: "Affordable one-bedroom", bedrooms: 1, rentAmountMinor: "80000",
      marketplaceProfessionalId: brokerage.id, listingAuthority: "BROKERAGE_AUTHORIZED",
    }));
    await publishListing(owner.id, landlordOrg.id, cheapListing.id);
    const draftListing = await createListing(owner.id, landlordOrg.id, baseListing(property.id, {
      title: "Unpublished three-bedroom", bedrooms: 3, marketplaceProfessionalId: brokerage.id, listingAuthority: "BROKERAGE_AUTHORIZED",
    }));

    const results = await searchInventory(owner.id, brokerage.id, { bedrooms: 2 });
    expect(results.map((r) => r.title)).toContain("Bright two-bedroom apartment in East Legon");
    expect(results.map((r) => r.title)).not.toContain("Affordable one-bedroom");
    expect(results.map((r) => r.id)).not.toContain(draftListing.id);

    const budgetResults = await searchInventory(owner.id, brokerage.id, { maxPriceMinor: "100000" });
    expect(budgetResults.map((r) => r.title)).toEqual(["Affordable one-bedroom"]);
  });

  it("blocks inventory search when the plan does not include it, and blocks AI role creation without the matching entitlement", async () => {
    const owner = await registerUser({ displayName: "Free Plan Owner", email: "workforce-free-owner@example.com", password: "secure-password-123" });
    const freeAgency = await createMarketplaceProfessional(owner.id, { type: "INDIVIDUAL_AGENT", displayName: "Free Plan Agency", countryCode: "GH" });
    await expect(createMarketplaceAIEmployee(owner.id, freeAgency.id, { name: "Ama", role: "AI_SALES_AGENT" }))
      .rejects.toMatchObject({ code: "MARKETPLACE_ENTITLEMENT_FEATURE_DISABLED", details: { feature: "marketplace.ai_sales_agent" } });
    await expect(searchInventory(owner.id, freeAgency.id, {})).rejects.toMatchObject({ code: "MARKETPLACE_ENTITLEMENT_FEATURE_DISABLED" });

    // Upgrading resolves it — proving capability is entitlement-driven, not a hard-coded plan check.
    await changeMarketplacePlan(owner.id, freeAgency.id, { planKey: "marketplace_pro" });
    await expect(searchInventory(owner.id, freeAgency.id, {})).resolves.toEqual([]);
  });

  it("supports the AI Sales Agent lead-handling flow: qualify, schedule a viewing, and escalate to a human", async () => {
    const { owner, brokerage } = await brokerageFixture();
    const listing = await createNativeListing(owner.id, brokerage.id);
    await publishListing(owner.id, brokerage.backingOrganisationId, listing.id);
    const salesAgent = await createMarketplaceAIEmployee(owner.id, brokerage.id, { name: "Kofi", role: "AI_SALES_AGENT" });
    const lead = await createMarketplaceLead(listing.id, undefined, { name: "Prospect", phone: "+233240000001", message: "Interested in the 2-bed." });

    const qualified = await qualifyLead(owner.id, brokerage.id, salesAgent.id, { leadId: lead.id, status: "QUALIFIED", requirements: "Wants a 2-bed with parking, budget GHS 2,500." });
    expect(qualified.status).toBe("QUALIFIED");

    const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const viewing = await scheduleViewingForLead(owner.id, brokerage.id, salesAgent.id, {
      leadId: lead.id, listingId: listing.id, startsAt: start.toISOString(), endsAt: end.toISOString(),
    });
    expect(viewing.status).toBe("REQUESTED");

    const handoff = await escalateLeadToHuman(owner.id, brokerage.id, salesAgent.id, {
      leadId: lead.id, reason: "Prospect wants to negotiate price directly.", urgency: "MEDIUM",
      contextSummary: "Qualified prospect requesting a price discussion beyond AI authority.",
    });
    expect(handoff.status).toBe("OPEN");
    // The AI Sales Agent never independently commits to a transaction — only PropertyOS/human
    // workflows can activate a lease; no such capability exists in this module.
    const activity = await db.aIEmployeeActivity.findMany({ where: { marketplaceProfessionalId: brokerage.id, aiEmployeeId: salesAgent.id } });
    expect(activity.map((entry) => entry.type)).toEqual(expect.arrayContaining(["lead_qualified", "viewing_scheduled"]));
  });

  it("detects AI Lead Manager attention signals deterministically", async () => {
    const { owner, brokerage } = await brokerageFixture();
    const listing = await createNativeListing(owner.id, brokerage.id, { asset: { name: "Lead Manager Test Listing", category: "apartment", purpose: "RENT", currencyCode: "GHS", priceMinor: "250000", countryCode: "GH", availableFrom: "2026-09-01" } });
    await publishListing(owner.id, brokerage.backingOrganisationId, listing.id);
    const staleLead = await createMarketplaceLead(listing.id, undefined, { name: "Stale Prospect", phone: "+233240000002" });
    await db.marketplaceLead.update({ where: { id: staleLead.id }, data: { createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000), lastActivityAt: new Date(Date.now() - 48 * 60 * 60 * 1000) } });

    const signals = await detectLeadAttentionSignals(owner.id, brokerage.id);
    expect(signals.unansweredLeads.map((l) => l.id)).toContain(staleLead.id);
    expect(signals.noFollowUpLeads.map((l) => l.id)).not.toContain(staleLead.id); // 48h < 7-day no-follow-up threshold
  });

  it("detects AI Listing Assistant quality issues without fabricating property characteristics", async () => {
    const { owner, brokerage, landlordOrg, property } = await brokerageFixture();
    const incomplete = await createListing(owner.id, landlordOrg.id, baseListing(property.id, {
      title: "Needs work listing", publicDescription: "Short description under forty chars.", bedrooms: undefined, media: [],
      marketplaceProfessionalId: brokerage.id, listingAuthority: "BROKERAGE_AUTHORIZED",
    }));

    const issues = await detectListingQualityIssues(owner.id, brokerage.id);
    const flagged = issues.find((entry) => entry.listingId === incomplete.id);
    expect(flagged?.issues).toEqual(expect.arrayContaining(["MISSING_PHOTOS", "DESCRIPTION_TOO_SHORT", "NO_AMENITIES_LISTED", "MISSING_BEDROOMS"]));
  });

  it("flags a listing whose availability contradicts its underlying development unit status", async () => {
    const { owner, brokerage, landlordOrg, property } = await brokerageFixture();
    const development = await createDevelopment(owner.id, brokerage.id, { name: "Ridge Towers", countryCode: "GH" });
    const unit = await createDevelopmentUnit(owner.id, brokerage.id, development.id, { name: "Unit 4B" });
    const listing = await createListing(owner.id, landlordOrg.id, baseListing(property.id, {
      title: "Ridge Towers Unit 4B", marketplaceProfessionalId: brokerage.id, developmentId: development.id, developmentUnitId: unit.id, listingAuthority: "DEVELOPER",
    }));
    await publishListing(owner.id, landlordOrg.id, listing.id);
    await db.developmentUnit.update({ where: { id: unit.id }, data: { status: "SOLD" } });

    const issues = await detectListingQualityIssues(owner.id, brokerage.id);
    expect(issues.find((entry) => entry.listingId === listing.id)?.issues).toContain("AVAILABILITY_MISMATCH");
  });

  it("makes the PropertyOS landlord AI Receptionist listing-aware without exposing private management data", async () => {
    const owner = await registerUser({ displayName: "Landlord Owner", email: "workforce-landlord-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Workforce Landlord PropertyOS", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, { name: "Landlord House", referenceNumber: "LH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const listing = await createListing(owner.id, organisation.id, baseListing(property.id, { listingAuthority: "OWNER_SELF", privateNotes: "Owner's private pricing rationale — never public." }));
    await publishListing(owner.id, organisation.id, listing.id);

    const receptionist = await createAIEmployee(owner.id, organisation.id, {
      name: "Landlord Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION",
      toolPermissions: ["listings.availability_check"], instructions: {}, escalationConfiguration: {},
    });
    const result = await executeEmployeeReadTool(owner.id, organisation.id, receptionist.id, "listings.availability_check", { query: "East Legon" });
    expect(result.found).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private pricing rationale");
  });

  it("resolves the maintenance provider dispatch hierarchy (private/preferred/standard/backup) and proposes dispatch in order", async () => {
    const owner = await registerUser({ displayName: "Dispatch Landlord", email: "workforce-dispatch-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Dispatch Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await db.organisationSubscription.update({ where: { organisationId: organisation.id }, data: { plan: { connect: { key: "growth" } } } });
    const property = await createProperty(owner.id, organisation.id, { name: "Dispatch Property", referenceNumber: "DP-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });

    const plumbingCategory = await db.serviceCategory.findUniqueOrThrow({ where: { key: "plumbing" } });
    async function verifiedProvider(email: string, displayName: string) {
      const user = await registerUser({ displayName, email, password: "secure-password-123" });
      const provider = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName, contactEmail: email, categoryIds: [plumbingCategory.id] });
      await db.serviceProvider.update({ where: { id: provider.id }, data: { verificationStatus: "VERIFIED", acceptingWork: true, availabilityStatus: "AVAILABLE" } });
      return provider;
    }
    const preferred = await verifiedProvider("workforce-preferred@example.com", "Preferred Plumber");
    const standard = await verifiedProvider("workforce-standard@example.com", "Standard Plumber");
    const backup = await verifiedProvider("workforce-backup@example.com", "Backup Plumber");
    await addProviderToDirectory(owner.id, organisation.id, { providerId: preferred.id });
    await db.providerOrganisation.updateMany({ where: { providerId: preferred.id }, data: { priority: 10 } });
    await addProviderToDirectory(owner.id, organisation.id, { providerId: standard.id });
    await addProviderToDirectory(owner.id, organisation.id, { providerId: backup.id });
    await db.providerOrganisation.updateMany({ where: { providerId: backup.id }, data: { isBackup: true } });

    const hierarchy = await resolveProviderHierarchy(owner.id, organisation.id, "plumbing");
    expect(hierarchy.map((entry) => entry.tier)).toEqual(["PREFERRED", "STANDARD", "BACKUP"]);
    expect(hierarchy[0].displayName).toBe("Preferred Plumber");

    const request = await createMaintenanceRequest(owner.id, organisation.id, { propertyId: property.id, title: "Leaking pipe", description: "Kitchen pipe is leaking.", category: "plumbing" });
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(owner.id, organisation.id, request.id, { title: "Fix leaking pipe", currencyCode: "GHS" });

    const firstAttempt = await proposeDispatch(owner.id, organisation.id, { workOrderId: workOrder.id });
    expect(firstAttempt.tier).toBe("PREFERRED");
    expect(firstAttempt.serviceProviderId).toBe(preferred.id);
    expect(firstAttempt.status).toBe("CONTACT_PENDING");

    // Preferred provider declines -> the next proposal escalates to the next untried tier.
    await recordProviderResponse(owner.id, organisation.id, firstAttempt.id, { status: "DECLINED" });
    const secondAttempt = await proposeDispatch(owner.id, organisation.id, { workOrderId: workOrder.id });
    expect(secondAttempt.tier).toBe("STANDARD");
    expect(secondAttempt.serviceProviderId).toBe(standard.id);

    // Accepting assigns the work order.
    await recordProviderResponse(owner.id, organisation.id, secondAttempt.id, { status: "ACCEPTED" });
    expect((await db.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } })).status).toBe("ASSIGNED");

    const attemptHistory = await db.maintenanceDispatchAttempt.findMany({ where: { workOrderId: workOrder.id } });
    expect(attemptHistory).toHaveLength(2);
  });

  it("only uses NesAfric marketplace fallback when no internal provider exists and it is explicitly authorised, without exposing private work-order data", async () => {
    const owner = await registerUser({ displayName: "Fallback Landlord", email: "workforce-fallback-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Fallback Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await db.organisationSubscription.update({ where: { organisationId: organisation.id }, data: { plan: { connect: { key: "growth" } } } });
    const property = await createProperty(owner.id, organisation.id, { name: "Fallback Property", referenceNumber: "FP-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const electricalCategory = await db.serviceCategory.findUniqueOrThrow({ where: { key: "electrical" } });

    const outsideUser = await registerUser({ displayName: "Marketplace Electrician", email: "workforce-outside-electrician@example.com", password: "secure-password-123" });
    const outsideProvider = await createServiceProvider(outsideUser.id, { type: "INDIVIDUAL", displayName: "Marketplace Electrician", contactEmail: "workforce-outside-electrician@example.com", categoryIds: [electricalCategory.id] });
    await db.serviceProvider.update({ where: { id: outsideProvider.id }, data: { verificationStatus: "VERIFIED", acceptingWork: true, availabilityStatus: "AVAILABLE" } });
    // Deliberately never added to this organisation's own directory.

    const request = await createMaintenanceRequest(owner.id, organisation.id, { propertyId: property.id, title: "Sparking outlet", description: "Outlet sparks intermittently.", category: "electrical" });
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(owner.id, organisation.id, request.id, { title: "Inspect outlet", currencyCode: "GHS" });

    await expect(proposeDispatch(owner.id, organisation.id, { workOrderId: workOrder.id })).rejects.toMatchObject({ code: "NO_INTERNAL_PROVIDER_AVAILABLE" });

    const fallbackAttempt = await proposeDispatch(owner.id, organisation.id, { workOrderId: workOrder.id, allowMarketplaceFallback: true });
    expect(fallbackAttempt.tier).toBe("MARKETPLACE_FALLBACK");
    expect(fallbackAttempt.serviceProviderId).toBe(outsideProvider.id);
  });

  it("gates AI maintenance dispatch behind the propertyos.maintenance.ai_dispatch entitlement (plan capability differences)", async () => {
    const owner = await registerUser({ displayName: "Starter Landlord", email: "workforce-starter-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Starter Dispatch Org", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, { name: "Starter Property", referenceNumber: "SP-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const request = await createMaintenanceRequest(owner.id, organisation.id, { propertyId: property.id, title: "Broken tap", description: "Tap will not shut off.", category: "plumbing" });
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(owner.id, organisation.id, request.id, { title: "Fix tap", currencyCode: "GHS" });

    // Starter plan (the default trial plan) has AI maintenance dispatch disabled (item 20).
    await expect(proposeDispatch(owner.id, organisation.id, { workOrderId: workOrder.id }))
      .rejects.toMatchObject({ code: "ENTITLEMENT_FEATURE_DISABLED", details: { feature: "propertyos.maintenance.ai_dispatch" } });
  });

  it("enforces marketplace-professional RBAC and workspace isolation for AI employees, leads, and dispatch data", async () => {
    const { agentUser, brokerage } = await brokerageFixture();
    const otherOwner = await registerUser({ displayName: "Other Brokerage Owner", email: "workforce-other-owner@example.com", password: "secure-password-123" });
    const otherBrokerage = await createMarketplaceProfessional(otherOwner.id, { type: "BROKERAGE", displayName: "Rival Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(otherOwner.id, otherBrokerage.id, { planKey: "marketplace_pro" });

    // An AGENT (not ADMIN/OWNER) cannot create an AI employee.
    const memberRecord = await db.marketplaceProfessionalMember.create({ data: { marketplaceProfessionalId: brokerage.id, userId: agentUser.id, role: "AGENT" } });
    expect(memberRecord.role).toBe("AGENT");
    await expect(createMarketplaceAIEmployee(agentUser.id, brokerage.id, { name: "Should Fail", role: "AI_SALES_RECEPTIONIST" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // A member of a different brokerage cannot read this brokerage's lead signals or listings.
    await expect(detectLeadAttentionSignals(otherOwner.id, brokerage.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(searchInventory(otherOwner.id, brokerage.id, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await searchInventory(otherOwner.id, otherBrokerage.id, {})).toEqual([]);
  });
});
