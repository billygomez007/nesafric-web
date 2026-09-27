import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createMaintenanceRequest, createWorkOrder, transitionMaintenanceRequest } from "@/modules/maintenance/service";
import {
  createServiceProvider,
  getProviderMetrics,
  listServiceCategories,
  reviewProviderEvidence,
  reviewProviderIdentity,
  submitProviderVerification,
  updateServiceProvider,
} from "@/modules/providers/service";
import { discoverMarketplaceProviders, getPublicMarketplaceProvider, updateMarketplaceProfile } from "@/modules/marketplace/service";
import { getProviderReputation, reputationFromAssignments } from "@/modules/providers/reputation";

/**
 * Provider reputation semantics against PostgreSQL: cancellation attribution recorded through the
 * real maintenance cancellation workflow (actor, reason, responsibility, audit), the fair
 * completion rate, and the public marketplace, provider dashboard, Prisma and SQL paths all
 * agreeing on the same records.
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

type Fixture = Awaited<ReturnType<typeof landlordFixture>>;

async function landlordFixture(email = "rep-landlord@example.com") {
  const landlord = await registerUser({ displayName: "Landlord", email, password: "secure-password-123" });
  const organisation = await createOrganisation(landlord.id, { name: `Org ${email}`, type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
  const property = await createProperty(landlord.id, organisation.id, { name: "Rep House", referenceNumber: `REP-${email.length}`, category: "Residential", countryCode: "GH", currencyCode: "GHS" });
  return { landlord, organisation, property };
}

/** A maintenance request with a work order and one provider assignment in the given state. */
async function job(fixture: Fixture, providerId: string, status: "PENDING" | "ACCEPTED" | "DECLINED" | "COMPLETED") {
  const { landlord, organisation, property } = fixture;
  const request = await createMaintenanceRequest(landlord.id, organisation.id, { propertyId: property.id, title: "Leak", description: "Leak", category: "plumbing" });
  await transitionMaintenanceRequest(landlord.id, organisation.id, request.id, { status: "TRIAGED" });
  const workOrder = await createWorkOrder(landlord.id, organisation.id, request.id, { title: "Fix leak", currencyCode: "GHS" });
  const acceptedAt = status === "ACCEPTED" || status === "COMPLETED" ? new Date() : null;
  const assignment = await db.providerAssignment.create({
    data: { landlordOrganisationId: organisation.id, workOrderId: workOrder.id, providerId, assignedByUserId: landlord.id, status, acceptedAt },
  });
  return { requestId: request.id, assignmentId: assignment.id };
}

async function cancel(fixture: Fixture, requestId: string, input: Record<string, unknown> = {}) {
  return transitionMaintenanceRequest(fixture.landlord.id, fixture.organisation.id, requestId, { status: "CANCELLED", ...input });
}

describe("PostgreSQL provider reputation semantics", () => {
  beforeEach(async () => {
    reviewers = 0;
    await cleanDatabase();
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("records actor, reason, responsibility and an audit trail when a landlord cancels", async () => {
    const fixture = await landlordFixture();
    const provider = await listedProvider("Kwame Plumbing", "plumbing", accra);
    const accepted = await job(fixture, provider.id, "ACCEPTED");
    const before = await db.providerAssignment.findUniqueOrThrow({ where: { id: accepted.assignmentId } });

    await cancel(fixture, accepted.requestId, {
      cancellationReason: "PROVIDER_FAILED_TO_ATTEND",
      note: "No one came on Tuesday.",
      // Ignored: responsibility and actor are never taken from the client.
      cancellationAttribution: "LANDLORD",
      cancelledByUserId: provider.ownerId,
    });
    const after = await db.providerAssignment.findUniqueOrThrow({ where: { id: accepted.assignmentId } });
    expect(after).toMatchObject({
      status: "CANCELLED",
      cancelledByUserId: fixture.landlord.id,
      cancellationReason: "PROVIDER_FAILED_TO_ATTEND",
      cancellationAttribution: "PROVIDER",
      cancellationNote: "No one came on Tuesday.",
      acceptedAt: before.acceptedAt,
    });
    expect(after.cancelledAt).toBeInstanceOf(Date);

    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "provider.assignment_cancelled", entityId: accepted.assignmentId } });
    expect(audit).toMatchObject({ organisationId: fixture.organisation.id, actorUserId: fixture.landlord.id, entityType: "provider_assignment" });
    expect(audit.metadata).toMatchObject({
      assignmentId: accepted.assignmentId,
      providerId: provider.id,
      actorUserId: fixture.landlord.id,
      fromStatus: "ACCEPTED",
      toStatus: "CANCELLED",
      reason: "PROVIDER_FAILED_TO_ATTEND",
      attribution: "PROVIDER",
      acceptedBeforeCancellation: true,
    });
    expect(await db.domainEvent.count({ where: { name: "provider.assignment_cancelled", aggregateId: accepted.assignmentId } })).toBe(1);

    // No reason given: responsibility is UNKNOWN, never the provider's.
    const unexplained = await job(fixture, provider.id, "PENDING");
    await cancel(fixture, unexplained.requestId);
    expect(await db.providerAssignment.findUniqueOrThrow({ where: { id: unexplained.assignmentId } })).toMatchObject({
      status: "CANCELLED", cancellationReason: null, cancellationAttribution: "UNKNOWN", cancelledByUserId: fixture.landlord.id,
    });
  });

  it("only lets the landlord organisation that owns the work cancel it", async () => {
    const fixture = await landlordFixture();
    const other = await landlordFixture("other-landlord@example.com");
    const provider = await listedProvider("Kwame Plumbing", "plumbing", accra);
    const accepted = await job(fixture, provider.id, "ACCEPTED");

    // Another landlord (using their own organisation) can't reach this request.
    await expect(transitionMaintenanceRequest(other.landlord.id, other.organisation.id, accepted.requestId, { status: "CANCELLED", cancellationReason: "PROVIDER_WITHDREW" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    // Neither the provider nor the other landlord can act inside this organisation.
    for (const userId of [provider.ownerId, other.landlord.id]) {
      await expect(transitionMaintenanceRequest(userId, fixture.organisation.id, accepted.requestId, { status: "CANCELLED", cancellationReason: "PROVIDER_WITHDREW" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await db.providerAssignment.findUniqueOrThrow({ where: { id: accepted.assignmentId } })).toMatchObject({ status: "ACCEPTED", cancellationAttribution: null });
    expect(await db.auditEvent.count({ where: { action: "provider.assignment_cancelled" } })).toBe(0);
  });

  it("counts only provider-caused cancellations, and every surface reports the same rate", async () => {
    const fixture = await landlordFixture();
    const provider = await listedProvider("Kwame Plumbing", "plumbing", accra);
    for (let index = 0; index < 4; index += 1) await job(fixture, provider.id, "COMPLETED");

    // Four completed jobs: not enough history.
    expect((await getPublicMarketplaceProvider(provider.id)).provider).toMatchObject({ completedJobs: 4, completionRate: null, completionRateBasis: 4 });

    const cancellations = [
      ["WORK_NO_LONGER_REQUIRED", "LANDLORD"],
      ["TENANT_WITHDREW", "TENANT"],
      ["MUTUAL_AGREEMENT", "MUTUAL"],
      ["SCHEDULING_ISSUE", "UNKNOWN"],
      ["OTHER", "UNKNOWN"],
    ] as const;
    for (const [reason] of cancellations) await cancel(fixture, (await job(fixture, provider.id, "ACCEPTED")).requestId, { cancellationReason: reason });
    // Historical row from before attribution existed (the migration marks these UNKNOWN).
    const legacy = await job(fixture, provider.id, "ACCEPTED");
    await db.providerAssignment.update({ where: { id: legacy.assignmentId }, data: { status: "CANCELLED", cancellationAttribution: "UNKNOWN" } });
    // A system cancellation (no user flow produces one yet) and open / declined work.
    const system = await job(fixture, provider.id, "ACCEPTED");
    await db.providerAssignment.update({ where: { id: system.assignmentId }, data: { status: "CANCELLED", cancellationAttribution: "SYSTEM" } });
    await job(fixture, provider.id, "PENDING");
    await job(fixture, provider.id, "ACCEPTED");
    await job(fixture, provider.id, "DECLINED");
    // A provider-attributed reason on an offer the provider never accepted.
    await cancel(fixture, (await job(fixture, provider.id, "PENDING")).requestId, { cancellationReason: "PROVIDER_FAILED_TO_ATTEND" });

    expect((await getPublicMarketplaceProvider(provider.id)).provider).toMatchObject({ completedJobs: 4, completionRate: null, completionRateBasis: 4 });

    // One provider-caused cancellation of accepted work: 4 / 5 = 80%.
    await cancel(fixture, (await job(fixture, provider.id, "ACCEPTED")).requestId, { cancellationReason: "PROVIDER_WITHDREW" });

    const publicProvider = (await getPublicMarketplaceProvider(provider.id)).provider;
    const listed = (await discoverMarketplaceProviders({})).items.find(({ id }) => id === provider.id)!;
    const dashboard = await getProviderMetrics(provider.ownerId, null, provider.id);
    const reputation = await getProviderReputation(provider.id);
    const reference = reputationFromAssignments(await db.providerAssignment.findMany({ where: { providerId: provider.id } }));

    expect(publicProvider).toMatchObject({ completedJobs: 4, completionRateBasis: 5, completionRate: 0.8 });
    expect(listed).toMatchObject({ completedJobs: 4, completionRateBasis: 5, completionRate: 0.8 });
    expect(dashboard.reputation).toMatchObject({ completedJobs: 4, concludedJobs: 5, completionRate: 0.8, providerAttributedCancellations: 1 });
    expect(reputation).toEqual(dashboard.reputation);
    expect(reference).toEqual({ completedJobs: 4, concludedJobs: 5, completionRate: 0.8, providerAttributedCancellations: 1 });
    // Every cancellation is still visible privately, only one counts against the provider.
    expect(dashboard.reputation.cancelledJobs).toBe(9);
    // Private blame figures are not part of the public payload.
    expect(JSON.stringify(publicProvider)).not.toMatch(/providerAttributedCancellations|cancelledJobs|attribution/i);
  });

  it("reports 100% for five completed jobs, and repeat customers privately", async () => {
    const fixture = await landlordFixture();
    const provider = await listedProvider("Kwame Plumbing", "plumbing", accra);
    for (let index = 0; index < 5; index += 1) await job(fixture, provider.id, "COMPLETED");
    expect((await getPublicMarketplaceProvider(provider.id)).provider).toMatchObject({ completedJobs: 5, completionRate: 1, completionRateBasis: 5 });
    expect((await getProviderMetrics(provider.ownerId, null, provider.id)).reputation).toMatchObject({ completionRate: 1, repeatCustomers: 1, ratingCount: 0, ratingAverage: null });
  });
});
