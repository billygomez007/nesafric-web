import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDashboard } from "@/modules/assets/dashboard";
import { createProperty, getProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import { getLease, updateLease } from "@/modules/leases/service";
import { createLease } from "./helpers/lease";
import { amendLease, transitionLeaseRenewal } from "@/modules/lifecycle/service";
import { listNotifications } from "@/modules/notifications/service";
import { createOrganisation } from "@/modules/organisations/service";
import { generateRentSchedule } from "@/modules/rent-schedules/service";
import { createTenant, getTenant, listTenants } from "@/modules/tenants/service";
import { db } from "@/platform/database/client";

const DAY_MS = 86_400_000;

function utcDay(offset = 0) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * DAY_MS);
}

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function cleanDatabase() {
  await db.workOrderHistory.deleteMany();
  await db.workOrder.deleteMany();
  await db.maintenanceApproval.deleteMany();
  await db.maintenanceAttachment.deleteMany();
  await db.maintenanceHistory.deleteMany();
  await db.maintenanceRequest.deleteMany();
  await db.backgroundJob.deleteMany();
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
  await db.membershipRole.deleteMany();
  await db.organisationMember.deleteMany();
  await db.unit.deleteMany();
  await db.building.deleteMany();
  await db.property.deleteMany();
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

async function createFixture(key: string) {
  const owner = await registerUser({
    displayName: `${key} Owner`,
    email: `${key.toLowerCase()}@detail.test`,
    password: "secure-password-123",
  });
  const organisation = await createOrganisation(owner.id, {
    name: `${key} Properties`,
    type: "PROPERTY_MANAGEMENT",
    countryCode: "GH",
  });
  const property = await createProperty(owner.id, organisation.id, {
    name: `${key} Residence`,
    referenceNumber: `${key}-PROPERTY`,
    category: "Residential",
    countryCode: "GH",
    currencyCode: "GHS",
    units: [{ name: "Apartment 1" }, { name: "Apartment 2" }],
  });
  const units = await db.unit.findMany({ where: { propertyId: property.id }, orderBy: { name: "asc" } });
  const tenant = await createTenant(owner.id, organisation.id, {
    legalName: `${key} Tenant`,
    email: `${key.toLowerCase()}.tenant@example.com`,
    phone: "+233200000000",
  });
  const lease = await createLease(owner.id, organisation.id, {
    referenceNumber: `${key}-LEASE`,
    propertyId: property.id,
    unitId: units[0].id,
    tenantOrganisationIds: [tenant.relationship.id],
    startDate: dateInput(utcDay(-30)),
    endDate: dateInput(utcDay(90)),
    rentAmountMinor: "250000",
    currencyCode: "GHS",
    rentFrequency: "MONTHLY",
    status: "ACTIVE",
  });
  return { owner, organisation, property, units, tenant, lease };
}

describe("PostgreSQL Phase 4C detail UI read models", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("scopes tenant, lease, property, unit, and tenant selector data to the active organisation", async () => {
    const fixtureA = await createFixture("SelectorsA");
    const fixtureB = await createFixture("SelectorsB");

    const dashboardA = await getDashboard(fixtureA.owner.id, fixtureA.organisation.id);
    expect(dashboardA.properties.map(({ id }) => id)).toEqual([fixtureA.property.id]);
    expect(dashboardA.properties).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: fixtureB.property.id })]));

    const propertyA = await getProperty(fixtureA.owner.id, fixtureA.organisation.id, fixtureA.property.id);
    expect(propertyA.units.map(({ id }) => id).sort()).toEqual(fixtureA.units.map(({ id }) => id).sort());
    await expect(getProperty(fixtureA.owner.id, fixtureA.organisation.id, fixtureB.property.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const tenantsA = await listTenants(fixtureA.owner.id, fixtureA.organisation.id);
    expect(tenantsA.map(({ id }) => id)).toEqual([fixtureA.tenant.relationship.id]);
    await expect(getTenant(fixtureA.owner.id, fixtureA.organisation.id, fixtureB.tenant.relationship.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const tenantDetail = await getTenant(fixtureA.owner.id, fixtureA.organisation.id, fixtureA.tenant.relationship.id);
    expect(tenantDetail.leaseParties[0].lease.id).toBe(fixtureA.lease.id);
    const leaseDetail = await getLease(fixtureA.owner.id, fixtureA.organisation.id, fixtureA.lease.id);
    expect(leaseDetail.parties[0].tenantOrganisation.id).toBe(fixtureA.tenant.relationship.id);
    await expect(getLease(fixtureB.owner.id, fixtureB.organisation.id, fixtureA.lease.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns lease snapshots, read-only amendments, obligations, and linked notification history", async () => {
    const fixture = await createFixture("History");
    await updateLease(fixture.owner.id, fixture.organisation.id, fixture.lease.id, { notes: "Renewed paint condition recorded." });
    await amendLease(fixture.owner.id, fixture.organisation.id, fixture.lease.id, "Rent review", { rentAmountMinor: "275000" });
    await generateRentSchedule(fixture.owner.id, fixture.organisation.id, fixture.lease.id, 3);
    const obligations = await db.rentObligation.findMany({ where: { leaseId: fixture.lease.id }, orderBy: { dueDate: "asc" } });
    await db.rentObligation.update({ where: { id: obligations[0].id }, data: { status: "OVERDUE" } });
    await db.notification.create({
      data: {
        organisationId: fixture.organisation.id,
        leaseId: fixture.lease.id,
        tenantOrganisationId: fixture.tenant.relationship.id,
        eventType: "LEASE_EXPIRY",
        thresholdDays: 30,
        channel: "IN_APP",
        scheduledAt: new Date(),
      },
    });

    const detail = await getLease(fixture.owner.id, fixture.organisation.id, fixture.lease.id);
    expect(detail.history.map(({ version }) => version)).toEqual([2, 1]);
    expect(detail.amendments).toEqual([expect.objectContaining({ sequence: 1, summary: "Rent review" })]);
    expect(detail.obligations).toHaveLength(3);
    expect(detail.obligations.some(({ status }) => status === "OVERDUE")).toBe(true);
    expect(detail.obligations.some(({ status }) => status === "UPCOMING")).toBe(true);

    const notifications = await listNotifications(fixture.owner.id, fixture.organisation.id);
    expect(notifications).toEqual([expect.objectContaining({ leaseId: fixture.lease.id, tenantOrganisationId: fixture.tenant.relationship.id })]);
  });

  it("enforces renewal transitions, permissions, organisation isolation, and events", async () => {
    const fixtureA = await createFixture("RenewalA");
    const fixtureB = await createFixture("RenewalB");
    const viewer = await registerUser({ displayName: "Renewal Viewer", email: "renewal.viewer@detail.test", password: "secure-password-123" });
    const viewerRole = await db.role.findUniqueOrThrow({ where: { key: "viewer" } });
    const membership = await db.organisationMember.create({ data: { organisationId: fixtureA.organisation.id, userId: viewer.id } });
    await db.membershipRole.create({ data: { memberId: membership.id, roleId: viewerRole.id } });

    await expect(transitionLeaseRenewal(viewer.id, fixtureA.organisation.id, fixtureA.lease.id, { status: "REQUESTED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(transitionLeaseRenewal(fixtureB.owner.id, fixtureB.organisation.id, fixtureA.lease.id, { status: "REQUESTED" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const requested = await transitionLeaseRenewal(fixtureA.owner.id, fixtureA.organisation.id, fixtureA.lease.id, { status: "REQUESTED" });
    expect(requested.renewalWorkflowStatus).toBe("REQUESTED");
    await expect(transitionLeaseRenewal(fixtureA.owner.id, fixtureA.organisation.id, fixtureA.lease.id, { status: "COMPLETED" })).rejects.toMatchObject({ code: "INVALID_RENEWAL_TRANSITION" });
    expect(await db.auditEvent.count({ where: { organisationId: fixtureA.organisation.id, entityId: fixtureA.lease.id, action: "lease.renewal_status_changed" } })).toBe(1);
    expect(await db.domainEvent.count({ where: { organisationId: fixtureA.organisation.id, aggregateId: fixtureA.lease.id, name: "lease.renewal_status_changed" } })).toBe(1);
  });
});
