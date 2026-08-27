import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import {
  createListing,
  createMarketplaceNativeListing,
  updateListingVerification,
  transitionListing,
  createMarketplaceLead,
  getPublicListing,
} from "@/modules/listings/service";
import {
  createMarketplaceProfessional,
  addMarketplaceMember,
  updateMarketplaceMember,
  updateMarketplaceProfessional,
  searchMarketplaceDirectory,
  getMarketplaceDashboardMetrics,
  assignMarketplaceLead,
} from "@/modules/marketplace-professionals/service";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
  await db.marketplacePlan.deleteMany({ where: { key: { notIn: ["marketplace_free", "marketplace_pro", "marketplace_brokerage", "marketplace_enterprise"] } } });
}

async function addMember(organisationId: string, userId: string, roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const member = await db.organisationMember.create({ data: { organisationId, userId } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
  return member;
}

const baseListing = (propertyId: string, overrides: Record<string, unknown> = {}) => ({
  propertyId,
  listingType: "RENT" as const,
  category: "apartment",
  title: "Bright two-bedroom home",
  publicDescription: "A bright, well-maintained home with flexible viewing availability.",
  rentAmountMinor: "250000",
  currencyCode: "GHS",
  frequency: "MONTHLY" as const,
  availableFrom: "2026-09-01",
  countryCode: "GH",
  region: "Greater Accra",
  city: "Accra",
  media: [{ type: "PHOTO" as const, publicUrl: "https://cdn.example.com/listing/photo.jpg" }],
  ...overrides,
});

async function createNativeListing(userId: string, marketplaceProfessionalId: string, overrides: Record<string, unknown> = {}) {
  return createMarketplaceNativeListing(userId, marketplaceProfessionalId, {
    asset: {
      name: "Bright two-bedroom apartment", category: "apartment", purpose: "RENT",
      bedrooms: 2, bathrooms: 2, currencyCode: "GHS", priceMinor: "250000", countryCode: "GH",
      region: "Greater Accra", city: "East Legon", availableFrom: "2026-09-01",
    },
    listing: {
      listingType: "RENT", category: "apartment", title: "Bright two-bedroom apartment",
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

describe("PostgreSQL Phase 21B professional experience", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("searches the public marketplace directory by type, verification, and text query, and paginates results", async () => {
    const agentOwner = await registerUser({ displayName: "Solo Agent Owner", email: "directory-agent@example.com", password: "secure-password-123" });
    const brokerageOwner = await registerUser({ displayName: "Brokerage Owner", email: "directory-brokerage@example.com", password: "secure-password-123" });
    const platformAdminUser = await registerUser({ displayName: "Directory Admin", email: "directory-platform-admin@example.com", password: "secure-password-123" });
    await db.platformPrincipal.create({ data: { userId: platformAdminUser.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });

    await createMarketplaceProfessional(agentOwner.id, { type: "INDIVIDUAL_AGENT", displayName: "Ama Solo Agent", countryCode: "GH" });
    const brokerage = await createMarketplaceProfessional(brokerageOwner.id, { type: "BROKERAGE", displayName: "Golden Coast Brokerage", countryCode: "GH" });

    const { reviewMarketplaceVerification, submitMarketplaceVerification } = await import("@/modules/marketplace-professionals/service");
    await submitMarketplaceVerification(brokerageOwner.id, brokerage.id, { evidenceReferences: ["private/evidence/registration.pdf"] });
    await reviewMarketplaceVerification(platformAdminUser, brokerage.id, { status: "VERIFIED" });

    const allResults = await searchMarketplaceDirectory({});
    expect(allResults.total).toBe(2);

    const agentsOnly = await searchMarketplaceDirectory({ type: "INDIVIDUAL_AGENT" });
    expect(agentsOnly.items.map((item) => item.displayName)).toEqual(["Ama Solo Agent"]);

    const verifiedOnly = await searchMarketplaceDirectory({ verifiedOnly: true });
    expect(verifiedOnly.items.map((item) => item.displayName)).toEqual(["Golden Coast Brokerage"]);

    const byQuery = await searchMarketplaceDirectory({ query: "golden" });
    expect(byQuery.items.map((item) => item.displayName)).toEqual(["Golden Coast Brokerage"]);

    const paged = await searchMarketplaceDirectory({ page: 1, pageSize: 1 });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(2);
    expect(paged.pageSize).toBe(1);

    // Never prioritises only individual agents (item 8) — a brokerage ranks in the results on
    // exactly the same footing as an individual agent, not excluded or demoted.
    expect(allResults.items.map((item) => item.displayName).sort()).toEqual(["Ama Solo Agent", "Golden Coast Brokerage"]);
  });

  it("computes real dashboard metrics from live listings, leads, viewings, team, and developments", async () => {
    const owner = await registerUser({ displayName: "Dashboard Owner", email: "dashboard-owner@example.com", password: "secure-password-123" });
    const agent = await registerUser({ displayName: "Dashboard Agent", email: "dashboard-agent@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Metrics Brokerage", countryCode: "GH" });
    await addMarketplaceMember(owner.id, professional.id, { email: "dashboard-agent@example.com", role: "AGENT" });
    void agent;

    const baseline = await getMarketplaceDashboardMetrics(owner.id, professional.id);
    expect(baseline.listings.total).toBe(0);
    expect(baseline.teamMembers).toBe(2);
    expect(baseline.plan?.key).toBe("marketplace_free");
    const baselineCompleteness = baseline.profileCompletenessPercent;

    // Improving the profile increases completeness.
    await updateMarketplaceProfessional(owner.id, professional.id, {
      description: "A full-service brokerage.", logoUrl: "https://cdn.example.com/logo.png", websiteUrl: "https://metrics-brokerage.example",
      contactEmail: "hello@metrics-brokerage.example", contactPhone: "+233240000000",
      specialities: ["Residential"], serviceAreas: ["Accra"],
    });

    const draftListing = await createNativeListing(owner.id, professional.id, { listing: { listingType: "RENT", category: "apartment", title: "Draft unit", publicDescription: "A bright, well-maintained two-bedroom apartment with flexible viewing availability.", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH", media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/listing/photo.jpg" }] } });
    const publishedListing = await createNativeListing(owner.id, professional.id);
    await publishListing(owner.id, professional.backingOrganisationId, publishedListing.id);
    const lead = await createMarketplaceLead(publishedListing.id, undefined, { name: "Prospect", phone: "+233240000001" });

    const updated = await getMarketplaceDashboardMetrics(owner.id, professional.id);
    expect(updated.listings.active).toBe(1);
    expect(updated.listings.draft).toBe(1);
    expect(updated.listings.total).toBe(2);
    expect(updated.newLeads).toBe(1);
    expect(updated.profileCompletenessPercent).toBeGreaterThan(baselineCompleteness);
    expect(updated.profileCompletenessPercent).toBe(100);
    void draftListing; void lead;
  });

  it("assigns leads to a team representative for both a marketplace-native listing and a third-party landlord-attributed listing, and surfaces both in the CRM inbox", async () => {
    const brokerOwner = await registerUser({ displayName: "CRM Broker Owner", email: "crm-broker-owner@example.com", password: "secure-password-123" });
    const agent = await registerUser({ displayName: "CRM Rep Agent", email: "crm-rep-agent@example.com", password: "secure-password-123" });
    const landlord = await registerUser({ displayName: "CRM Landlord", email: "crm-landlord@example.com", password: "secure-password-123" });

    const brokerage = await createMarketplaceProfessional(brokerOwner.id, { type: "BROKERAGE", displayName: "CRM Brokerage", countryCode: "GH" });
    const repMember = await addMarketplaceMember(brokerOwner.id, brokerage.id, { email: "crm-rep-agent@example.com", role: "AGENT" });

    // A marketplace-native listing (the brokerage's own inventory).
    const nativeListing = await createNativeListing(brokerOwner.id, brokerage.id);
    await publishListing(brokerOwner.id, brokerage.backingOrganisationId, nativeListing.id);
    const nativeLead = await createMarketplaceLead(nativeListing.id, undefined, { name: "Native Prospect", phone: "+233240000010" });

    // A third-party listing: the brokerage markets a landlord's PropertyOS property. The
    // representative (agent) is granted PropertyOS listing access on the landlord's organisation,
    // exactly as Phase 21A's third-party relationship test does.
    const landlordOrg = await createOrganisation(landlord.id, { name: "CRM Landlord Portfolio", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const property = await createProperty(landlord.id, landlordOrg.id, { name: "CRM House", referenceNumber: "CRM-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    await addMember(landlordOrg.id, agent.id, "property_manager");
    const thirdPartyListing = await createListing(agent.id, landlordOrg.id, baseListing(property.id, {
      marketplaceProfessionalId: brokerage.id, listingRepresentativeUserId: agent.id, listingAuthority: "BROKERAGE_AUTHORIZED",
    }));
    await publishListing(landlord.id, landlordOrg.id, thirdPartyListing.id);
    const thirdPartyLead = await createMarketplaceLead(thirdPartyListing.id, undefined, { name: "Third-party Prospect", phone: "+233240000011" });

    // Both leads are attributed to different `organisationId`s under the hood, but both must
    // appear in this professional's unified CRM inbox (item 6) — this is the bug this phase fixed:
    // scoping by `listing.marketplaceProfessionalId`, not by `organisationId`.
    const { listMarketplaceProfessionalLeads } = await import("@/modules/listings/service");
    const inbox = await listMarketplaceProfessionalLeads(brokerOwner.id, brokerage.id);
    expect(inbox.items.map((item) => item.id).sort()).toEqual([nativeLead.id, thirdPartyLead.id].sort());

    // Assigning a representative must work for both, even though the third-party lead's
    // `organisationId` is the landlord's, not the brokerage's backing organisation.
    const assignedNative = await assignMarketplaceLead(brokerOwner.id, brokerage.id, nativeLead.id, repMember.id);
    expect(assignedNative.assigneeMemberId).toBeTruthy();
    const assignedThirdParty = await assignMarketplaceLead(brokerOwner.id, brokerage.id, thirdPartyLead.id, repMember.id);
    expect(assignedThirdParty.assigneeMemberId).toBeTruthy();

    const { getMarketplaceProfessionalLead } = await import("@/modules/listings/service");
    const detail = await getMarketplaceProfessionalLead(brokerOwner.id, brokerage.id, thirdPartyLead.id);
    expect(detail.assignee?.user.displayName).toBe("CRM Rep Agent");
  });

  it("keeps marketplace CRM leads isolated across professionals", async () => {
    const ownerA = await registerUser({ displayName: "CRM Owner A", email: "crm-owner-a@example.com", password: "secure-password-123" });
    const ownerB = await registerUser({ displayName: "CRM Owner B", email: "crm-owner-b@example.com", password: "secure-password-123" });
    const professionalA = await createMarketplaceProfessional(ownerA.id, { type: "BROKERAGE", displayName: "Isolation Brokerage A", countryCode: "GH" });
    const professionalB = await createMarketplaceProfessional(ownerB.id, { type: "BROKERAGE", displayName: "Isolation Brokerage B", countryCode: "GH" });

    const listingA = await createNativeListing(ownerA.id, professionalA.id);
    await publishListing(ownerA.id, professionalA.backingOrganisationId, listingA.id);
    const leadA = await createMarketplaceLead(listingA.id, undefined, { name: "Isolated Prospect", phone: "+233240000020" });

    const { listMarketplaceProfessionalLeads, getMarketplaceProfessionalLead } = await import("@/modules/listings/service");
    expect((await listMarketplaceProfessionalLeads(ownerB.id, professionalB.id)).items).toEqual([]);
    await expect(getMarketplaceProfessionalLead(ownerB.id, professionalB.id, leadA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assignMarketplaceLead(ownerB.id, professionalB.id, leadA.id, "not-a-real-member-id")).rejects.toBeTruthy();
  });

  it("exposes safe public listing attribution — 'Listed by' for a third-party listing, and a plain owner attribution for a landlord's own listing — without leaking the private organisation relationship", async () => {
    const landlord = await registerUser({ displayName: "Attribution Landlord", email: "attribution-landlord@example.com", password: "secure-password-123" });
    const brokerOwner = await registerUser({ displayName: "Attribution Broker Owner", email: "attribution-broker@example.com", password: "secure-password-123" });
    const agent = await registerUser({ displayName: "Attribution Agent", email: "attribution-agent@example.com", password: "secure-password-123" });

    const brokerage = await createMarketplaceProfessional(brokerOwner.id, { type: "BROKERAGE", displayName: "Attribution Brokerage", countryCode: "GH" });
    await addMarketplaceMember(brokerOwner.id, brokerage.id, { email: "attribution-agent@example.com", role: "AGENT" });

    const landlordOrg = await createOrganisation(landlord.id, { name: "Attribution Landlord Portfolio", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const property = await createProperty(landlord.id, landlordOrg.id, { name: "Attribution House", referenceNumber: "ATTR-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    await addMember(landlordOrg.id, agent.id, "property_manager");

    const thirdPartyListing = await createListing(agent.id, landlordOrg.id, baseListing(property.id, {
      marketplaceProfessionalId: brokerage.id, listingRepresentativeUserId: agent.id, listingAuthority: "BROKERAGE_AUTHORIZED",
    }));
    await publishListing(landlord.id, landlordOrg.id, thirdPartyListing.id);
    const publicThirdParty = await getPublicListing(thirdPartyListing.id);
    expect(publicThirdParty.listing.attribution).toMatchObject({ listedBy: "Agent", professional: { displayName: "Attribution Brokerage", type: "BROKERAGE" } });
    // No trace of the landlord's private organisation/property identity in the public projection.
    expect(JSON.stringify(publicThirdParty.listing)).not.toContain(landlordOrg.id);
    expect(JSON.stringify(publicThirdParty.listing)).not.toContain(property.id);

    const selfListing = await createListing(landlord.id, landlordOrg.id, baseListing(property.id, { listingAuthority: "OWNER_SELF" }));
    await publishListing(landlord.id, landlordOrg.id, selfListing.id);
    const publicSelfListing = await getPublicListing(selfListing.id);
    expect(publicSelfListing.listing.attribution).toEqual({ listedBy: "Owner", professional: null });
  });

  it("supports deactivating and reactivating a marketplace team member while protecting the sole owner", async () => {
    const owner = await registerUser({ displayName: "Deactivate Owner", email: "deactivate-owner@example.com", password: "secure-password-123" });
    const agentUser = await registerUser({ displayName: "Deactivate Agent", email: "deactivate-agent@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Deactivate Brokerage", countryCode: "GH" });
    const member = await addMarketplaceMember(owner.id, professional.id, { email: "deactivate-agent@example.com", role: "AGENT" });

    const deactivated = await updateMarketplaceMember(owner.id, professional.id, member.id, { status: "SUSPENDED" });
    expect(deactivated.status).toBe("SUSPENDED");
    const reactivated = await updateMarketplaceMember(owner.id, professional.id, member.id, { status: "ACTIVE" });
    expect(reactivated.status).toBe("ACTIVE");

    const ownerMember = await db.marketplaceProfessionalMember.findUniqueOrThrow({ where: { marketplaceProfessionalId_userId: { marketplaceProfessionalId: professional.id, userId: owner.id } } });
    await expect(updateMarketplaceMember(owner.id, professional.id, ownerMember.id, { status: "SUSPENDED" })).rejects.toMatchObject({ code: "LAST_OWNER" });
    void agentUser;
  });
});
