import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createMarketplaceProfessional, addMarketplaceMember } from "@/modules/marketplace-professionals/service";
import { createDevelopment, createDevelopmentUnit } from "@/modules/developments/service";
import {
  createMarketplaceNativeListing, createMarketplaceLead, createViewingRequest, getPublicListing,
  searchPublicListings, submitMarketplaceProfessionalListingVerification, transitionMarketplaceProfessionalListing,
  updateListingVerification, updateMarketplaceListingAttribution,
} from "@/modules/listings/service";
import { listUserOrganisations } from "@/modules/organisations/service";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

function standaloneInput(overrides: Record<string, unknown> = {}) {
  return {
    asset: {
      name: "Airport Hills Apartment", category: "apartment", subtype: "condominium", purpose: "RENT",
      bedrooms: 2, bathrooms: 2, sizeSqm: 105, currencyCode: "GHS", priceMinor: "450000",
      countryCode: "GH", city: "Accra", district: "Airport Hills", amenities: ["Pool", "Security"],
      furnishing: "Furnished", mediaUrls: ["https://cdn.example.com/airport-hills.jpg"],
      availableFrom: "2026-09-01", authorityEvidenceReady: true,
    },
    listing: {
      listingType: "RENT", category: "apartment", title: "Furnished Airport Hills apartment",
      publicDescription: "A professionally marketed furnished apartment with pool and security.",
      rentAmountMinor: "450000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-01",
      countryCode: "GH", city: "Accra", district: "Airport Hills",
      media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/airport-hills.jpg" }], amenities: [],
    },
    listingAuthority: "BROKERAGE_AUTHORIZED",
    ...overrides,
  };
}

describe("PostgreSQL standalone marketplace listings", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it.each(["INDIVIDUAL_AGENT", "BROKERAGE", "REAL_ESTATE_COMPANY"] as const)("allows a %s to create standalone inventory without PropertyOS", async (type) => {
    const owner = await registerUser({ displayName: `${type} Owner`, email: `${type.toLowerCase()}@example.com`, password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, { type, displayName: `${type} Property Marketing`, countryCode: "GH" });
    const listing = await createMarketplaceNativeListing(owner.id, professional.id, standaloneInput());
    expect(listing.propertyId).toBeNull();
    expect(listing.marketplaceAssetId).toBeTruthy();
    expect(listing.organisationId).toBe(professional.backingOrganisationId);
    expect(await listUserOrganisations(owner.id)).toEqual([]);
    expect(await db.organisationSubscription.findUnique({ where: { organisationId: professional.backingOrganisationId } })).toBeNull();
  });

  it("publishes developer inventory into public search and supports leads and viewings", async () => {
    const developer = await registerUser({ displayName: "Developer", email: "standalone-dev@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(developer.id, { type: "DEVELOPER", displayName: "Standalone Developments", countryCode: "GH" });
    const development = await createDevelopment(developer.id, professional.id, { name: "Independence Gardens", countryCode: "GH", city: "Accra" });
    const unit = await createDevelopmentUnit(developer.id, professional.id, development.id, { name: "Unit A1", bedrooms: 2, priceMinor: "450000", currencyCode: "GHS" });
    const input = standaloneInput({
      asset: { ...standaloneInput().asset, developmentUnitId: unit.id }, listingAuthority: "DEVELOPER",
    });
    const listing = await createMarketplaceNativeListing(developer.id, professional.id, input);
    expect(listing.developmentUnitId).toBe(unit.id);
    await submitMarketplaceProfessionalListingVerification(developer.id, professional.id, listing.id, { status: "PENDING", evidence: [{ type: "marketing_authority", privateReference: "private/dev-unit-a1.pdf" }] });
    await updateListingVerification(developer.id, professional.backingOrganisationId, listing.id, { status: "VERIFIED" });
    await transitionMarketplaceProfessionalListing(developer.id, professional.id, listing.id, { status: "PENDING_REVIEW" });
    await transitionMarketplaceProfessionalListing(developer.id, professional.id, listing.id, { status: "PUBLISHED" });

    expect((await searchPublicListings({ country: "GH" })).items[0]).toMatchObject({ id: listing.id, source: "MARKETPLACE_NATIVE" });
    expect((await getPublicListing(listing.id)).listing.id).toBe(listing.id);
    const lead = await createMarketplaceLead(listing.id, undefined, { name: "Public Buyer", email: "buyer@example.com" });
    const viewing = await createViewingRequest(listing.id, undefined, { leadId: lead.id, preferredTimes: [{ startsAt: "2027-01-10T10:00:00Z", endsAt: "2027-01-10T11:00:00Z", timezone: "Africa/Accra" }] });
    expect(viewing.listingId).toBe(listing.id);
  });

  it("records attribution history and denies cross-professional representatives and silent transfer", async () => {
    const owner = await registerUser({ displayName: "Broker Owner", email: "attr-owner@example.com", password: "secure-password-123" });
    const rep = await registerUser({ displayName: "Listing Rep", email: "attr-rep@example.com", password: "secure-password-123" });
    const outsider = await registerUser({ displayName: "Outsider", email: "attr-outsider@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Attribution Brokerage", countryCode: "GH" });
    const other = await createMarketplaceProfessional(outsider.id, { type: "BROKERAGE", displayName: "Other Brokerage", countryCode: "GH" });
    await addMarketplaceMember(owner.id, professional.id, { email: rep.email, role: "AGENT" });
    const listing = await createMarketplaceNativeListing(owner.id, professional.id, standaloneInput());
    await updateMarketplaceListingAttribution(owner.id, professional.id, listing.id, { listingRepresentativeUserId: rep.id, listingAuthority: "MANAGING_AGENT", reason: "Assigned to the active sales representative." });
    expect(await db.listingAttributionHistory.count({ where: { listingId: listing.id } })).toBe(2);
    await expect(updateMarketplaceListingAttribution(owner.id, professional.id, listing.id, { marketplaceProfessionalId: other.id, reason: "Move organisation" })).rejects.toMatchObject({ code: "LISTING_TRANSFER_REQUIRES_EXPLICIT_WORKFLOW" });
    await expect(updateMarketplaceListingAttribution(outsider.id, professional.id, listing.id, { listingAuthority: "OWNER_SELF", reason: "Hijack" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("enforces Marketplace Free active listing limits and the database source invariant", async () => {
    const owner = await registerUser({ displayName: "Limited Broker", email: "limit-broker@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, { type: "BROKER", displayName: "Limited Broker", countryCode: "GH" });
    for (let index = 0; index < 10; index += 1) await createMarketplaceNativeListing(owner.id, professional.id, standaloneInput({ asset: { ...standaloneInput().asset, name: `Asset ${index}` }, listing: { ...standaloneInput().listing, title: `Standalone apartment number ${index}` } }));
    await expect(createMarketplaceNativeListing(owner.id, professional.id, standaloneInput())).rejects.toMatchObject({ code: "MARKETPLACE_ENTITLEMENT_LIMIT_REACHED" });
    const asset = await db.marketplaceAsset.findFirstOrThrow({ where: { marketplaceProfessionalId: professional.id } });
    await expect(db.listing.create({ data: {
      organisationId: professional.backingOrganisationId, createdByUserId: owner.id, marketplaceAssetId: asset.id,
      propertyId: crypto.randomUUID(), listingType: "SALE", category: "house", title: "Invalid dual source",
      publicDescription: "This deliberately invalid listing must be rejected by PostgreSQL.", currencyCode: "GHS", askingAmountMinor: 1,
      availableFrom: new Date(), countryCode: "GH",
    } })).rejects.toBeTruthy();
  });
});
