import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createListing, listPublicListingsForSitemap, transitionListing, updateListingVerification } from "@/modules/listings/service";
import { createMarketplaceProfessional, listPublicMarketplaceProfessionalsForSitemap } from "@/modules/marketplace-professionals/service";
import {
  addProviderToDirectory,
  createServiceProvider,
  listServiceCategories,
  reviewProviderEvidence,
  reviewProviderIdentity,
  reviewProviderVerification,
  submitProviderVerification,
  suspendProviderForPlatform,
} from "@/modules/providers/service";
import { listPublicServiceProvidersForSitemap, updateMarketplaceProfile } from "@/modules/marketplace/service";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  // Plans are not tied to any Organisation/User row, so TRUNCATE CASCADE above never reaches
  // them — clean up everything except the seeded free plan so this file is safely rerunnable.
  await db.marketplacePlan.deleteMany({ where: { key: { notIn: ["marketplace_free", "marketplace_pro", "marketplace_brokerage", "marketplace_enterprise"] } } });
}

const baseListing = (propertyId: string) => ({
  propertyId,
  listingType: "RENT" as const,
  category: "apartment",
  title: "Sitemap-eligible listing",
  publicDescription: "A test listing used to exercise sitemap eligibility.",
  rentAmountMinor: "250000",
  currencyCode: "GHS",
  frequency: "MONTHLY" as const,
  availableFrom: "2026-09-01",
  countryCode: "GH",
  region: "Greater Accra",
  city: "Accra",
  media: [{ type: "PHOTO" as const, publicUrl: "https://cdn.example.com/listing/photo.jpg", mimeType: "image/jpeg" }],
});

async function verifyAndPublish(userId: string, organisationId: string, listingId: string) {
  await updateListingVerification(userId, organisationId, listingId, {
    status: "PENDING",
    evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/evidence/deed.pdf" }],
  });
  await updateListingVerification(userId, organisationId, listingId, { status: "VERIFIED", note: "Asset authority checked." });
  await transitionListing(userId, organisationId, listingId, { status: "PENDING_REVIEW" });
  return transitionListing(userId, organisationId, listingId, { status: "PUBLISHED" });
}

/** Drives the mandatory platform Ghana Card identity-verification gate to VERIFIED — a
 * `ServiceProvider` can only reach public-marketplace eligibility once this has run. */
async function verifyProviderIdentity(providerId: string, email: string) {
  const platformUser = await registerUser({ displayName: "Platform Reviewer", email, password: "secure-password-123" });
  await db.platformPrincipal.create({ data: { userId: platformUser.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
  const identityEvidence = await db.providerEvidence.findMany({
    where: { providerId, type: { in: ["GHANA_CARD_FRONT", "GHANA_CARD_BACK"] }, reviewStatus: "PENDING" },
  });
  for (const evidence of identityEvidence) await reviewProviderEvidence(platformUser, evidence.id, { status: "APPROVED" });
  return reviewProviderIdentity(platformUser, providerId, { status: "VERIFIED" });
}

describe("PostgreSQL sitemap eligibility queries", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("includes only published, verified, currently-available property listings", async () => {
    const owner = await registerUser({ displayName: "Sitemap Owner", email: "sitemap-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Sitemap Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const availableProperty = await createProperty(owner.id, organisation.id, { name: "Available House", referenceNumber: "SITEMAP-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const leasedOutProperty = await createProperty(owner.id, organisation.id, { name: "Leased-out House", referenceNumber: "SITEMAP-2", category: "Residential", countryCode: "GH", currencyCode: "GHS" });

    const eligible = await createListing(owner.id, organisation.id, baseListing(availableProperty.id));
    await verifyAndPublish(owner.id, organisation.id, eligible.id);

    const draft = await createListing(owner.id, organisation.id, baseListing(availableProperty.id));

    const publishedButUnavailable = await createListing(owner.id, organisation.id, baseListing(leasedOutProperty.id));
    await verifyAndPublish(owner.id, organisation.id, publishedButUnavailable.id);
    // Simulates the property going inactive after publication — `getPublicListing` would 404 on
    // this listing's detail page, so the sitemap must not link to it either.
    await db.property.update({ where: { id: leasedOutProperty.id }, data: { status: "INACTIVE" } });

    const result = await listPublicListingsForSitemap();
    const byId = new Map(result.map((entry) => [entry.id, entry]));

    expect(byId.has(eligible.id)).toBe(true);
    expect(byId.get(eligible.id)?.updatedAt).toBeInstanceOf(Date);
    expect(byId.has(draft.id)).toBe(false);
    expect(byId.has(publishedButUnavailable.id)).toBe(false);
  });

  it("includes only active, unarchived marketplace professionals", async () => {
    const active = await registerUser({ displayName: "Active Agent", email: "active-agent@example.com", password: "secure-password-123" });
    const suspended = await registerUser({ displayName: "Suspended Agent", email: "suspended-agent@example.com", password: "secure-password-123" });
    const archived = await registerUser({ displayName: "Archived Agent", email: "archived-agent@example.com", password: "secure-password-123" });

    const professionalArgs = (displayName: string) => ({
      type: "INDIVIDUAL_AGENT" as const, displayName, countryCode: "GH",
      specialities: ["Residential"], servicesOffered: ["Sales"], serviceAreas: ["Accra"],
    });

    const activeProfessional = await createMarketplaceProfessional(active.id, professionalArgs("Active Realty"));
    const suspendedProfessional = await createMarketplaceProfessional(suspended.id, professionalArgs("Suspended Realty"));
    await db.marketplaceProfessional.update({ where: { id: suspendedProfessional.id }, data: { status: "SUSPENDED" } });
    const archivedProfessional = await createMarketplaceProfessional(archived.id, professionalArgs("Archived Realty"));
    await db.marketplaceProfessional.update({ where: { id: archivedProfessional.id }, data: { archivedAt: new Date() } });

    const result = await listPublicMarketplaceProfessionalsForSitemap();
    const slugs = new Set(result.map((entry) => entry.slug));

    expect(slugs.has(activeProfessional.slug)).toBe(true);
    expect(slugs.has(suspendedProfessional.slug)).toBe(false);
    expect(slugs.has(archivedProfessional.slug)).toBe(false);
  });

  it("includes only verified, non-suspended, publicly-listed service providers — using the slug URL when one exists and the id URL otherwise", async () => {
    const landlord = await registerUser({ displayName: "Sitemap Landlord", email: "sitemap-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(landlord.id, { name: "Sitemap Landlord Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const categories = await listServiceCategories();
    const category = categories[0];

    async function createVerifiedListedProvider(email: string, displayName: string) {
      const artisan = await registerUser({ displayName, email, password: "secure-password-123" });
      const provider = await createServiceProvider(artisan.id, {
        type: "INDIVIDUAL", displayName, contactEmail: email, categoryIds: [category.id],
      });
      await addProviderToDirectory(landlord.id, organisation.id, { providerId: provider.id });
      await submitProviderVerification(artisan.id, provider.id, {
        evidence: [
          { type: "GHANA_CARD_FRONT", reference: `private/${provider.id}-front` },
          { type: "GHANA_CARD_BACK", reference: `private/${provider.id}-back` },
        ],
      });
      await verifyProviderIdentity(provider.id, `platform-reviewer-${provider.id}@example.com`);
      await reviewProviderVerification(landlord.id, organisation.id, provider.id, { status: "VERIFIED" });
      await updateMarketplaceProfile(artisan.id, provider.id, {
        listed: true,
        publicDescription: "Public provider profile.",
        categoryIds: [category.id],
        serviceAreas: [{ countryCode: "GH", region: "Greater Accra", city: "Accra" }],
      });
      return provider;
    }

    const withSlug = await createVerifiedListedProvider("provider-with-slug@example.com", "Provider With Slug");
    const withoutSlugSource = await createVerifiedListedProvider("provider-without-slug@example.com", "Provider Without Slug");
    // Simulates a legacy provider created before slugs were mandatory (see the schema comment on
    // `ServiceProvider.slug`) — the sitemap must still link to it, at `/marketplace/{id}`.
    await db.serviceProvider.update({ where: { id: withoutSlugSource.id }, data: { slug: null } });

    const toSuspend = await createVerifiedListedProvider("provider-to-suspend@example.com", "Provider To Suspend");
    const platformAdmin = await registerUser({ displayName: "Suspending Admin", email: "suspending-admin@example.com", password: "secure-password-123" });
    await db.platformPrincipal.create({ data: { userId: platformAdmin.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
    await suspendProviderForPlatform(platformAdmin, toSuspend.id, { reason: "Test platform-wide suspension." });

    const result = await listPublicServiceProvidersForSitemap();
    const byId = new Map(result.map((entry) => [entry.id, entry]));

    expect(byId.get(withSlug.id)?.slug).toBe(withSlug.slug);
    expect(byId.get(withoutSlugSource.id)?.slug).toBeNull();
    expect(byId.has(toSuspend.id)).toBe(false);
  });
});
