import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import {
  createListing,
  createMarketplaceLead,
  createViewingRequest,
  updateListingVerification,
  transitionListing,
  updateMarketplaceLead,
  updateViewingRequest,
} from "@/modules/listings/service";
import {
  convertApprovedApplicationToTenant,
  createApplicant,
  createDraftLeaseFromApplication,
  createRentalApplication,
  getCrmDashboard,
  getRentalApplication,
  listApplicants,
  listRentalApplications,
  transitionRentalApplication,
  updateRentalApplication,
} from "@/modules/applications/service";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

async function addMember(organisationId: string, userId: string, roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const member = await db.organisationMember.create({ data: { organisationId, userId } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
  return member;
}

function listingInput(propertyId: string, unitId: string) {
  return {
    propertyId,
    unitId,
    listingType: "RENT" as const,
    category: "apartment",
    title: "Phase 10 rental home",
    publicDescription: "A complete rental listing used to verify the application workflow.",
    rentAmountMinor: "250000",
    currencyCode: "GHS",
    frequency: "MONTHLY" as const,
    availableFrom: "2026-09-01",
    bedrooms: 2,
    bathrooms: 1,
    countryCode: "GH",
    region: "Greater Accra",
    city: "Accra",
    enquiryEnabled: true,
    media: [{ type: "PHOTO" as const, publicUrl: "https://cdn.example.com/phase10.jpg" }],
    amenities: [],
  };
}

async function publishListing(userId: string, organisationId: string, propertyId: string, unitId: string) {
  const listing = await createListing(userId, organisationId, listingInput(propertyId, unitId));
  await updateListingVerification(userId, organisationId, listing.id, {
    status: "PENDING",
    evidence: [{ type: "MANAGEMENT_AUTHORITY", privateReference: "phase10-evidence" }],
  });
  await updateListingVerification(userId, organisationId, listing.id, { status: "VERIFIED" });
  await transitionListing(userId, organisationId, listing.id, { status: "PENDING_REVIEW" });
  return transitionListing(userId, organisationId, listing.id, { status: "PUBLISHED" });
}

describe("PostgreSQL Phase 10 rental applications", () => {
  beforeAll(async () => {
    for (const key of ["application.create", "application.read", "application.review", "application.convert"]) {
      expect(await db.permission.findUnique({ where: { key } }), key).not.toBeNull();
    }
  });
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("runs lead, viewing, application, review, conversion, draft lease, privacy, RBAC, audit, and event lifecycles", async () => {
    const owner = await registerUser({ displayName: "Application Owner", email: "application-owner@example.com", password: "secure-password-123" });
    const manager = await registerUser({ displayName: "Application Manager", email: "application-manager@example.com", password: "secure-password-123" });
    const viewer = await registerUser({ displayName: "Application Viewer", email: "application-viewer@example.com", password: "secure-password-123" });
    const outsider = await registerUser({ displayName: "Other Owner", email: "other-application-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Application Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(outsider.id, { name: "Private Other Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const managerMember = await addMember(organisation.id, manager.id, "property_manager");
    await addMember(organisation.id, viewer.id, "viewer");
    const property = await createProperty(owner.id, organisation.id, {
      name: "Application House",
      referenceNumber: "APP-001",
      category: "Residential",
      countryCode: "GH",
      currencyCode: "GHS",
      units: [{ name: "A1" }],
    });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id, name: "A1" } });
    const listing = await publishListing(owner.id, organisation.id, property.id, unit.id);
    const noConsentLead = await createMarketplaceLead(listing.id, undefined, {
      name: "No Consent Applicant",
      email: "no-consent@example.com",
    });
    const noConsentApplicant = await createApplicant(owner.id, organisation.id, {
      legalName: "No Consent Applicant",
      email: "no-consent@example.com",
    });
    const noConsentApplication = await createRentalApplication(owner.id, organisation.id, {
      listingId: listing.id,
      leadId: noConsentLead.id,
      applicantId: noConsentApplicant.id,
    });
    await expect(transitionRentalApplication(owner.id, organisation.id, noConsentApplication.id, { status: "SUBMITTED" }))
      .rejects.toMatchObject({ code: "APPLICATION_CONSENT_REQUIRED" });

    const lead = await createMarketplaceLead(listing.id, undefined, {
      name: "Primary Applicant",
      email: "Applicant@Example.com",
      phone: "+233 20 111 2222",
    });
    await updateMarketplaceLead(owner.id, organisation.id, lead.id, {
      status: "CONTACTED",
      assigneeMemberId: managerMember.id,
      privateNotes: "Staff-only qualification notes.",
    });
    await updateMarketplaceLead(manager.id, organisation.id, lead.id, { status: "QUALIFIED", note: "Income discussed." });

    const viewing = await createViewingRequest(listing.id, undefined, {
      leadId: lead.id,
      preferredTimes: [{ startsAt: "2027-01-10T10:00:00Z", endsAt: "2027-01-10T11:00:00Z", timezone: "Africa/Accra" }],
    });
    await updateViewingRequest(manager.id, organisation.id, viewing.id, {
      status: "CONFIRMED",
      assigneeMemberId: managerMember.id,
      confirmedStartsAt: "2027-01-10T10:00:00Z",
      confirmedEndsAt: "2027-01-10T11:00:00Z",
    });
    await updateViewingRequest(manager.id, organisation.id, viewing.id, {
      status: "RESCHEDULED",
      confirmedStartsAt: "2027-01-11T14:00:00Z",
      confirmedEndsAt: "2027-01-11T15:00:00Z",
    });
    await updateViewingRequest(manager.id, organisation.id, viewing.id, { status: "CONFIRMED" });
    await updateViewingRequest(manager.id, organisation.id, viewing.id, {
      status: "COMPLETED",
      outcome: "Applicant wants to proceed.",
      privateNotes: "Staff-only viewing notes.",
    });
    expect((await db.marketplaceLead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("VIEWING_COMPLETED");

    const applicant = await createApplicant(manager.id, organisation.id, {
      legalName: "Primary Applicant",
      preferredName: "Primary",
      email: "Applicant@Example.com",
      phone: "+233 20 111 2222",
      applicantNotes: "Applicant-visible note.",
      internalNotes: "Private staff identity note.",
      countryCode: "GH",
    });
    const application = await createRentalApplication(manager.id, organisation.id, {
      listingId: listing.id,
      leadId: lead.id,
      applicantId: applicant.id,
      assigneeMemberId: managerMember.id,
      employmentDetails: { type: "EMPLOYED", employer: "Example Ltd", jobTitle: "Engineer" },
      incomeAmountMinor: "900000",
      incomeCurrencyCode: "GHS",
      incomeFrequency: "MONTHLY",
      previousTenancy: { landlordName: "Previous Landlord", years: 2 },
      references: [{ name: "Work Reference", relationship: "Manager" }],
      emergencyContact: { name: "Emergency Contact", phone: "+233201234567" },
      household: [{ name: "Household Member", relationship: "Child" }],
      coApplicants: [],
      applicantNotes: "Ready for review.",
      staffReviewNotes: "Private pre-screen note.",
      documents: [{
        type: "INCOME",
        storageKey: "private/applications/income-proof.pdf",
        fileName: "income-proof.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
      }],
      consents: [{ type: "APPLICATION_PROCESSING", textVersion: "v1", granted: true }],
    });
    expect(application.listing.property.id).toBe(property.id);
    expect(application.listing.unit?.id).toBe(unit.id);
    expect((await db.marketplaceLead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("APPLICATION_STARTED");

    await expect(transitionRentalApplication(manager.id, organisation.id, application.id, { status: "APPROVED" }))
      .rejects.toMatchObject({ code: "INVALID_APPLICATION_TRANSITION" });
    await transitionRentalApplication(manager.id, organisation.id, application.id, { status: "SUBMITTED" });
    await expect(transitionRentalApplication(viewer.id, organisation.id, application.id, { status: "UNDER_REVIEW" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await transitionRentalApplication(manager.id, organisation.id, application.id, { status: "UNDER_REVIEW", staffReviewNotes: "Review started." });
    const approved = await transitionRentalApplication(manager.id, organisation.id, application.id, {
      status: "APPROVED",
      decisionCategory: "MEETS_CRITERIA",
      decisionReason: "Verified against the organisation's rental criteria.",
    });
    expect(approved).toMatchObject({ status: "APPROVED" });
    expect(approved.submittedAt).toBeInstanceOf(Date);
    expect(approved.reviewedAt).toBeInstanceOf(Date);
    expect(approved.decisionAt).toBeInstanceOf(Date);

    expect((await listApplicants(viewer.id, organisation.id)).items).toHaveLength(2);
    expect((await listRentalApplications(viewer.id, organisation.id)).items).toHaveLength(2);
    await expect(createApplicant(viewer.id, organisation.id, { legalName: "Denied", email: "denied@example.com" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getRentalApplication(outsider.id, otherOrganisation.id, application.id))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(convertApprovedApplicationToTenant(viewer.id, organisation.id, application.id))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const tenantRelationship = await convertApprovedApplicationToTenant(manager.id, organisation.id, application.id);
    expect(await db.tenantOrganisation.count({ where: { organisationId: organisation.id } })).toBe(1);
    expect((await db.rentalApplication.findUniqueOrThrow({ where: { id: application.id } })).tenantOrganisationId)
      .toBe(tenantRelationship.id);

    const lease = await createDraftLeaseFromApplication(manager.id, organisation.id, application.id, {
      referenceNumber: "APP-LEASE-001",
      startDate: "2027-02-01",
      endDate: "2028-01-31",
    });
    expect(lease).toMatchObject({
      status: "DRAFT",
      propertyId: property.id,
      unitId: unit.id,
      currencyCode: "GHS",
      rentFrequency: "MONTHLY",
    });
    expect(lease.rentAmountMinor.toString()).toBe("250000");
    await expect(createDraftLeaseFromApplication(manager.id, organisation.id, application.id, {
      referenceNumber: "APP-LEASE-DUPLICATE",
      startDate: "2027-02-01",
      endDate: "2028-01-31",
    })).rejects.toMatchObject({ code: "APPLICATION_LEASE_EXISTS" });
    expect(await db.lease.count({ where: { organisationId: organisation.id } })).toBe(1);

    const duplicateLead = await createMarketplaceLead(listing.id, undefined, {
      name: "Same Person Again",
      email: "applicant@example.COM",
      phone: "233201112222",
    });
    const duplicateApplicant = await createApplicant(owner.id, organisation.id, {
      legalName: "Primary Applicant",
      email: "applicant@example.COM",
      phone: "233201112222",
    });
    const duplicateApplication = await createRentalApplication(owner.id, organisation.id, {
      listingId: listing.id,
      leadId: duplicateLead.id,
      applicantId: duplicateApplicant.id,
      consents: [{ type: "APPLICATION_PROCESSING", textVersion: "v1", granted: true }],
    });
    await transitionRentalApplication(owner.id, organisation.id, duplicateApplication.id, { status: "SUBMITTED" });
    await transitionRentalApplication(manager.id, organisation.id, duplicateApplication.id, { status: "UNDER_REVIEW" });
    await transitionRentalApplication(manager.id, organisation.id, duplicateApplication.id, { status: "APPROVED" });
    const reusedTenant = await convertApprovedApplicationToTenant(manager.id, organisation.id, duplicateApplication.id);
    expect(reusedTenant.id).toBe(tenantRelationship.id);
    expect(await db.tenantOrganisation.count({ where: { organisationId: organisation.id } })).toBe(1);

    const rejectedLead = await createMarketplaceLead(listing.id, undefined, { name: "Rejected Applicant", email: "rejected@example.com" });
    const rejectedApplicant = await createApplicant(owner.id, organisation.id, { legalName: "Rejected Applicant", email: "rejected@example.com" });
    const rejectedApplication = await createRentalApplication(owner.id, organisation.id, {
      listingId: listing.id,
      leadId: rejectedLead.id,
      applicantId: rejectedApplicant.id,
      consents: [{ type: "APPLICATION_PROCESSING", textVersion: "v1", granted: true }],
    });
    await transitionRentalApplication(owner.id, organisation.id, rejectedApplication.id, { status: "SUBMITTED" });
    await transitionRentalApplication(manager.id, organisation.id, rejectedApplication.id, { status: "UNDER_REVIEW" });
    await transitionRentalApplication(manager.id, organisation.id, rejectedApplication.id, {
      status: "MORE_INFORMATION_REQUIRED",
      note: "Please provide an updated reference.",
    });
    await updateRentalApplication(owner.id, organisation.id, rejectedApplication.id, {
      references: [{ name: "Updated Reference", relationship: "Employer" }],
    });
    await transitionRentalApplication(owner.id, organisation.id, rejectedApplication.id, { status: "SUBMITTED" });
    await transitionRentalApplication(manager.id, organisation.id, rejectedApplication.id, { status: "UNDER_REVIEW" });
    await transitionRentalApplication(manager.id, organisation.id, rejectedApplication.id, {
      status: "REJECTED",
      decisionCategory: "INCOMPLETE_REFERENCE",
      decisionReason: "The submitted reference could not be verified.",
    });

    const history = await db.rentalApplicationStatusHistory.findFirstOrThrow({ where: { applicationId: application.id } });
    await expect(db.rentalApplicationStatusHistory.update({ where: { id: history.id }, data: { note: "rewrite" } }))
      .rejects.toBeTruthy();
    const dashboard = await getCrmDashboard(viewer.id, organisation.id);
    expect(dashboard.counts.applications).toMatchObject({ APPROVED: 2, REJECTED: 1 });

    for (const eventName of [
      "lead.qualified",
      "viewing.requested",
      "viewing.confirmed",
      "viewing.rescheduled",
      "viewing.completed",
      "application.created",
      "application.submitted",
      "application.review_started",
      "application.more_information_requested",
      "application.approved",
      "application.rejected",
      "applicant.converted_to_tenant",
      "lease.draft_created_from_application",
    ]) {
      expect(await db.domainEvent.count({ where: { organisationId: organisation.id, name: eventName } }), eventName)
        .toBeGreaterThan(0);
      expect(await db.auditEvent.count({ where: { organisationId: organisation.id, action: eventName } }), eventName)
        .toBeGreaterThan(0);
    }
  });
});
