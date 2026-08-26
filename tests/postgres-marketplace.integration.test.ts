import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createMaintenanceRequest, createWorkOrder, transitionMaintenanceRequest } from "@/modules/maintenance/service";
import {
  addProviderToDirectory,
  createServiceProvider,
  listServiceCategories,
  reviewProviderVerification,
  submitProviderVerification,
  updateServiceProvider,
} from "@/modules/providers/service";
import {
  createMarketplaceEnquiry,
  discoverMarketplaceProviders,
  getMarketplaceEnquiry,
  getPublicMarketplaceProvider,
  listMarketplaceEnquiries,
  requestMarketplaceQuote,
  updateMarketplaceEnquiry,
  updateMarketplaceProfile,
} from "@/modules/marketplace/service";

async function cleanDatabase() {
  await db.$executeRaw`TRUNCATE TABLE "MarketplaceEnquiryStatusHistory", "ProviderMarketplaceProfileHistory"`;
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
  await db.organisation.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
}

describe("PostgreSQL Phase 8 provider marketplace", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("provides explicit profiles, safe public discovery, explainable deterministic ranking, filters, and immutable visibility history", async () => {
    const landlord = await registerUser({ displayName: "Marketplace Landlord", email: "market-landlord@example.com", password: "secure-password-123" });
    const artisanA = await registerUser({ displayName: "Artisan A", email: "artisan-a@example.com", password: "secure-password-123" });
    const artisanB = await registerUser({ displayName: "Artisan B", email: "artisan-b@example.com", password: "secure-password-123" });
    const outsider = await registerUser({ displayName: "Marketplace Outsider", email: "market-outsider@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(landlord.id, { name: "Marketplace Landlord Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const categories = await listServiceCategories();
    const plumbingCategory = categories.find(({ key }) => key === "plumbing")!;
    const electricalCategory = categories.find(({ key }) => key === "electrical")!;

    const providerA = await createServiceProvider(artisanA.id, {
      type: "INDIVIDUAL",
      displayName: "Private Alpha Plumbing",
      contactEmail: "artisan-a@example.com",
      contactPhone: "+233200000001",
      biography: "Private biography must never become public.",
      categoryIds: [plumbingCategory.id],
      serviceAreas: [{ areaType: "private-directory-zone", name: "Private landlord area", metadata: { note: "secret" } }],
    });
    const providerB = await createServiceProvider(artisanB.id, {
      type: "INDIVIDUAL",
      displayName: "Beta Electrical",
      contactEmail: "artisan-b@example.com",
      categoryIds: [electricalCategory.id],
    });
    await addProviderToDirectory(landlord.id, organisation.id, { providerId: providerA.id, internalNotes: "Never public" });
    await submitProviderVerification(artisanA.id, providerA.id, {
      evidence: [{ type: "IDENTITY", reference: "private/evidence/a" }],
    });
    await reviewProviderVerification(landlord.id, organisation.id, providerA.id, { status: "VERIFIED" });
    await updateServiceProvider(artisanA.id, providerA.id, {
      availabilityStatus: "AVAILABLE",
      acceptingWork: true,
    });
    await updateServiceProvider(artisanB.id, providerB.id, { availabilityStatus: "LIMITED" });

    await expect(updateMarketplaceProfile(outsider.id, providerA.id, { listed: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateMarketplaceProfile(artisanA.id, providerA.id, { listed: true }))
      .rejects.toMatchObject({ code: "INCOMPLETE_MARKETPLACE_PROFILE" });

    await updateMarketplaceProfile(artisanA.id, providerA.id, {
      listed: true,
      publicDescription: "Public plumbing and repairs.",
      showContactEmail: false,
      showContactPhone: false,
      startingRateMinor: "25000",
      currencyCode: "ghs",
      responseTimeHours: 4,
      categoryIds: [plumbingCategory.id],
      serviceAreas: [{
        countryCode: "gh",
        region: "Greater Accra",
        city: "Accra",
        district: "Osu",
        label: "Central Accra",
        latitude: 5.556,
        longitude: -0.182,
        radiusKm: 15,
      }],
    });
    await updateMarketplaceProfile(artisanB.id, providerB.id, {
      listed: true,
      publicDescription: "Electrical call-outs.",
      categoryIds: [electricalCategory.id],
      serviceAreas: [{ countryCode: "GH", region: "Greater Accra", city: "Accra", district: "Osu" }],
    });

    const property = await createProperty(landlord.id, organisation.id, {
      name: "Ranking House",
      referenceNumber: "MARKET-RANK",
      category: "Residential",
      countryCode: "GH",
      currencyCode: "GHS",
    });
    const maintenance = await createMaintenanceRequest(landlord.id, organisation.id, {
      propertyId: property.id,
      title: "Ranking repair",
      description: "Fixture for completed marketplace work",
      category: "plumbing",
    });
    await transitionMaintenanceRequest(landlord.id, organisation.id, maintenance.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(landlord.id, organisation.id, maintenance.id, {
      title: "Completed marketplace job",
      currencyCode: "GHS",
    });
    await db.workOrder.update({ where: { id: workOrder.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await db.providerAssignment.create({
      data: {
        landlordOrganisationId: organisation.id,
        workOrderId: workOrder.id,
        providerId: providerA.id,
        assignedByUserId: landlord.id,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
    await db.providerRating.create({
      data: {
        landlordOrganisationId: organisation.id,
        workOrderId: workOrder.id,
        providerId: providerA.id,
        createdByUserId: landlord.id,
        score: 5,
        comment: "Private landlord review text",
      },
    });

    const filters = {
      category: "plumbing",
      country: "gh",
      state: "Greater Accra",
      city: "Accra",
      district: "Osu",
      availability: "AVAILABLE",
      verification: "VERIFIED",
      minimumRating: "4.5",
      page: "1",
      pageSize: "1",
    };
    const first = await discoverMarketplaceProviders(filters);
    const second = await discoverMarketplaceProviders(filters);
    expect(first.items.map(({ id }) => id)).toEqual(second.items.map(({ id }) => id));
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      id: providerA.id,
      description: "Public plumbing and repairs.",
      availability: "AVAILABLE",
      verification: "VERIFIED",
      contact: { email: null, phone: null },
      pricing: { startingRateMinor: "25000", currencyCode: "GHS" },
      aggregateRating: 5,
      ratingCount: 1,
      completedJobs: 1,
      ranking: {
        signals: {
          categoryMatch: 30,
          areaMatch: 40,
          verification: 15,
          availability: 10,
          aggregateRating: 20,
          completedJobs: 1,
          ratesAndResponseReadiness: 10,
        },
      },
    });
    expect(first.meta.ranking.privateSignalsUsed).toBe(false);
    expect(first.meta.rateLimit).toMatchObject({ limit: 120, keyStrategy: "ip+route" });
    expect((await discoverMarketplaceProviders({ categoryId: plumbingCategory.id })).items.map(({ id }) => id))
      .toEqual([providerA.id]);
    const secondPage = await discoverMarketplaceProviders({ country: "GH", page: "2", pageSize: "1" });
    expect(secondPage.pagination).toMatchObject({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
    expect(secondPage.items).toHaveLength(1);
    await expect(discoverMarketplaceProviders({ country: "GH", pageSize: "500" })).rejects.toBeTruthy();

    const serialized = JSON.stringify(first);
    for (const privateValue of [
      "private/evidence/a",
      "Private biography",
      "Private landlord area",
      "Never public",
      "Private landlord review text",
      organisation.name,
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(serialized).not.toContain("artisan-a@example.com");
    expect(serialized).not.toContain("+233200000001");

    await updateMarketplaceProfile(artisanA.id, providerA.id, { showContactEmail: true });
    expect((await getPublicMarketplaceProvider(providerA.id)).provider.contact.email).toBe("artisan-a@example.com");
    expect(await db.domainEvent.count({ where: { name: "marketplace.provider_viewed" } })).toBe(0);
    await updateMarketplaceProfile(artisanA.id, providerA.id, { listed: false });
    expect((await discoverMarketplaceProviders({ country: "GH" })).items.map(({ id }) => id)).not.toContain(providerA.id);
    await expect(getPublicMarketplaceProvider(providerA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const history = await db.providerMarketplaceProfileHistory.findMany({ where: { providerId: providerA.id }, orderBy: { createdAt: "asc" } });
    expect(history.map(({ action }) => action)).toEqual([
      "provider.marketplace_listed",
      "provider.marketplace_profile_updated",
      "provider.marketplace_unlisted",
    ]);
    await expect(db.providerMarketplaceProfileHistory.update({
      where: { id: history[0].id },
      data: { action: "rewritten" },
    })).rejects.toBeTruthy();
  });

  it("isolates landlord enquiries, permits provider-owner status access, reuses quotation workflow and directory identity, and enforces readiness", async () => {
    const landlord = await registerUser({ displayName: "Enquiry Landlord", email: "enquiry-landlord@example.com", password: "secure-password-123" });
    const otherLandlord = await registerUser({ displayName: "Other Enquiry Landlord", email: "enquiry-other@example.com", password: "secure-password-123" });
    const providerUser = await registerUser({ displayName: "Enquiry Provider", email: "enquiry-provider@example.com", password: "secure-password-123" });
    const unreadyUser = await registerUser({ displayName: "Unready Provider", email: "enquiry-unready@example.com", password: "secure-password-123" });
    const viewer = await registerUser({ displayName: "Enquiry Viewer", email: "enquiry-viewer@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(landlord.id, { name: "Enquiry Landlord Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(otherLandlord.id, { name: "Other Enquiry Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const plumbing = (await listServiceCategories()).find(({ key }) => key === "plumbing")!;
    const provider = await createServiceProvider(providerUser.id, {
      type: "INDIVIDUAL",
      displayName: "Enquiry Provider",
      contactEmail: "enquiry-provider@example.com",
      categoryIds: [plumbing.id],
    });
    const unready = await createServiceProvider(unreadyUser.id, {
      type: "INDIVIDUAL",
      displayName: "Unready Provider",
      contactEmail: "enquiry-unready@example.com",
      categoryIds: [plumbing.id],
    });
    await addProviderToDirectory(landlord.id, organisation.id, { providerId: provider.id });
    await submitProviderVerification(providerUser.id, provider.id, {
      evidence: [{ type: "IDENTITY", reference: "private/enquiry-evidence" }],
    });
    await reviewProviderVerification(landlord.id, organisation.id, provider.id, { status: "VERIFIED" });
    await updateServiceProvider(providerUser.id, provider.id, {
      availabilityStatus: "AVAILABLE",
      acceptingWork: true,
    });
    await updateMarketplaceProfile(providerUser.id, provider.id, {
      listed: true,
      categoryIds: [plumbing.id],
      serviceAreas: [{ countryCode: "GH", city: "Accra" }],
    });
    await updateMarketplaceProfile(unreadyUser.id, unready.id, {
      listed: true,
      categoryIds: [plumbing.id],
      serviceAreas: [{ countryCode: "GH", city: "Accra" }],
    });

    const property = await createProperty(landlord.id, organisation.id, {
      name: "Enquiry House",
      referenceNumber: "MARKET-ENQUIRY",
      category: "Residential",
      countryCode: "GH",
      currencyCode: "GHS",
    });
    const otherProperty = await createProperty(otherLandlord.id, otherOrganisation.id, {
      name: "Other House",
      referenceNumber: "OTHER-ENQUIRY",
      category: "Residential",
      countryCode: "GH",
      currencyCode: "GHS",
    });
    const maintenance = await createMaintenanceRequest(landlord.id, organisation.id, {
      propertyId: property.id,
      title: "Marketplace plumbing request",
      description: "Obtain a direct provider quote",
      category: "plumbing",
    });
    await expect(createMarketplaceEnquiry(landlord.id, organisation.id, {
      providerId: provider.id,
      categoryId: plumbing.id,
      propertyId: otherProperty.id,
      message: "Cross-organisation scope",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const enquiry = await createMarketplaceEnquiry(landlord.id, organisation.id, {
      providerId: provider.id,
      categoryId: plumbing.id,
      propertyId: property.id,
      maintenanceRequestId: maintenance.id,
      message: "Please quote for this scoped repair.",
    });
    expect(enquiry).toMatchObject({ status: "NEW", requestingOrganisationId: organisation.id, providerId: provider.id });
    await expect(getMarketplaceEnquiry(otherLandlord.id, otherOrganisation.id, enquiry.id))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listMarketplaceEnquiries(landlord.id, organisation.id)).items).toHaveLength(1);
    const providerInbox = await listMarketplaceEnquiries(providerUser.id, null, { providerId: provider.id });
    expect(providerInbox.items).toHaveLength(1);
    expect(JSON.stringify(providerInbox)).not.toContain("private/enquiry-evidence");
    expect((await listMarketplaceEnquiries(unreadyUser.id, null, { providerId: unready.id })).items).toHaveLength(0);

    await expect(updateMarketplaceEnquiry(landlord.id, organisation.id, enquiry.id, { status: "VIEWED" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateMarketplaceEnquiry(providerUser.id, null, enquiry.id, { status: "VIEWED" });
    await updateMarketplaceEnquiry(providerUser.id, null, enquiry.id, { status: "RESPONDED", note: "Ready to quote" });
    expect((await getMarketplaceEnquiry(landlord.id, organisation.id, enquiry.id)).history.map(({ toStatus }) => toStatus))
      .toEqual(["NEW", "VIEWED", "RESPONDED"]);

    await db.providerOrganisation.delete({
      where: {
        landlordOrganisationId_providerId: {
          landlordOrganisationId: organisation.id,
          providerId: provider.id,
        },
      },
    });
    const quote = await requestMarketplaceQuote(landlord.id, organisation.id, enquiry.id, { scope: "Quote labour and materials" });
    const reused = await requestMarketplaceQuote(landlord.id, organisation.id, enquiry.id, { scope: "Do not duplicate" });
    expect(reused.id).toBe(quote.id);
    expect(await db.providerQuotationRequest.count({ where: { providerId: provider.id, maintenanceRequestId: maintenance.id } })).toBe(1);
    expect(await db.providerOrganisation.count({ where: { providerId: provider.id, landlordOrganisationId: organisation.id } })).toBe(1);
    expect(await db.serviceProvider.count({ where: { individualUserId: providerUser.id } })).toBe(1);

    const unreadyEnquiry = await createMarketplaceEnquiry(landlord.id, organisation.id, {
      providerId: unready.id,
      categoryId: plumbing.id,
      maintenanceRequestId: maintenance.id,
      message: "This enquiry is allowed, but a quote request is not.",
    });
    await expect(requestMarketplaceQuote(landlord.id, organisation.id, unreadyEnquiry.id, { scope: "Must fail readiness" }))
      .rejects.toMatchObject({ code: "PROVIDER_NOT_READY" });

    const viewerRole = await db.role.findUniqueOrThrow({ where: { key: "viewer" } });
    const viewerMember = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: viewer.id } });
    await db.membershipRole.create({ data: { memberId: viewerMember.id, roleId: viewerRole.id } });
    expect((await listMarketplaceEnquiries(viewer.id, organisation.id)).items).toHaveLength(2);
    await expect(createMarketplaceEnquiry(viewer.id, organisation.id, {
      providerId: provider.id,
      categoryId: plumbing.id,
      message: "Viewer cannot create",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await updateMarketplaceEnquiry(landlord.id, organisation.id, enquiry.id, { status: "CLOSED" });
    await expect(updateMarketplaceEnquiry(landlord.id, organisation.id, enquiry.id, { status: "CANCELLED" }))
      .rejects.toMatchObject({ code: "INVALID_ENQUIRY_TRANSITION" });
    const history = await db.marketplaceEnquiryStatusHistory.findFirstOrThrow({ where: { enquiryId: enquiry.id } });
    await expect(db.marketplaceEnquiryStatusHistory.delete({ where: { id: history.id } })).rejects.toBeTruthy();

    for (const eventName of ["marketplace.enquiry_created", "marketplace.enquiry_updated", "marketplace.quote_requested"]) {
      expect(await db.domainEvent.count({ where: { organisationId: organisation.id, name: eventName } }), eventName)
        .toBeGreaterThan(0);
    }
  });
});
