import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import {
  createListing,
  createMarketplaceLead,
  createViewingRequest,
  getListing,
  getPublicListing,
  getViewingRequest,
  listListings,
  listMarketplaceLeads,
  listViewingRequests,
  searchPublicListings,
  transitionListing,
  updateListing,
  updateListingVerification,
  updateMarketplaceLead,
  updateViewingRequest,
} from "@/modules/listings/service";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
}

const baseListing = (propertyId: string, unitId?: string) => ({
  propertyId,
  ...(unitId ? { unitId } : {}),
  listingType: "RENT" as const,
  category: "apartment",
  title: "Bright two-bedroom home",
  publicDescription: "A bright, well-maintained home with flexible viewing availability.",
  rentAmountMinor: "250000",
  currencyCode: "GHS",
  frequency: "MONTHLY" as const,
  availableFrom: "2026-09-01",
  bedrooms: 2,
  bathrooms: 1.5,
  sizeSqm: 88.5,
  countryCode: "GH",
  region: "Greater Accra",
  city: "Accra",
  district: "Osu",
  locality: "Oxford Street area",
  publicLocationLabel: "Osu, Accra",
  mapLatitude: 5.556,
  mapLongitude: -0.182,
  mapPrecision: "APPROXIMATE" as const,
  contactName: "Listing desk",
  contactEmail: "listings@example.com",
  showContactEmail: false,
  enquiryEnabled: true,
  privateNotes: "Private landlord note and internal pricing rationale.",
  amenities: [
    { key: "parking", label: "Parking", category: "access" },
    { key: "air-conditioning", label: "Air conditioning", category: "comfort", metadata: { units: 3 } },
  ],
  media: [
    {
      type: "PHOTO" as const,
      publicUrl: "https://cdn.example.com/listing/photo.jpg",
      storageKey: "private/listings/photo-original.jpg",
      mimeType: "image/jpeg",
      altText: "Living room",
      width: 1600,
      height: 900,
      fileSizeBytes: 123456,
      checksum: "sha256-public-readiness",
      metadata: { rendition: "hero" },
    },
    {
      type: "FLOOR_PLAN" as const,
      publicUrl: "https://cdn.example.com/listing/plan.pdf",
      mimeType: "application/pdf",
      sortOrder: 2,
    },
    {
      type: "VIDEO" as const,
      publicUrl: "https://cdn.example.com/listing/tour.mp4",
      mimeType: "video/mp4",
      durationSeconds: 45,
      sortOrder: 3,
      metadata: { streamingReady: true },
    },
  ],
});

async function verifyAndPublish(userId: string, organisationId: string, listingId: string) {
  await updateListingVerification(userId, organisationId, listingId, {
    status: "PENDING",
    evidence: [{
      type: "OWNERSHIP_OR_AUTHORITY",
      privateReference: "private/evidence/property-deed.pdf",
      metadata: { review: "manual-ready", kycPerformed: false },
    }],
  });
  await updateListingVerification(userId, organisationId, listingId, { status: "VERIFIED", note: "Asset authority checked." });
  await transitionListing(userId, organisationId, listingId, { status: "PENDING_REVIEW" });
  return transitionListing(userId, organisationId, listingId, { status: "PUBLISHED" });
}

describe("PostgreSQL Phase 9 property listing marketplace", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("validates property and unit scopes, pricing, controlled lifecycle, availability, immutable histories, and historical listings", async () => {
    const owner = await registerUser({ displayName: "Listing Owner", email: "listing-owner@example.com", password: "secure-password-123" });
    const other = await registerUser({ displayName: "Other Owner", email: "listing-other@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Listing Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(other.id, { name: "Other Listing Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, {
      name: "Listing House",
      referenceNumber: "LIST-001",
      category: "Residential",
      countryCode: "GH",
      currencyCode: "GHS",
      addressLine1: "Private exact address",
      units: [{ name: "A1", bedrooms: 2, bathrooms: 2 }, { name: "A2", bedrooms: 1, bathrooms: 1 }],
    });
    const otherProperty = await createProperty(other.id, otherOrganisation.id, {
      name: "Other House",
      referenceNumber: "OTHER-LIST-001",
      category: "Residential",
      countryCode: "GH",
      currencyCode: "GHS",
      units: [{ name: "B1" }],
    });
    const [unit, otherUnit] = await Promise.all([
      db.unit.findFirstOrThrow({ where: { propertyId: property.id, name: "A1" } }),
      db.unit.findFirstOrThrow({ where: { propertyId: otherProperty.id } }),
    ]);

    await expect(createListing(owner.id, organisation.id, {
      ...baseListing(property.id, otherUnit.id),
    })).rejects.toMatchObject({ code: "INVALID_LISTING_UNIT" });
    await expect(createListing(owner.id, organisation.id, {
      ...baseListing(property.id, unit.id),
      listingType: "SALE",
    })).rejects.toBeTruthy();
    await expect(createListing(owner.id, organisation.id, {
      ...baseListing(property.id, unit.id),
      countryCode: "NG",
    })).rejects.toMatchObject({ code: "LISTING_LOCATION_MISMATCH" });

    const listing = await createListing(owner.id, organisation.id, baseListing(property.id, unit.id));
    expect(listing).toMatchObject({
      status: "DRAFT",
      verificationStatus: "UNVERIFIED",
      propertyId: property.id,
      unitId: unit.id,
    });
    await expect(transitionListing(owner.id, organisation.id, listing.id, { status: "PUBLISHED" }))
      .rejects.toMatchObject({ code: "INVALID_LISTING_TRANSITION" });
    await transitionListing(owner.id, organisation.id, listing.id, { status: "PENDING_REVIEW" });
    await expect(transitionListing(owner.id, organisation.id, listing.id, { status: "PUBLISHED" }))
      .rejects.toMatchObject({ code: "LISTING_NOT_VERIFIED" });
    await transitionListing(owner.id, organisation.id, listing.id, { status: "DRAFT", note: "Add evidence." });
    await expect(updateListingVerification(owner.id, organisation.id, listing.id, { status: "PENDING" }))
      .rejects.toMatchObject({ code: "VERIFICATION_EVIDENCE_REQUIRED" });
    const published = await verifyAndPublish(owner.id, organisation.id, listing.id);
    expect(published.publishedAt).toBeInstanceOf(Date);

    await transitionListing(owner.id, organisation.id, listing.id, { status: "PAUSED" });
    await updateListing(owner.id, organisation.id, listing.id, { title: "Updated while safely paused" });
    await transitionListing(owner.id, organisation.id, listing.id, { status: "PUBLISHED" });
    await transitionListing(owner.id, organisation.id, listing.id, { status: "RESERVED" });
    expect((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).status).toBe("RESERVED");
    await transitionListing(owner.id, organisation.id, listing.id, { status: "PUBLISHED" });
    expect((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).status).toBe("AVAILABLE");
    await transitionListing(owner.id, organisation.id, listing.id, { status: "RENTED" });
    expect((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).status).toBe("OCCUPIED");
    await transitionListing(owner.id, organisation.id, listing.id, { status: "ARCHIVED" });

    const historical = await createListing(owner.id, organisation.id, {
      ...baseListing(property.id, unit.id),
      title: "Future historical listing record",
    });
    expect((await listListings(owner.id, organisation.id, { unitId: unit.id })).items.map(({ id }) => id))
      .toEqual(expect.arrayContaining([listing.id, historical.id]));

    const rejectedProperty = await createProperty(owner.id, organisation.id, {
      name: "Sale House",
      referenceNumber: "LIST-SALE",
      category: "Residential",
      countryCode: "GH",
      currencyCode: "GHS",
    });
    const sale = await createListing(owner.id, organisation.id, {
      ...baseListing(rejectedProperty.id),
      listingType: "SALE",
      askingAmountMinor: "75000000",
      rentAmountMinor: null,
      frequency: null,
      title: "House offered for sale",
    });
    await updateListingVerification(owner.id, organisation.id, sale.id, {
      status: "PENDING",
      evidence: [{ type: "AUTHORITY", privateReference: "private/evidence/sale-authority.pdf" }],
    });
    await updateListingVerification(owner.id, organisation.id, sale.id, { status: "REJECTED", note: "Needs another review." });
    await updateListingVerification(owner.id, organisation.id, sale.id, { status: "PENDING" });
    await updateListingVerification(owner.id, organisation.id, sale.id, { status: "VERIFIED" });
    await transitionListing(owner.id, organisation.id, sale.id, { status: "PENDING_REVIEW" });
    await transitionListing(owner.id, organisation.id, sale.id, { status: "REJECTED", note: "Evidence incomplete." });
    await transitionListing(owner.id, organisation.id, sale.id, { status: "DRAFT" });
    await transitionListing(owner.id, organisation.id, sale.id, { status: "PENDING_REVIEW" });
    await transitionListing(owner.id, organisation.id, sale.id, { status: "PUBLISHED" });
    const suspended = await updateListingVerification(owner.id, organisation.id, sale.id, { status: "SUSPENDED", note: "Recheck required." });
    expect(suspended).toMatchObject({ status: "PAUSED", verificationStatus: "SUSPENDED" });
    await updateListingVerification(owner.id, organisation.id, sale.id, { status: "PENDING" });
    await updateListingVerification(owner.id, organisation.id, sale.id, { status: "VERIFIED" });
    await transitionListing(owner.id, organisation.id, sale.id, { status: "ARCHIVED" });

    const statusHistory = await db.listingStatusHistory.findMany({ where: { listingId: listing.id }, orderBy: { createdAt: "asc" } });
    expect(statusHistory.map(({ toStatus }) => toStatus)).toEqual([
      "DRAFT", "PENDING_REVIEW", "DRAFT", "PENDING_REVIEW", "PUBLISHED", "PAUSED", "PUBLISHED", "RESERVED", "PUBLISHED", "RENTED", "ARCHIVED",
    ]);
    await expect(db.listingStatusHistory.update({
      where: { id: statusHistory[0].id },
      data: { note: "rewrite history" },
    })).rejects.toBeTruthy();
    await expect(db.listing.update({ where: { id: historical.id }, data: { status: "ARCHIVED" } })).rejects.toBeTruthy();
    expect(await db.listingVerificationEvidence.count({ where: { listingId: listing.id } })).toBe(1);
    const evidence = await db.listingVerificationEvidence.findFirstOrThrow({ where: { listingId: listing.id } });
    await expect(db.listingVerificationEvidence.delete({ where: { id: evidence.id } })).rejects.toBeTruthy();
  });

  it("searches safe public projections with intersection filters, pagination, map readiness, and actual managed-asset availability", async () => {
    const owner = await registerUser({ displayName: "Search Owner", email: "search-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Private Search Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, {
      name: "Private managed property name",
      referenceNumber: "SEARCH-001",
      category: "Residential",
      countryCode: "GH",
      currencyCode: "GHS",
      addressLine1: "14 Private Exact Address",
      units: [{ name: "Search Unit", bedrooms: 2, bathrooms: 2 }],
    });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const listing = await createListing(owner.id, organisation.id, baseListing(property.id, unit.id));
    await verifyAndPublish(owner.id, organisation.id, listing.id);

    const filters = {
      q: "bright home",
      listingType: "RENT",
      category: "apartment",
      scope: "UNIT",
      minPriceMinor: "200000",
      maxPriceMinor: "300000",
      currencyCode: "ghs",
      frequency: "MONTHLY",
      availableOn: "2026-09-02",
      bedroomsMin: "2",
      bedroomsMax: "2",
      bathroomsMin: "1.5",
      bathroomsMax: "2",
      sizeMinSqm: "80",
      sizeMaxSqm: "100",
      country: "gh",
      state: "Greater Accra",
      city: "Accra",
      district: "Osu",
      amenities: "parking,air-conditioning",
      mediaTypes: "PHOTO,VIDEO,FLOOR_PLAN",
      page: "1",
      pageSize: "1",
    };
    const result = await searchPublicListings(filters);
    expect(result.items).toHaveLength(1);
    expect(result.pagination).toEqual({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
    expect(result.meta).toMatchObject({
      amenityMatching: "intersection",
      availability: "managed-asset-and-active-lease-linked",
      // Phase 19: no live geocoding provider is configured in tests, so the deterministic fallback
      // is active and real external credentials would be required for full address geocoding.
      map: { credentialsRequired: true, countryNeutral: true },
      rateLimit: { enforcement: "gateway-ready", keyStrategy: "ip+route" },
    });
    expect(result.items[0]).toMatchObject({
      id: listing.id,
      scope: "UNIT",
      pricing: { rentAmountMinor: "250000", currencyCode: "GHS", frequency: "MONTHLY" },
      availability: { actual: true },
      attributes: { bedrooms: 2, bathrooms: "1.5", sizeSqm: "88.5" },
      location: {
        countryCode: "GH",
        map: { latitude: "5.556", longitude: "-0.182", precision: "APPROXIMATE", credentialsRequired: false },
      },
      verification: { status: "VERIFIED", evidenceReady: true },
    });
    expect((await getPublicListing(listing.id)).listing.id).toBe(listing.id);
    expect((await searchPublicListings({ amenities: "parking,pool" })).items).toHaveLength(0);
    expect((await searchPublicListings({ minPriceMinor: "300001" })).items).toHaveLength(0);
    await expect(searchPublicListings({ country: "GH", pageSize: "500" })).rejects.toBeTruthy();
    await expect(searchPublicListings({ city: "Accra" })).rejects.toBeTruthy();

    const serialized = JSON.stringify(result);
    for (const privateValue of [
      organisation.id,
      organisation.name,
      property.id,
      unit.id,
      "Private managed property name",
      "14 Private Exact Address",
      "Private landlord note",
      "private/evidence/property-deed.pdf",
      "private/listings/photo-original.jpg",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    for (const privateKey of [
      "organisationId", "propertyId", "unitId", "owner", "tenant", "lease", "payment",
      "maintenance", "ledger", "audit", "privateNotes", "privateReference", "storageKey",
    ]) {
      expect(serialized).not.toContain(`"${privateKey}"`);
    }

    await db.unit.update({ where: { id: unit.id }, data: { status: "MAINTENANCE" } });
    expect((await searchPublicListings({ country: "GH" })).items).toHaveLength(0);
    await expect(getPublicListing(listing.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.unit.update({ where: { id: unit.id }, data: { status: "AVAILABLE" } });
    await db.lease.create({
      data: {
        organisationId: organisation.id,
        propertyId: property.id,
        unitId: unit.id,
        referenceNumber: "PRIVATE-ACTIVE-LEASE",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2027-01-01"),
        rentAmountMinor: "100000",
        currencyCode: "GHS",
        rentFrequency: "MONTHLY",
        status: "ACTIVE",
        notes: "Private tenant and lease notes.",
      },
    });
    expect((await searchPublicListings({ country: "GH" })).items).toHaveLength(0);
  });

  it("captures anonymous and authenticated leads separately from tenants, manages viewings with RBAC and organisation isolation, and emits transactional events", async () => {
    const owner = await registerUser({ displayName: "Lead Owner", email: "lead-owner@example.com", password: "secure-password-123" });
    const visitor = await registerUser({ displayName: "Authenticated Visitor", email: "visitor@example.com", password: "secure-password-123" });
    const outsider = await registerUser({ displayName: "Outsider", email: "lead-outsider@example.com", password: "secure-password-123" });
    const viewer = await registerUser({ displayName: "Viewer", email: "lead-viewer@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Lead Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(outsider.id, { name: "Other Lead Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, {
      name: "Lead House",
      referenceNumber: "LEAD-001",
      category: "Residential",
      countryCode: "GH",
      currencyCode: "GHS",
    });
    const listing = await createListing(owner.id, organisation.id, baseListing(property.id));
    await verifyAndPublish(owner.id, organisation.id, listing.id);

    const anonymous = await createMarketplaceLead(listing.id, undefined, {
      name: "Anonymous Lead",
      phone: "+233200000001",
      message: "Please contact me.",
      source: "public-listing",
    });
    const authenticated = await createMarketplaceLead(listing.id, visitor.id, {
      name: "Authenticated Visitor",
      email: "visitor@example.com",
      marketingConsent: true,
    });
    expect(await db.marketplaceLead.count({ where: { listingId: listing.id } })).toBe(2);
    expect(await db.tenant.count()).toBe(0);
    expect((await db.marketplaceLead.findUniqueOrThrow({ where: { id: authenticated.id } })).userId).toBe(visitor.id);

    const viewing = await createViewingRequest(listing.id, visitor.id, {
      leadId: authenticated.id,
      preferredTimes: [
        { startsAt: "2027-01-10T10:00:00Z", endsAt: "2027-01-10T11:00:00Z", timezone: "Africa/Accra" },
        { startsAt: "2027-01-11T14:00:00Z", endsAt: "2027-01-11T15:00:00Z", timezone: "Africa/Accra" },
      ],
      requesterNote: "Afternoon preferred.",
    });
    await expect(createViewingRequest(listing.id, outsider.id, {
      leadId: authenticated.id,
      preferredTimes: [{ startsAt: "2027-01-12T10:00:00Z", endsAt: "2027-01-12T11:00:00Z", timezone: "UTC" }],
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const ownerMember = await db.organisationMember.findFirstOrThrow({ where: { organisationId: organisation.id, userId: owner.id } });
    const outsiderMember = await db.organisationMember.findFirstOrThrow({ where: { organisationId: otherOrganisation.id, userId: outsider.id } });
    await expect(updateViewingRequest(owner.id, organisation.id, viewing.id, { assigneeMemberId: outsiderMember.id }))
      .rejects.toMatchObject({ code: "INVALID_VIEWING_ASSIGNEE" });
    await updateViewingRequest(owner.id, organisation.id, viewing.id, {
      assigneeMemberId: ownerMember.id,
      privateNotes: "Private access instructions.",
      status: "CONFIRMED",
      confirmedStartsAt: "2027-01-10T10:00:00Z",
      confirmedEndsAt: "2027-01-10T11:00:00Z",
    });
    await updateViewingRequest(owner.id, organisation.id, viewing.id, { status: "RESCHEDULED" });
    await updateViewingRequest(owner.id, organisation.id, viewing.id, {
      status: "CONFIRMED",
      confirmedStartsAt: "2027-01-11T14:00:00Z",
      confirmedEndsAt: "2027-01-11T15:00:00Z",
    });
    await updateViewingRequest(owner.id, organisation.id, viewing.id, { status: "COMPLETED" });
    await updateMarketplaceLead(owner.id, organisation.id, authenticated.id, { status: "CLOSED", privateNotes: "Converted outside tenant workflow." });
    const anonymousViewing = await createViewingRequest(listing.id, undefined, {
      leadId: anonymous.id,
      preferredTimes: [{ startsAt: "2027-02-10T10:00:00Z", endsAt: "2027-02-10T11:00:00Z", timezone: "Africa/Accra" }],
    });
    await updateViewingRequest(owner.id, organisation.id, anonymousViewing.id, { status: "CANCELLED" });
    await updateMarketplaceLead(owner.id, organisation.id, anonymous.id, { status: "CONTACTED" });
    await updateMarketplaceLead(owner.id, organisation.id, anonymous.id, { status: "QUALIFIED" });
    await updateMarketplaceLead(owner.id, organisation.id, anonymous.id, { status: "LOST" });

    expect((await listMarketplaceLeads(owner.id, organisation.id)).items).toHaveLength(2);
    expect((await listViewingRequests(owner.id, organisation.id)).items).toHaveLength(2);
    expect((await getViewingRequest(owner.id, organisation.id, viewing.id)).history.map(({ toStatus }) => toStatus))
      .toEqual(["REQUESTED", "CONFIRMED", "RESCHEDULED", "CONFIRMED", "COMPLETED"]);
    expect((await listMarketplaceLeads(outsider.id, otherOrganisation.id)).items).toHaveLength(0);
    expect((await listViewingRequests(outsider.id, otherOrganisation.id)).items).toHaveLength(0);
    await expect(getListing(outsider.id, otherOrganisation.id, listing.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const viewerRole = await db.role.findUniqueOrThrow({ where: { key: "viewer" } });
    const viewerMember = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: viewer.id } });
    await db.membershipRole.create({ data: { memberId: viewerMember.id, roleId: viewerRole.id } });
    expect((await listMarketplaceLeads(viewer.id, organisation.id)).items).toHaveLength(2);
    expect((await listViewingRequests(viewer.id, organisation.id)).items).toHaveLength(2);
    expect((await listListings(viewer.id, organisation.id)).items).toHaveLength(1);
    await expect(updateListing(viewer.id, organisation.id, listing.id, { title: "Cannot update" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateMarketplaceLead(viewer.id, organisation.id, anonymous.id, { status: "LOST" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateViewingRequest(viewer.id, organisation.id, viewing.id, { privateNotes: "Cannot write" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    const leadHistory = await db.marketplaceLeadStatusHistory.findFirstOrThrow({ where: { leadId: authenticated.id } });
    await expect(db.marketplaceLeadStatusHistory.delete({ where: { id: leadHistory.id } })).rejects.toBeTruthy();
    const viewingHistory = await db.viewingRequestStatusHistory.findFirstOrThrow({ where: { viewingRequestId: viewing.id } });
    await expect(db.viewingRequestStatusHistory.update({ where: { id: viewingHistory.id }, data: { note: "rewrite" } }))
      .rejects.toBeTruthy();
    for (const eventName of [
      "listing.created",
      "listing.verification_submitted",
      "listing.verification_verified",
      "listing.published",
      "listing.lead_created",
      "listing.viewing_requested",
      "listing.viewing_status_changed",
      "listing.lead_status_changed",
    ]) {
      expect(await db.domainEvent.count({ where: { organisationId: organisation.id, name: eventName } }), eventName)
        .toBeGreaterThan(0);
      expect(await db.auditEvent.count({ where: { organisationId: organisation.id, action: eventName } }), eventName)
        .toBeGreaterThan(0);
    }
  });
});
