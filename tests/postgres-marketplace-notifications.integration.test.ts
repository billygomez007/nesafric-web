import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createListing, createMarketplaceLead, createViewingRequest, updateListingVerification, transitionListing, updateMarketplaceLead } from "@/modules/listings/service";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
}

const baseListing = (propertyId: string) => ({
  propertyId,
  listingType: "RENT" as const,
  category: "apartment",
  title: "Sunset Ridge Apartment",
  publicDescription: "A well-maintained two-bedroom apartment.",
  rentAmountMinor: "250000",
  currencyCode: "GHS",
  frequency: "MONTHLY" as const,
  availableFrom: "2026-09-01",
  countryCode: "GH",
  enquiryEnabled: true,
  media: [{ type: "PHOTO" as const, publicUrl: "https://cdn.example.com/listing/photo.jpg", mimeType: "image/jpeg", sortOrder: 1 }],
});

async function verifyAndPublish(userId: string, organisationId: string, listingId: string) {
  await updateListingVerification(userId, organisationId, listingId, {
    status: "PENDING",
    evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/evidence/deed.pdf", metadata: {} }],
  });
  await updateListingVerification(userId, organisationId, listingId, { status: "VERIFIED", note: "Checked." });
  await transitionListing(userId, organisationId, listingId, { status: "PENDING_REVIEW" });
  await transitionListing(userId, organisationId, listingId, { status: "PUBLISHED" });
}

function jobsFor(userId: string, template: string) {
  return db.backgroundJob.findMany({ where: { type: "account-email" } }).then((jobs) =>
    jobs.filter((job) => {
      const payload = job.payload as { userId?: string; template?: string };
      return payload.userId === userId && payload.template === template;
    }),
  );
}

describe("PostgreSQL marketplace lead/viewing email notifications", () => {
  beforeEach(cleanDatabase);
  afterAll(cleanDatabase);

  it("notifies the listing's creator of a brand-new lead, with prospect contact details and a link to the lead", async () => {
    const owner = await registerUser({ displayName: "Ama Owner", email: "ama-owner@marketplace-notif.test", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Accra Estates", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, { name: "Sunset Ridge", referenceNumber: "SR-001", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const listing = await createListing(owner.id, organisation.id, baseListing(property.id));
    await verifyAndPublish(owner.id, organisation.id, listing.id);

    const lead = await createMarketplaceLead(listing.id, undefined, { name: "Kojo Prospect", email: "kojo@example.com", phone: "+233200000099", message: "Interested." });

    const jobs = await jobsFor(owner.id, "MARKETPLACE_LEAD_CREATED");
    expect(jobs).toHaveLength(1);
    const payload = jobs[0].payload as { listingTitle?: string; leadId?: string; prospectName?: string; prospectEmail?: string; prospectPhone?: string };
    expect(payload.listingTitle).toBe("Sunset Ridge Apartment");
    expect(payload.leadId).toBe(lead.id);
    expect(payload.prospectName).toBe("Kojo Prospect");
    expect(payload.prospectEmail).toBe("kojo@example.com");
    expect(payload.prospectPhone).toBe("+233200000099");
  });

  it("sends exactly one lead notification even if creation were somehow retried for the same lead", async () => {
    const owner = await registerUser({ displayName: "Efo Owner", email: "efo-owner@marketplace-notif.test", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Kumasi Homes", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, { name: "Kumasi Villa", referenceNumber: "KV-001", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const listing = await createListing(owner.id, organisation.id, baseListing(property.id));
    await verifyAndPublish(owner.id, organisation.id, listing.id);

    const lead = await createMarketplaceLead(listing.id, undefined, { name: "Yaw Prospect", email: "yaw@example.com" });
    const jobs = await jobsFor(owner.id, "MARKETPLACE_LEAD_CREATED");
    expect(jobs).toHaveLength(1);
    // Every lead is a genuinely distinct row/event — a second, different lead must get its own
    // notification rather than colliding with the first.
    const secondLead = await createMarketplaceLead(listing.id, undefined, { name: "Abena Prospect", email: "abena@example.com" });
    const jobsAfterSecondLead = await jobsFor(owner.id, "MARKETPLACE_LEAD_CREATED");
    expect(jobsAfterSecondLead).toHaveLength(2);
    expect(lead.id).not.toBe(secondLead.id);
  });

  it("notifies the lead's assigned team member (not the listing creator) once a viewing is requested after assignment", async () => {
    const owner = await registerUser({ displayName: "Kwabena Owner", email: "kwabena-owner@marketplace-notif.test", password: "secure-password-123" });
    const teamMember = await registerUser({ displayName: "Nana Agent", email: "nana-agent@marketplace-notif.test", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Tema Realty", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await db.organisationMember.create({ data: { organisationId: organisation.id, userId: teamMember.id, status: "ACTIVE" } });
    const teamMemberRow = await db.organisationMember.findFirstOrThrow({ where: { organisationId: organisation.id, userId: teamMember.id } });
    const property = await createProperty(owner.id, organisation.id, { name: "Tema Court", referenceNumber: "TC-001", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const listing = await createListing(owner.id, organisation.id, baseListing(property.id));
    await verifyAndPublish(owner.id, organisation.id, listing.id);

    const lead = await createMarketplaceLead(listing.id, undefined, { name: "Adjoa Prospect", email: "adjoa@example.com" });
    await updateMarketplaceLead(owner.id, organisation.id, lead.id, { assigneeMemberId: teamMemberRow.id });

    const viewing = await createViewingRequest(listing.id, undefined, {
      leadId: lead.id,
      preferredTimes: [{ startsAt: "2027-03-10T10:00:00Z", endsAt: "2027-03-10T11:00:00Z", timezone: "Africa/Accra" }],
    });

    const ownerJobs = await jobsFor(owner.id, "VIEWING_REQUEST_CREATED");
    const assigneeJobs = await jobsFor(teamMember.id, "VIEWING_REQUEST_CREATED");
    expect(ownerJobs).toHaveLength(0);
    expect(assigneeJobs).toHaveLength(1);
    const payload = assigneeJobs[0].payload as { viewingRequestId?: string; prospectName?: string; requestedTimeLabel?: string };
    expect(payload.viewingRequestId).toBe(viewing.id);
    expect(payload.prospectName).toBe("Adjoa Prospect");
    expect(payload.requestedTimeLabel).toBeTruthy();
  });
});
