import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import {
  createMarketplaceNativeListing,
  getMarketplaceProfessionalListing,
  getPublicListing,
  searchPublicListings,
  submitMarketplaceProfessionalListingVerification,
  transitionMarketplaceProfessionalListing,
  updateMarketplaceNativeListing,
} from "@/modules/listings/service";
import { verifyListingAsNesAfric } from "./helpers/nesafric-review";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

function input(listingType: "RENT" | "SALE", frequency: string | null, overrides: Record<string, unknown> = {}) {
  const amount = listingType === "SALE" ? { askingAmountMinor: "120000", rentAmountMinor: null } : { rentAmountMinor: "120000", askingAmountMinor: null };
  return {
    asset: { name: "Serviced plot", category: "land", purpose: listingType, currencyCode: "GHS", priceMinor: "120000", countryCode: "GH", city: "Accra", mediaUrls: [], availableFrom: "2026-10-01", authorityEvidenceReady: true },
    listing: {
      listingType, category: "land", title: `Plot priced ${frequency ?? "in total"}`, publicDescription: "A serviced residential plot close to the main road.",
      ...amount, currencyCode: "GHS", frequency, availableFrom: "2026-10-01", countryCode: "GH", city: "Accra", landSizeSqm: 750,
      media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/plot.jpg" }], amenities: [], ...overrides,
    },
    listingAuthority: "OWNER_SELF",
  };
}

async function professional() {
  const owner = await registerUser({ displayName: "Plot Seller", email: `seller-${Math.random().toString(36).slice(2)}@example.com`, password: "secure-password-123" });
  const pro = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Plot Brokerage", countryCode: "GH" });
  return { owner, pro };
}

async function publish(ownerId: string, professionalId: string, listingId: string) {
  await submitMarketplaceProfessionalListingVerification(ownerId, professionalId, listingId, { status: "PENDING", evidence: [{ type: "marketing_authority", privateReference: "private/auth.pdf" }] });
  await verifyListingAsNesAfric(listingId);
  await transitionMarketplaceProfessionalListing(ownerId, professionalId, listingId, { status: "PENDING_REVIEW" });
  await transitionMarketplaceProfessionalListing(ownerId, professionalId, listingId, { status: "PUBLISHED" });
}

describe("listing price units", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it.each([
    ["RENT", "DAILY"], ["RENT", "MONTHLY"], ["RENT", "ANNUAL"], ["RENT", "PER_SQM"], ["RENT", "PER_KM"],
    ["SALE", "PER_SQM"], ["SALE", "PER_KM"], ["SALE", null],
  ] as const)("persists a %s listing priced %s through create, read and public serialization", async (listingType, unit) => {
    const { owner, pro } = await professional();
    const created = await createMarketplaceNativeListing(owner.id, pro.id, input(listingType, unit));
    expect(created.frequency).toBe(unit);
    expect((await getMarketplaceProfessionalListing(owner.id, pro.id, created.id)).frequency).toBe(unit);
    // Area stays area: the price unit never overwrites the land size.
    expect(created.landSizeSqm?.toString()).toBe("750");
    await publish(owner.id, pro.id, created.id);
    const { listing: publicListing } = await getPublicListing(created.id);
    expect(publicListing.pricing).toMatchObject({ currencyCode: "GHS", frequency: unit, [listingType === "SALE" ? "askingAmountMinor" : "rentAmountMinor"]: "120000" });
  });

  it("survives an edit and filters search results by price unit", async () => {
    const { owner, pro } = await professional();
    const perSqm = await createMarketplaceNativeListing(owner.id, pro.id, input("SALE", "PER_SQM"));
    const edited = await updateMarketplaceNativeListing(owner.id, pro.id, perSqm.id, input("SALE", "PER_KM"));
    expect(edited.frequency).toBe("PER_KM");
    const daily = await createMarketplaceNativeListing(owner.id, pro.id, input("RENT", "DAILY"));
    await publish(owner.id, pro.id, perSqm.id);
    await publish(owner.id, pro.id, daily.id);
    expect((await searchPublicListings({ frequency: "PER_KM" })).items.map((item) => item.id)).toEqual([perSqm.id]);
    expect((await searchPublicListings({ frequency: "DAILY" })).items.map((item) => item.id)).toEqual([daily.id]);
    expect((await searchPublicListings({ frequency: "PER_SQM" })).items).toEqual([]);
  });

  it("rejects a rent period on a sale, a missing unit on a rental, and unknown units", async () => {
    const { owner, pro } = await professional();
    await expect(createMarketplaceNativeListing(owner.id, pro.id, input("SALE", "DAILY"))).rejects.toMatchObject({ name: "ZodError" });
    await expect(createMarketplaceNativeListing(owner.id, pro.id, input("SALE", "MONTHLY"))).rejects.toMatchObject({ name: "ZodError" });
    await expect(createMarketplaceNativeListing(owner.id, pro.id, input("RENT", null))).rejects.toMatchObject({ name: "ZodError" });
    await expect(createMarketplaceNativeListing(owner.id, pro.id, input("RENT", "WEEKLY"))).rejects.toMatchObject({ name: "ZodError" });
    await expect(searchPublicListings({ frequency: "HOURLY" })).rejects.toMatchObject({ name: "ZodError" });
    expect(await db.listing.count()).toBe(0);
  });

  it("the database constraint also refuses a sale with a rent period", async () => {
    const { owner, pro } = await professional();
    const listing = await createMarketplaceNativeListing(owner.id, pro.id, input("SALE", "PER_SQM"));
    await expect(db.listing.update({ where: { id: listing.id }, data: { frequency: "MONTHLY" } })).rejects.toThrow(/Listing_type_price_check/);
  });
});
