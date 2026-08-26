import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import {
  createMaintenanceRequest,
  createWorkOrder,
  transitionMaintenanceRequest,
} from "@/modules/maintenance/service";
import {
  addProviderToDirectory,
  approveProviderQuotation,
  assignProviderToWorkOrder,
  createProviderQuotationRequest,
  createServiceCategory,
  createServiceProvider,
  getProviderJobHistory,
  getProviderMetrics,
  listProviders,
  listServiceCategories,
  rateProvider,
  rejectProviderQuotation,
  respondToProviderAssignment,
  reviewProviderVerification,
  submitProviderQuotation,
  submitProviderVerification,
  updateServiceProvider,
  updateServiceCategory,
} from "@/modules/providers/service";

async function cleanDatabase() {
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
  await db.serviceCategory.deleteMany({ where: { key: "glazing" } });
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

describe("PostgreSQL Phase 7 service providers", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("supports reusable identities, directories, verification, quotations, assignments, history, ratings, isolation, RBAC, audits, and real metrics", async () => {
    const owner = await registerUser({ displayName: "Landlord One", email: "provider-landlord-1@example.com", password: "secure-password-123" });
    const secondOwner = await registerUser({ displayName: "Landlord Two", email: "provider-landlord-2@example.com", password: "secure-password-123" });
    const providerUser = await registerUser({ displayName: "Ama Artisan", email: "provider-artisan@example.com", password: "secure-password-123" });
    const companyAdmin = await registerUser({ displayName: "Company Admin", email: "provider-company@example.com", password: "secure-password-123" });
    const viewer = await registerUser({ displayName: "Directory Viewer", email: "provider-viewer@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Provider Landlord One", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const secondOrganisation = await createOrganisation(secondOwner.id, { name: "Provider Landlord Two", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const companyOrganisation = await createOrganisation(companyAdmin.id, { name: "Repair Company", type: "OTHER", countryCode: "GH" });
    const categories = await listServiceCategories();
    const plumbing = categories.find(({ key }) => key === "plumbing")!;
    const glazing = await createServiceCategory(owner.id, organisation.id, { key: "glazing", name: "Glazing" });
    expect((await updateServiceCategory(owner.id, organisation.id, glazing.id, { name: "Window glazing" })).name)
      .toBe("Window glazing");

    const provider = await createServiceProvider(providerUser.id, {
      type: "INDIVIDUAL",
      displayName: "Ama Artisan",
      contactEmail: "provider-artisan@example.com",
      contactPhone: "+233200000000",
      categoryIds: [plumbing.id],
      serviceAreas: [{ areaType: "operational-zone", name: "Central coverage", reference: "zone:central" }],
    });
    expect(provider).toMatchObject({
      type: "INDIVIDUAL",
      individualUserId: providerUser.id,
      verificationStatus: "UNVERIFIED",
      contactReady: true,
      evidenceReady: false,
    });
    await expect(createServiceProvider(providerUser.id, {
      type: "INDIVIDUAL", displayName: "Duplicate", contactEmail: "provider-artisan@example.com",
    })).rejects.toMatchObject({ code: "PROVIDER_IDENTITY_EXISTS" });

    const company = await createServiceProvider(companyAdmin.id, {
      type: "COMPANY",
      companyOrganisationId: companyOrganisation.id,
      displayName: "Repair Company",
      contactEmail: "provider-company@example.com",
    });
    expect(company.companyOrganisationId).toBe(companyOrganisation.id);

    await addProviderToDirectory(owner.id, organisation.id, { providerId: provider.id, internalNotes: "Preferred plumber" });
    await addProviderToDirectory(secondOwner.id, secondOrganisation.id, { providerId: provider.id });
    expect((await listProviders(owner.id, organisation.id))[0].provider.id).toBe(provider.id);
    expect((await listProviders(secondOwner.id, secondOrganisation.id))[0].provider.id).toBe(provider.id);

    const viewerRole = await db.role.findUniqueOrThrow({ where: { key: "viewer" } });
    const viewerMember = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: viewer.id } });
    await db.membershipRole.create({ data: { memberId: viewerMember.id, roleId: viewerRole.id } });
    expect(await listProviders(viewer.id, organisation.id)).toHaveLength(1);
    await expect(addProviderToDirectory(viewer.id, organisation.id, { providerId: company.id })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await submitProviderVerification(providerUser.id, provider.id, {
      evidence: [{ type: "IDENTITY", reference: "evidence/id-001" }, { type: "PROFESSIONAL_LICENSE", reference: "evidence/license-001" }],
    });
    await expect(reviewProviderVerification(viewer.id, organisation.id, provider.id, { status: "VERIFIED" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await reviewProviderVerification(owner.id, organisation.id, provider.id, { status: "VERIFIED" });
    await updateServiceProvider(providerUser.id, provider.id, {
      availabilityStatus: "AVAILABLE",
      acceptingWork: true,
    });

    const property = await createProperty(owner.id, organisation.id, {
      name: "Provider Test House",
      referenceNumber: "PROVIDER-1",
      category: "Residential",
      countryCode: "GH",
      currencyCode: "GHS",
    });
    const maintenance = await createMaintenanceRequest(owner.id, organisation.id, {
      propertyId: property.id,
      title: "Repair burst pipe",
      description: "Replace the burst supply pipe",
      category: "plumbing",
    });
    await transitionMaintenanceRequest(owner.id, organisation.id, maintenance.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(owner.id, organisation.id, maintenance.id, {
      title: "Replace supply pipe",
      currencyCode: "GHS",
    });
    const quotationRequest = await createProviderQuotationRequest(owner.id, organisation.id, {
      providerId: provider.id,
      maintenanceRequestId: maintenance.id,
      scope: "Supply labour and replacement pipe",
      responseDueAt: "2027-01-01T00:00:00.000Z",
    });
    await expect(submitProviderQuotation(providerUser.id, organisation.id, quotationRequest.id, {
      labourAmountMinor: "50000",
      materialsAmountMinor: "30000",
      totalAmountMinor: "70000",
      currencyCode: "GHS",
      validUntil: "2027-02-01T00:00:00.000Z",
      etaDays: 2,
    })).rejects.toBeTruthy();
    const quotation = await submitProviderQuotation(providerUser.id, organisation.id, quotationRequest.id, {
      labourAmountMinor: "50000",
      materialsAmountMinor: "30000",
      totalAmountMinor: "80000",
      currencyCode: "GHS",
      validUntil: "2027-02-01T00:00:00.000Z",
      etaDays: 2,
    });
    expect(quotation.source).toBe("PROVIDER");
    await expect(approveProviderQuotation(viewer.id, organisation.id, quotation.id, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await approveProviderQuotation(owner.id, organisation.id, quotation.id, { reason: "Best complete quote" });
    await expect(rejectProviderQuotation(owner.id, organisation.id, quotation.id, { reason: "Rewrite history" }))
      .rejects.toMatchObject({ code: "IMMUTABLE_QUOTATION" });
    expect(await db.providerQuotationReview.count({ where: { quotationId: quotation.id } })).toBe(1);

    const firstAssignment = await assignProviderToWorkOrder(owner.id, organisation.id, workOrder.id, {
      providerId: provider.id,
      quotationId: quotation.id,
      expectedStartAt: "2026-09-01T08:00:00.000Z",
      expectedCompletionAt: "2026-09-03T17:00:00.000Z",
    });
    await expect(transitionMaintenanceRequest(owner.id, organisation.id, maintenance.id, { status: "IN_PROGRESS" }))
      .rejects.toMatchObject({ code: "PROVIDER_ACCEPTANCE_REQUIRED" });
    await respondToProviderAssignment(providerUser.id, organisation.id, firstAssignment.id, {
      response: "DECLINED",
      declineReason: "Unavailable on those dates",
    });
    const assignment = await assignProviderToWorkOrder(owner.id, organisation.id, workOrder.id, {
      providerId: provider.id,
      quotationId: quotation.id,
      expectedCompletionAt: "2026-09-03T17:00:00.000Z",
    });
    await respondToProviderAssignment(providerUser.id, organisation.id, assignment.id, {
      response: "ACCEPTED",
      expectedStartAt: "2026-09-01T08:00:00.000Z",
      expectedCompletionAt: "2026-09-03T17:00:00.000Z",
    });
    await expect(rateProvider(owner.id, organisation.id, workOrder.id, { score: 5 }))
      .rejects.toMatchObject({ code: "COMPLETED_WORK_ORDER_REQUIRED" });
    await transitionMaintenanceRequest(owner.id, organisation.id, maintenance.id, { status: "IN_PROGRESS" });
    await transitionMaintenanceRequest(owner.id, organisation.id, maintenance.id, { status: "COMPLETED" });
    const rating = await rateProvider(owner.id, organisation.id, workOrder.id, {
      score: 5,
      qualityScore: 5,
      timelinessScore: 4,
      communicationScore: 5,
      comment: "Work completed correctly",
    });
    expect(rating.providerId).toBe(provider.id);
    await expect(rateProvider(owner.id, organisation.id, workOrder.id, { score: 1 }))
      .rejects.toMatchObject({ code: "WORK_ORDER_ALREADY_RATED" });

    const jobs = await getProviderJobHistory(owner.id, organisation.id, provider.id);
    expect(jobs).toHaveLength(2);
    expect(jobs.map(({ status }) => status)).toEqual(expect.arrayContaining(["DECLINED", "COMPLETED"]));
    expect(await getProviderMetrics(owner.id, organisation.id, provider.id)).toMatchObject({
      assignments: 2,
      accepted: 1,
      declined: 1,
      completed: 1,
      acceptanceRate: 0.5,
      ratings: 1,
      averageRating: 5,
    });
    await expect(getProviderJobHistory(secondOwner.id, secondOrganisation.id, company.id))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    const actions = [
      "provider.directory_added",
      "provider.verification_submitted",
      "provider.verified",
      "provider.quotation_requested",
      "provider.quotation_submitted",
      "provider.quotation_approved",
      "provider.assigned",
      "provider.assignment_declined",
      "provider.assignment_accepted",
      "provider.job_completed",
      "provider.rated",
    ];
    for (const action of actions) {
      expect(await db.auditEvent.count({ where: { organisationId: organisation.id, action } }), action).toBeGreaterThan(0);
      expect(await db.domainEvent.count({ where: { organisationId: organisation.id, name: action } }), action).toBeGreaterThan(0);
    }
  });

  it("records quotations on behalf of providers and rejects cross-organisation access", async () => {
    const owner = await registerUser({ displayName: "Quote Admin", email: "quote-admin@example.com", password: "secure-password-123" });
    const outsider = await registerUser({ displayName: "Quote Outsider", email: "quote-outsider@example.com", password: "secure-password-123" });
    const artisan = await registerUser({ displayName: "Quote Artisan", email: "quote-artisan@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Quote Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(outsider.id, { name: "Other Quote Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const provider = await createServiceProvider(artisan.id, {
      type: "INDIVIDUAL", displayName: "Quote Artisan", contactEmail: "quote-artisan@example.com",
    });
    await addProviderToDirectory(owner.id, organisation.id, { providerId: provider.id });
    await submitProviderVerification(artisan.id, provider.id, { evidence: [{ type: "IDENTITY", reference: "quote/id" }] });
    await reviewProviderVerification(owner.id, organisation.id, provider.id, { status: "VERIFIED" });
    const property = await createProperty(owner.id, organisation.id, {
      name: "Quote Property", referenceNumber: "QUOTE-1", category: "Residential", countryCode: "GH", currencyCode: "GHS",
    });
    const maintenance = await createMaintenanceRequest(owner.id, organisation.id, {
      propertyId: property.id, title: "Quote repair", description: "Obtain an external quotation", category: "other",
    });
    const request = await createProviderQuotationRequest(owner.id, organisation.id, {
      providerId: provider.id, maintenanceRequestId: maintenance.id, scope: "External quote",
    });
    await expect(submitProviderQuotation(outsider.id, otherOrganisation.id, request.id, {
      labourAmountMinor: "1", materialsAmountMinor: "1", totalAmountMinor: "2", currencyCode: "GHS",
      validUntil: "2027-01-01T00:00:00.000Z", etaDays: 1,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const recorded = await submitProviderQuotation(owner.id, organisation.id, request.id, {
      labourAmountMinor: "100", materialsAmountMinor: "200", totalAmountMinor: "300", currencyCode: "GHS",
      validUntil: "2027-01-01T00:00:00.000Z", etaDays: 3,
    });
    expect(recorded).toMatchObject({ source: "ADMIN_RECORDED", recordedByUserId: owner.id, submittedByUserId: null });
    await rejectProviderQuotation(owner.id, organisation.id, recorded.id, { reason: "Too expensive" });
    expect(await db.providerQuotationReview.count({ where: { quotationId: recorded.id, decision: "REJECTED" } })).toBe(1);
  });
});
