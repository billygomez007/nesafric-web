import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import { createLease } from "./helpers/lease";
import { createOrganisation } from "@/modules/organisations/service";
import {
  createReminderPolicy,
  listExpiryPolicies,
  scheduleExpiryReminders,
  updateReminderPolicy,
} from "@/modules/reminders/service";
import { createTenant, updateTenantCommunicationPreferences } from "@/modules/tenants/service";
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
  await db.organisation.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
}

async function createFixture(key: string) {
  const owner = await registerUser({
    displayName: `${key} Owner`,
    email: `${key.toLowerCase()}@settings.test`,
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
    units: [{ name: "Apartment 1" }],
  });
  const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
  const tenant = await createTenant(owner.id, organisation.id, {
    legalName: `${key} Tenant`,
    email: `${key.toLowerCase()}.tenant@example.com`,
    phone: "+233200000000",
  });
  const lease = await createLease(owner.id, organisation.id, {
    referenceNumber: `${key}-LEASE`,
    propertyId: property.id,
    unitId: unit.id,
    tenantOrganisationIds: [tenant.relationship.id],
    startDate: dateInput(utcDay(-30)),
    endDate: dateInput(utcDay(10)),
    rentAmountMinor: "250000",
    currencyCode: "GHS",
    rentFrequency: "MONTHLY",
    status: "ACTIVE",
  });
  return { owner, organisation, property, unit, tenant, lease };
}

describe("PostgreSQL Phase 4D reminder and communication settings", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("creates, lists, edits, enables, and disables channel policies with audit and events", async () => {
    const fixture = await createFixture("Policy");
    const policy = await createReminderPolicy(fixture.owner.id, fixture.organisation.id, {
      daysOffset: 30,
      channels: ["IN_APP", "EMAIL"],
      enabled: true,
    });
    expect(await listExpiryPolicies(fixture.owner.id, fixture.organisation.id)).toEqual([
      expect.objectContaining({ id: policy.id, daysOffset: 30, channels: ["IN_APP", "EMAIL"], enabled: true }),
    ]);

    const disabled = await updateReminderPolicy(fixture.owner.id, fixture.organisation.id, policy.id, {
      daysOffset: 21,
      channels: ["SMS", "WHATSAPP"],
      enabled: false,
    });
    expect(disabled).toMatchObject({ daysOffset: 21, channels: ["SMS", "WHATSAPP"], enabled: false });
    expect((await updateReminderPolicy(fixture.owner.id, fixture.organisation.id, policy.id, { enabled: true })).enabled).toBe(true);
    expect(await db.auditEvent.count({ where: { organisationId: fixture.organisation.id, entityId: policy.id, action: { startsWith: "reminder_policy." } } })).toBe(3);
    expect(await db.domainEvent.count({ where: { organisationId: fixture.organisation.id, aggregateId: policy.id, name: { startsWith: "reminder_policy." } } })).toBe(3);
  });

  it("rejects invalid, duplicate, and conflicting thresholds", async () => {
    const fixture = await createFixture("Validation");
    const first = await createReminderPolicy(fixture.owner.id, fixture.organisation.id, { daysOffset: 30, channels: ["IN_APP"] });
    const second = await createReminderPolicy(fixture.owner.id, fixture.organisation.id, { daysOffset: 60, channels: ["EMAIL"] });

    await expect(createReminderPolicy(fixture.owner.id, fixture.organisation.id, { daysOffset: -1, channels: ["IN_APP"] })).rejects.toMatchObject({ code: "INVALID_REMINDER_POLICY" });
    await expect(createReminderPolicy(fixture.owner.id, fixture.organisation.id, { daysOffset: 30, channels: ["EMAIL"] })).rejects.toMatchObject({ code: "DUPLICATE_REMINDER_POLICY" });
    await expect(createReminderPolicy(fixture.owner.id, fixture.organisation.id, { daysOffset: 90, channels: [] })).rejects.toMatchObject({ code: "INVALID_REMINDER_POLICY" });
    await expect(updateReminderPolicy(fixture.owner.id, fixture.organisation.id, second.id, { daysOffset: first.daysOffset })).rejects.toMatchObject({ code: "DUPLICATE_REMINDER_POLICY" });
  });

  it("enforces policy and tenant-preference RBAC and organisation isolation", async () => {
    const fixtureA = await createFixture("SettingsA");
    const fixtureB = await createFixture("SettingsB");
    const policyA = await createReminderPolicy(fixtureA.owner.id, fixtureA.organisation.id, { daysOffset: 30, channels: ["IN_APP"] });
    const viewer = await registerUser({ displayName: "Settings Viewer", email: "settings.viewer@settings.test", password: "secure-password-123" });
    const viewerRole = await db.role.findUniqueOrThrow({ where: { key: "viewer" } });
    const membership = await db.organisationMember.create({ data: { organisationId: fixtureA.organisation.id, userId: viewer.id } });
    await db.membershipRole.create({ data: { memberId: membership.id, roleId: viewerRole.id } });

    await expect(listExpiryPolicies(viewer.id, fixtureA.organisation.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateReminderPolicy(viewer.id, fixtureA.organisation.id, policyA.id, { enabled: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateTenantCommunicationPreferences(viewer.id, fixtureA.organisation.id, fixtureA.tenant.relationship.id, {
      communicationInAppAllowed: true,
      communicationEmailAllowed: false,
      communicationSmsAllowed: false,
      communicationWhatsappAllowed: false,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateReminderPolicy(fixtureB.owner.id, fixtureB.organisation.id, policyA.id, { enabled: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateTenantCommunicationPreferences(fixtureB.owner.id, fixtureB.organisation.id, fixtureA.tenant.relationship.id, {
      communicationInAppAllowed: false,
      communicationEmailAllowed: false,
      communicationSmsAllowed: false,
      communicationWhatsappAllowed: false,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listExpiryPolicies(fixtureB.owner.id, fixtureB.organisation.id)).toHaveLength(0);
  });

  it("updates tenant preferences and applies changed policies only to future reminders", async () => {
    const fixture = await createFixture("Future");
    const policy = await createReminderPolicy(fixture.owner.id, fixture.organisation.id, { daysOffset: 30, channels: ["IN_APP"], enabled: true });
    expect(await scheduleExpiryReminders(fixture.owner.id, fixture.organisation.id)).toBe(1);
    const historical = await db.notification.findFirstOrThrow({ where: { leaseId: fixture.lease.id } });

    await updateReminderPolicy(fixture.owner.id, fixture.organisation.id, policy.id, { daysOffset: 15, channels: ["EMAIL"], enabled: false });
    expect(await scheduleExpiryReminders(fixture.owner.id, fixture.organisation.id)).toBe(0);
    await updateReminderPolicy(fixture.owner.id, fixture.organisation.id, policy.id, { enabled: true });
    await updateTenantCommunicationPreferences(fixture.owner.id, fixture.organisation.id, fixture.tenant.relationship.id, {
      communicationInAppAllowed: true,
      communicationEmailAllowed: false,
      communicationSmsAllowed: false,
      communicationWhatsappAllowed: false,
    });
    expect(await scheduleExpiryReminders(fixture.owner.id, fixture.organisation.id)).toBe(0);

    const updatedTenant = await updateTenantCommunicationPreferences(fixture.owner.id, fixture.organisation.id, fixture.tenant.relationship.id, {
      communicationInAppAllowed: true,
      communicationEmailAllowed: true,
      communicationSmsAllowed: false,
      communicationWhatsappAllowed: false,
    });
    expect(updatedTenant.communicationEmailAllowed).toBe(true);
    expect(await scheduleExpiryReminders(fixture.owner.id, fixture.organisation.id)).toBe(1);

    expect(await db.notification.findUniqueOrThrow({ where: { id: historical.id } })).toMatchObject({ thresholdDays: 30, channel: "IN_APP" });
    expect(await db.notification.findMany({ where: { leaseId: fixture.lease.id }, orderBy: { thresholdDays: "desc" } })).toEqual([
      expect.objectContaining({ thresholdDays: 30, channel: "IN_APP" }),
      expect.objectContaining({ thresholdDays: 15, channel: "EMAIL" }),
    ]);
    expect(await db.auditEvent.count({ where: { organisationId: fixture.organisation.id, action: "tenant.communication_preferences_updated", entityId: fixture.tenant.relationship.id } })).toBe(2);
    expect(await db.domainEvent.count({ where: { organisationId: fixture.organisation.id, name: "tenant.communication_preferences_updated", aggregateId: fixture.tenant.relationship.id } })).toBe(2);
  });
});
