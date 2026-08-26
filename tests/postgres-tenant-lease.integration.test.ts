import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant, getTenant, updateTenant } from "@/modules/tenants/service";
import { getLease, updateLease } from "@/modules/leases/service";
import { createLease } from "./helpers/lease";
import { transitionLease } from "@/modules/lifecycle/service";
import { generateRentSchedule } from "@/modules/rent-schedules/service";
import { createExpiryPolicy, scheduleExpiryReminders } from "@/modules/reminders/service";

async function cleanDatabase() {
  await db.workOrderHistory.deleteMany();
  await db.workOrder.deleteMany();
  await db.maintenanceApproval.deleteMany();
  await db.maintenanceAttachment.deleteMany();
  await db.maintenanceHistory.deleteMany();
  await db.maintenanceRequest.deleteMany();
  await db.backgroundJob.deleteMany();
  await db.domainEvent.deleteMany(); await db.auditEvent.deleteMany(); await db.notification.deleteMany(); await db.reminderPolicy.deleteMany(); await db.financialLedgerEntry.deleteMany(); await db.rentObligation.deleteMany(); await db.leaseAmendment.deleteMany(); await db.leaseDocument.deleteMany(); await db.leaseHistory.deleteMany(); await db.leaseParty.deleteMany(); await db.lease.deleteMany();
  await db.tenantOrganisation.deleteMany(); await db.tenant.deleteMany(); await db.membershipRole.deleteMany(); await db.organisationMember.deleteMany();
  await db.unit.deleteMany(); await db.building.deleteMany(); await db.property.deleteMany();
  await db.subscriptionInvoice.deleteMany(); await db.subscriptionStatusHistory.deleteMany(); await db.organisationEntitlementOverride.deleteMany(); await db.organisationFeatureFlagOverride.deleteMany(); await db.platformSupportSession.deleteMany(); await db.organisationSubscription.deleteMany();
  await db.organisation.deleteMany(); await db.session.deleteMany(); await db.user.deleteMany();
}

describe("PostgreSQL Phase 2 tenant and lease core", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("enforces tenant and lease isolation, valid relationships, RBAC, history, and events", async () => {
    const ownerA = await registerUser({ displayName: "Ama", email: "ama.lease@example.com", password: "secure-password-123" });
    const ownerB = await registerUser({ displayName: "Kojo", email: "kojo.lease@example.com", password: "secure-password-123" });
    const organisationA = await createOrganisation(ownerA.id, { name: "Ama Leasing", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const organisationB = await createOrganisation(ownerB.id, { name: "Kojo Leasing", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const propertyA = await createProperty(ownerA.id, organisationA.id, { name: "Cantonments House", referenceNumber: "CH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "1A" }] });
    const propertyB = await createProperty(ownerB.id, organisationB.id, { name: "Airport House", referenceNumber: "AH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "2A" }] });
    const unitA = await db.unit.findFirstOrThrow({ where: { propertyId: propertyA.id } });
    const unitB = await db.unit.findFirstOrThrow({ where: { propertyId: propertyB.id } });
    const tenantA = await createTenant(ownerA.id, organisationA.id, { legalName: "Esi Tenant", email: "esi@example.com", phone: "+233200000000" });
    const tenantB = await createTenant(ownerB.id, organisationB.id, { legalName: "Yaw Tenant", email: "yaw@example.com" });

    const lease = await createLease(ownerA.id, organisationA.id, {
      referenceNumber: "LEASE-001", propertyId: propertyA.id, unitId: unitA.id, tenantOrganisationIds: [tenantA.relationship.id],
      startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "125000", depositAmountMinor: "250000", currencyCode: "GHS",
      rentFrequency: "MONTHLY", status: "ACTIVE", documents: [{ fileKey: "leases/lease-001.pdf", fileName: "lease.pdf", contentType: "application/pdf" }],
    });
    expect((await getLease(ownerA.id, organisationA.id, lease.id)).parties).toHaveLength(1);
    await expect(transitionLease(ownerA.id, organisationA.id, lease.id, "DRAFT")).rejects.toMatchObject({ code: "INVALID_LEASE_TRANSITION" });
    await transitionLease(ownerA.id, organisationA.id, lease.id, "EXPIRING");
    expect(await generateRentSchedule(ownerA.id, organisationA.id, lease.id, 3)).toBe(3);
    expect(await generateRentSchedule(ownerA.id, organisationA.id, lease.id, 3)).toBe(3);
    expect(await db.rentObligation.count({ where: { leaseId: lease.id } })).toBe(3);
    await createExpiryPolicy(ownerA.id, organisationA.id, 365, ["EMAIL"]);
    expect(await scheduleExpiryReminders(ownerA.id, organisationA.id, new Date("2026-01-02"))).toBe(1);
    expect(await scheduleExpiryReminders(ownerA.id, organisationA.id, new Date("2026-01-02"))).toBe(0);
    expect(await db.notification.count({ where: { leaseId: lease.id } })).toBe(1);
    await expect(getLease(ownerB.id, organisationB.id, lease.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getTenant(ownerB.id, organisationB.id, tenantA.relationship.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateTenant(ownerB.id, organisationB.id, tenantA.relationship.id, { phone: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createLease(ownerA.id, organisationA.id, { referenceNumber: "LEASE-002", propertyId: propertyA.id, unitId: unitB.id, tenantOrganisationIds: [tenantA.relationship.id], startDate: "2026-01-01", rentAmountMinor: "1", currencyCode: "GHS", rentFrequency: "MONTHLY" })).rejects.toMatchObject({ code: "INVALID_UNIT" });
    await expect(createLease(ownerA.id, organisationA.id, { referenceNumber: "LEASE-003", propertyId: propertyA.id, tenantOrganisationIds: [tenantB.relationship.id], startDate: "2026-01-01", rentAmountMinor: "1", currencyCode: "GHS", rentFrequency: "MONTHLY" })).rejects.toMatchObject({ code: "INVALID_TENANT" });
    await expect(createLease(ownerA.id, organisationA.id, { referenceNumber: "LEASE-004", propertyId: propertyA.id, tenantOrganisationIds: [tenantA.relationship.id], startDate: "2026-12-31", endDate: "2026-01-01", rentAmountMinor: "1", currencyCode: "GHS", rentFrequency: "MONTHLY" })).rejects.toThrow("Lease end date cannot precede start date.");

    const viewer = await registerUser({ displayName: "Lease Viewer", email: "lease.viewer@example.com", password: "secure-password-123" });
    const viewerRole = await db.role.findUniqueOrThrow({ where: { key: "viewer" } });
    const membership = await db.organisationMember.create({ data: { organisationId: organisationA.id, userId: viewer.id } });
    await db.membershipRole.create({ data: { memberId: membership.id, roleId: viewerRole.id } });
    await expect(transitionLease(viewer.id, organisationA.id, lease.id, "TERMINATED")).rejects.toMatchObject({ code: "FORBIDDEN" });

    await transitionLease(ownerA.id, organisationA.id, lease.id, "TERMINATED");
    await updateLease(ownerA.id, organisationA.id, lease.id, { moveStatus: "MOVED_OUT" });
    const historicalLease = await getLease(ownerA.id, organisationA.id, lease.id);
    expect(historicalLease.status).toBe("TERMINATED");
    expect(historicalLease.history).toHaveLength(4);
    expect(await db.auditEvent.count({ where: { organisationId: organisationA.id, entityId: lease.id } })).toBeGreaterThanOrEqual(3);
    expect(await db.domainEvent.count({ where: { organisationId: organisationA.id, aggregateId: lease.id } })).toBeGreaterThanOrEqual(3);
  });
});
