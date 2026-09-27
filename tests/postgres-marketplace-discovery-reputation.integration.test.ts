import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createMaintenanceRequest, createWorkOrder, transitionMaintenanceRequest } from "@/modules/maintenance/service";
import {
  createServiceProvider,
  listServiceCategories,
  reviewProviderEvidence,
  reviewProviderIdentity,
  submitProviderVerification,
  updateServiceProvider,
} from "@/modules/providers/service";
import { discoverMarketplaceProviders, getPublicMarketplaceProvider, updateMarketplaceProfile } from "@/modules/marketplace/service";
import { listSavedProviders, saveProvider, unsaveProvider } from "@/modules/marketplace/saved-providers";

/**
 * Discovery & reputation foundation against PostgreSQL: the completion-rate SQL over real
 * assignment rows, free-text search behind every public gate, and saved providers with the
 * (userId, providerId) uniqueness constraint.
 */

async function cleanDatabase() {
  await db.$executeRaw`TRUNCATE TABLE "MarketplaceEnquiryStatusHistory", "ProviderMarketplaceProfileHistory"`;
  await db.savedServiceProvider.deleteMany();
  await db.platformPrincipal.deleteMany();
  await db.marketplaceEnquiry.deleteMany();
  await db.providerMarketplaceServiceArea.deleteMany();
  await db.providerMarketplaceCategory.deleteMany();
  await db.providerMarketplaceProfile.deleteMany();
  await db.providerRating.deleteMany();
  await db.providerAssignment.deleteMany();
  await db.providerQuotationReview.deleteMany();
  await db.providerQuotation.deleteMany();
  await db.providerQuotationRequest.deleteMany();
  await db.providerOrganisation.deleteMany();
  await db.providerVerificationConsent.deleteMany();
  await db.providerVerificationHistory.deleteMany();
  await db.providerEvidence.deleteMany();
  await db.providerServiceArea.deleteMany();
  await db.serviceProviderCategory.deleteMany();
  await db.serviceProvider.deleteMany();
  await db.workOrderHistory.deleteMany();
  await db.workOrder.deleteMany();
  await db.maintenanceApproval.deleteMany();
  await db.maintenanceAttachment.deleteMany();
  await db.maintenanceHistory.deleteMany();
  await db.maintenanceRequest.deleteMany();
  await db.paymentReconciliationEvent.deleteMany();
  await db.paymentAllocation.deleteMany();
  await db.receipt.deleteMany();
  await db.financialLedgerEntry.deleteMany();
  await db.payment.deleteMany();
  await db.paymentIntent.deleteMany();
  await db.securityDeposit.deleteMany();
  await db.backgroundJob.deleteMany();
  await db.domainEvent.deleteMany();
  await db.auditEvent.deleteMany();
  await db.notification.deleteMany();
  await db.reminderPolicy.deleteMany();
  await db.rentObligation.deleteMany();
  await db.leaseAmendment.deleteMany();
  await db.leaseDocument.deleteMany();
  await db.leaseHistory.deleteMany();
  await db.leaseParty.deleteMany();
  await db.lease.deleteMany();
  await db.tenantOrganisation.deleteMany();
  await db.tenant.deleteMany();
  await db.organisationInvitation.deleteMany();
  await db.membershipRole.deleteMany();
  await db.organisationMember.deleteMany();
  await db.unit.deleteMany();
  await db.building.deleteMany();
  await db.property.deleteMany();
  await db.portfolio.deleteMany();
  await db.propertyOwner.deleteMany();
  await db.subscriptionInvoice.deleteMany();
  await db.subscriptionStatusHistory.deleteMany();
  await db.organisationEntitlementOverride.deleteMany();
  await db.organisationFeatureFlagOverride.deleteMany();
  await db.platformSupportSession.deleteMany();
  await db.organisationSubscription.deleteMany();
  await db.organisation.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
}

let reviewers = 0;

/** A verified, publicly listed provider in the given category and area. */
async function listedProvider(displayName: string, categoryKey: string, area: { city: string; region: string }, description = "Property services.") {
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const owner = await registerUser({ displayName, email: `${slug}@example.com`, password: "secure-password-123" });
  const category = (await listServiceCategories()).find(({ key }) => key === categoryKey)!;
  const provider = await createServiceProvider(owner.id, { type: "INDIVIDUAL", displayName, contactEmail: `${slug}@example.com`, categoryIds: [category.id] });
  await submitProviderVerification(owner.id, provider.id, {
    evidence: [
      { type: "GHANA_CARD_FRONT", reference: `private/${slug}-front` },
      { type: "GHANA_CARD_BACK", reference: `private/${slug}-back` },
    ],
  });
  reviewers += 1;
  const reviewer = await registerUser({ displayName: "Reviewer", email: `reviewer-${reviewers}@example.com`, password: "secure-password-123" });
  await db.platformPrincipal.create({ data: { userId: reviewer.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
  for (const evidence of await db.providerEvidence.findMany({ where: { providerId: provider.id, reviewStatus: "PENDING" } })) {
    await reviewProviderEvidence(reviewer, evidence.id, { status: "APPROVED" });
  }
  await reviewProviderIdentity(reviewer, provider.id, { status: "VERIFIED" });
  await updateServiceProvider(owner.id, provider.id, { availabilityStatus: "AVAILABLE", acceptingWork: true });
  await updateMarketplaceProfile(owner.id, provider.id, {
    listed: true,
    publicDescription: description,
    categoryIds: [category.id],
    serviceAreas: [{ countryCode: "GH", region: area.region, city: area.city }],
  });
  return { ...provider, ownerId: owner.id };
}

const accra = { city: "Accra", region: "Greater Accra" };
const kumasi = { city: "Kumasi", region: "Ashanti" };
const ids = (result: { items: { id: string }[] }) => result.items.map(({ id }) => id);

describe("PostgreSQL marketplace discovery & reputation", () => {
  beforeEach(async () => {
    reviewers = 0;
    await cleanDatabase();
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("derives completion rate from concluded assignments only, and null without enough history", async () => {
    const landlord = await registerUser({ displayName: "Landlord", email: "reputation-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(landlord.id, { name: "Reputation Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(landlord.id, organisation.id, { name: "Reputation House", referenceNumber: "REP-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const maintenance = await createMaintenanceRequest(landlord.id, organisation.id, { propertyId: property.id, title: "Fixture", description: "Fixture", category: "plumbing" });
    await transitionMaintenanceRequest(landlord.id, organisation.id, maintenance.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(landlord.id, organisation.id, maintenance.id, { title: "Fixture job", currencyCode: "GHS" });

    const seasoned = await listedProvider("Seasoned Plumbing", "plumbing", accra);
    const newcomer = await listedProvider("Newcomer Plumbing", "plumbing", accra);
    const accepted = new Date();
    const assignment = (providerId: string, status: "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "COMPLETED", acceptedAt: Date | null = null, cancellationAttribution: "PROVIDER" | "LANDLORD" | "UNKNOWN" | null = null) =>
      db.providerAssignment.create({ data: { landlordOrganisationId: organisation.id, workOrderId: workOrder.id, providerId, assignedByUserId: landlord.id, status, acceptedAt, cancellationAttribution } });
    for (let index = 0; index < 5; index += 1) await assignment(seasoned.id, "COMPLETED", accepted);
    await assignment(seasoned.id, "CANCELLED", accepted, "PROVIDER"); // provider-caused, after acceptance: counts against
    await assignment(seasoned.id, "CANCELLED", accepted, "LANDLORD"); // landlord-caused: excluded
    await assignment(seasoned.id, "CANCELLED", accepted, "UNKNOWN"); // unknown responsibility: excluded
    await assignment(seasoned.id, "CANCELLED", null, "PROVIDER"); // never accepted: excluded
    await assignment(seasoned.id, "PENDING"); // active: excluded
    await assignment(seasoned.id, "ACCEPTED", accepted); // active: excluded
    await assignment(seasoned.id, "DECLINED"); // declined: excluded
    await assignment(newcomer.id, "COMPLETED", accepted);
    await assignment(newcomer.id, "COMPLETED", accepted);

    const { provider: seasonedPublic } = await getPublicMarketplaceProvider(seasoned.id);
    expect(seasonedPublic).toMatchObject({ completedJobs: 5, completionRateBasis: 6, completionRate: 0.833 });
    const { provider: newcomerPublic } = await getPublicMarketplaceProvider(newcomer.id);
    expect(newcomerPublic).toMatchObject({ completedJobs: 2, completionRateBasis: 2, completionRate: null });

    // A provider can't set it: the profile update rejects the field outright.
    await expect(updateMarketplaceProfile(seasoned.ownerId, seasoned.id, { completionRate: 1 })).rejects.toBeTruthy();
    expect((await getPublicMarketplaceProvider(seasoned.id)).provider.completionRate).toBe(0.833);
  });

  it("searches names, categories and areas on the server, behind every public gate", async () => {
    const kwame = await listedProvider("Kwame & Sons", "plumbing", accra, "Pipes and bathrooms.");
    const volt = await listedProvider("Volt Masters", "electrical", accra);
    const kumasiVolt = await listedProvider("Garden City Power", "electrical", kumasi);
    const unverified = await listedProvider("Unverified Plumbing Co", "plumbing", accra);
    const suspended = await listedProvider("Suspended Plumbing Co", "plumbing", accra);
    const unlisted = await listedProvider("Unlisted Plumbing Co", "plumbing", accra);
    await db.serviceProvider.update({ where: { id: unverified.id }, data: { verificationStatus: "PENDING" } });
    await db.serviceProvider.update({ where: { id: suspended.id }, data: { suspendedAt: new Date(), suspensionReason: "Test" } });
    await updateMarketplaceProfile(unlisted.ownerId, unlisted.id, { listed: false });

    expect(ids(await discoverMarketplaceProviders({ q: "kwame" }))).toEqual([kwame.id]);
    expect(ids(await discoverMarketplaceProviders({ q: "KWAME sons" }))).toEqual([kwame.id]);
    expect(ids(await discoverMarketplaceProviders({ q: "plumber" }))).toEqual([kwame.id]);
    expect(ids(await discoverMarketplaceProviders({ q: "plumbing" }))).toEqual([kwame.id]);
    expect(ids(await discoverMarketplaceProviders({ q: "bathroom" }))).toEqual([kwame.id]);
    expect(new Set(ids(await discoverMarketplaceProviders({ q: "electrician" })))).toEqual(new Set([volt.id, kumasiVolt.id]));
    expect(ids(await discoverMarketplaceProviders({ q: "Kumasi electrician" }))).toEqual([kumasiVolt.id]);
    expect(ids(await discoverMarketplaceProviders({ q: "electrician", country: "GH", city: "Accra" }))).toEqual([volt.id]);
    expect(ids(await discoverMarketplaceProviders({ q: "plumb", category: "electrical" }))).toEqual([]);
    expect((await discoverMarketplaceProviders({ q: "roofing" })).pagination.total).toBe(0);

    // Gates hold for text that names the hidden providers directly.
    for (const q of ["Unverified", "Suspended", "Unlisted", "Plumbing Co"]) {
      expect(ids(await discoverMarketplaceProviders({ q }))).toEqual([]);
    }

    // Empty / whitespace q is ordinary discovery, and search keeps the ranking order.
    const all = await discoverMarketplaceProviders({});
    expect(ids(await discoverMarketplaceProviders({ q: "   " }))).toEqual(ids(all));
    expect(new Set(ids(all))).toEqual(new Set([kwame.id, volt.id, kumasiVolt.id]));
    const electricians = ids(await discoverMarketplaceProviders({ q: "electric" }));
    expect(electricians).toEqual(ids(all).filter((id) => electricians.includes(id)));
  });

  it("saves providers once per user, scoped to that user, and hides providers that leave the marketplace", async () => {
    const kwame = await listedProvider("Kwame & Sons", "plumbing", accra);
    const volt = await listedProvider("Volt Masters", "electrical", accra);
    const ama = await registerUser({ displayName: "Ama", email: "ama-saves@example.com", password: "secure-password-123" });
    const kofi = await registerUser({ displayName: "Kofi", email: "kofi-saves@example.com", password: "secure-password-123" });

    await saveProvider(ama.id, kwame.id);
    await saveProvider(ama.id, kwame.id);
    await Promise.all([saveProvider(ama.id, volt.id), saveProvider(ama.id, volt.id)]);
    expect(await db.savedServiceProvider.count({ where: { userId: ama.id } })).toBe(2);
    await expect(db.savedServiceProvider.create({ data: { userId: ama.id, providerId: kwame.id } }))
      .rejects.toSatisfy((error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");

    expect((await listSavedProviders(kofi.id)).items).toEqual([]);
    await unsaveProvider(kofi.id, kwame.id);
    expect(await db.savedServiceProvider.count({ where: { userId: ama.id } })).toBe(2);

    const before = await discoverMarketplaceProviders({});
    await saveProvider(kofi.id, volt.id);
    expect((await discoverMarketplaceProviders({})).items.map(({ id, ranking }) => [id, ranking.score])).toEqual(before.items.map(({ id, ranking }) => [id, ranking.score]));

    await db.serviceProvider.update({ where: { id: volt.id }, data: { suspendedAt: new Date(), suspensionReason: "Test" } });
    const saved = await listSavedProviders(ama.id);
    expect(saved.items.map(({ providerId, available }) => [providerId, available])).toEqual([[volt.id, false], [kwame.id, true]]);
    expect(saved.items[0].provider).toBeNull();
    expect(JSON.stringify(saved)).not.toContain("Volt Masters");
    await expect(saveProvider(kofi.id, volt.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await unsaveProvider(ama.id, kwame.id);
    await unsaveProvider(ama.id, kwame.id);
    expect((await listSavedProviders(ama.id)).items.map(({ providerId }) => providerId)).toEqual([volt.id]);
  });
});
