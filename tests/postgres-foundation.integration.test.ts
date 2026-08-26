import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { createSessionRecord, hashSessionToken } from "@/platform/auth/session";
import { registerUser, authenticateUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { getOrganisationMembers } from "@/modules/organisations/queries";
import { createPortfolio, createProperty, getProperty, updateProperty } from "@/modules/assets/service";
import { getAuditEvents } from "@/modules/audit/queries";

async function cleanDatabase() {
  await db.workOrderHistory.deleteMany();
  await db.workOrder.deleteMany();
  await db.maintenanceApproval.deleteMany();
  await db.maintenanceAttachment.deleteMany();
  await db.maintenanceHistory.deleteMany();
  await db.maintenanceRequest.deleteMany();
  await db.domainEvent.deleteMany();
  await db.auditEvent.deleteMany();
  await db.notification.deleteMany();
  await db.reminderPolicy.deleteMany();
  await db.financialLedgerEntry.deleteMany();
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

describe("PostgreSQL Phase 1 foundation", () => {
  beforeAll(async () => {
    expect(await db.country.findUnique({ where: { code: "GH" } })).toMatchObject({ defaultCurrencyCode: "GHS" });
    expect(await db.role.findUnique({ where: { key: "organisation_owner" } })).not.toBeNull();
  });
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("persists registration, password authentication, and hashed sessions", async () => {
    const user = await registerUser({ displayName: "Ama Owner", email: "ama@example.com", password: "secure-password-123" });
    await expect(authenticateUser({ email: "ama@example.com", password: "secure-password-123" })).resolves.toMatchObject({ id: user.id });
    await expect(authenticateUser({ email: "ama@example.com", password: "wrong-password" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const { token } = await createSessionRecord(user.id, "test-session-token");
    expect(token).toBe("test-session-token");
    expect(await db.session.findUnique({ where: { tokenHash: hashSessionToken(token) } })).toMatchObject({ userId: user.id });
  });

  it("enforces organisation isolation, RBAC, and asset relationships transactionally", async () => {
    const ownerA = await registerUser({ displayName: "Ama", email: "ama@example.com", password: "secure-password-123" });
    const ownerB = await registerUser({ displayName: "Kojo", email: "kojo@example.com", password: "secure-password-123" });
    const organisationA = await createOrganisation(ownerA.id, { name: "Ama Holdings", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const organisationB = await createOrganisation(ownerB.id, { name: "Kojo Holdings", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const portfolioA = await createPortfolio(ownerA.id, organisationA.id, { name: "Accra Homes" });
    const propertyA = await createProperty(ownerA.id, organisationA.id, {
      name: "Osu Court", referenceNumber: "OSU-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", portfolioId: portfolioA.id,
      building: { name: "Main Block", units: [{ name: "A1" }, { name: "A2" }] }, units: [{ name: "Caretaker" }],
    });
    const property = await getProperty(ownerA.id, organisationA.id, propertyA.id);
    expect(property.buildings[0]?.units).toHaveLength(2);
    expect(property.units).toHaveLength(1);

    await expect(getProperty(ownerB.id, organisationB.id, propertyA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateProperty(ownerB.id, organisationB.id, propertyA.id, { name: "Stolen Asset" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createProperty(ownerB.id, organisationB.id, { name: "Blocked", referenceNumber: "B-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", portfolioId: portfolioA.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getOrganisationMembers(ownerA.id, organisationB.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getAuditEvents(ownerA.id, organisationB.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const viewer = await registerUser({ displayName: "Viewer", email: "viewer@example.com", password: "secure-password-123" });
    const viewerRole = await db.role.findUniqueOrThrow({ where: { key: "viewer" } });
    const membership = await db.organisationMember.create({ data: { organisationId: organisationA.id, userId: viewer.id } });
    await db.membershipRole.create({ data: { memberId: membership.id, roleId: viewerRole.id } });
    await expect(createProperty(viewer.id, organisationA.id, { name: "Denied", referenceNumber: "NOPE", category: "Residential", countryCode: "GH", currencyCode: "GHS" })).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<AppError>);

    const owner = await db.propertyOwner.create({ data: { type: "PERSON", displayName: "External Owner" } });
    const assigned = await db.property.update({ where: { id: propertyA.id }, data: { ownerId: owner.id } });
    expect(assigned.organisationId).toBe(organisationA.id);
    expect(assigned.ownerId).toBe(owner.id);
    expect(assigned.ownerId).not.toBe(assigned.organisationId);

    expect(await db.auditEvent.count({ where: { organisationId: organisationA.id, entityId: propertyA.id, action: "property.created" } })).toBe(1);
    expect(await db.domainEvent.count({ where: { organisationId: organisationA.id, aggregateId: propertyA.id, name: "property.created" } })).toBe(1);
    await expect(updateProperty(ownerA.id, organisationA.id, propertyA.id, { city: "Accra" })).resolves.toMatchObject({ city: "Accra" });
    expect(await db.auditEvent.count({ where: { organisationId: organisationA.id, entityId: propertyA.id, action: "property.updated" } })).toBe(1);
    expect(await db.domainEvent.count({ where: { organisationId: organisationA.id, aggregateId: propertyA.id, name: "property.updated" } })).toBe(1);
  });
});
