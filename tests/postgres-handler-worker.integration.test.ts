import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import { createLease } from "./helpers/lease";
import { createOrganisation } from "@/modules/organisations/service";
import { createTenant } from "@/modules/tenants/service";
import { db } from "@/platform/database/client";
import { jobHandlers } from "@/platform/jobs/handlers";
import { enqueueJob, runDueJobs } from "@/platform/jobs/runner";

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
    email: `${key.toLowerCase()}@worker.test`,
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
  return { owner, organisation, property, unit, tenant };
}

async function createActiveLease(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  referenceNumber: string,
  startDate: Date,
  endDate: Date,
) {
  return createLease(fixture.owner.id, fixture.organisation.id, {
    referenceNumber,
    propertyId: fixture.property.id,
    unitId: fixture.unit.id,
    tenantOrganisationIds: [fixture.tenant.relationship.id],
    startDate: dateInput(startDate),
    endDate: dateInput(endDate),
    rentAmountMinor: "250000",
    depositAmountMinor: "500000",
    currencyCode: "GHS",
    rentFrequency: "MONTHLY",
    status: "ACTIVE",
  });
}

describe("PostgreSQL registered handler worker", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("expires only eligible leases and records completion, audit, and domain events", async () => {
    const fixture = await createFixture("Expiry");
    const eligible = await createActiveLease(fixture, "EXPIRY-ENDED", utcDay(-30), utcDay(-1));
    const future = await createActiveLease(fixture, "EXPIRY-FUTURE", utcDay(-30), utcDay(1));
    await db.auditEvent.deleteMany({ where: { organisationId: fixture.organisation.id } });
    await db.domainEvent.deleteMany({ where: { organisationId: fixture.organisation.id } });

    const eligibleJob = await enqueueJob({
      organisationId: fixture.organisation.id,
      type: "lease-expiry",
      idempotencyKey: "expiry-eligible",
      payload: { systemUserId: fixture.owner.id, organisationId: fixture.organisation.id, leaseId: eligible.id },
    });
    const futureJob = await enqueueJob({
      organisationId: fixture.organisation.id,
      type: "lease-expiry",
      idempotencyKey: "expiry-future",
      payload: { systemUserId: fixture.owner.id, organisationId: fixture.organisation.id, leaseId: future.id },
    });

    await runDueJobs(jobHandlers);

    expect(await db.lease.findUniqueOrThrow({ where: { id: eligible.id } })).toMatchObject({ status: "EXPIRED" });
    expect(await db.lease.findUniqueOrThrow({ where: { id: future.id } })).toMatchObject({ status: "ACTIVE" });
    expect(await db.auditEvent.findMany({ where: { organisationId: fixture.organisation.id } })).toEqual([
      expect.objectContaining({ action: "lease.expired", entityId: eligible.id }),
    ]);
    expect(await db.domainEvent.findMany({ where: { organisationId: fixture.organisation.id } })).toEqual([
      expect.objectContaining({ name: "lease.expired", aggregateId: eligible.id }),
    ]);
    for (const jobId of [eligibleJob.id, futureJob.id]) {
      expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({
        status: "SUCCEEDED",
        attempts: 1,
        lastError: null,
        completedAt: expect.any(Date),
      });
    }
  });

  it("moves current obligations to due, older obligations to overdue, and leaves future obligations upcoming", async () => {
    const fixture = await createFixture("Rent");
    const lease = await createActiveLease(fixture, "RENT-STATUS", utcDay(-30), utcDay(90));
    const obligationData = {
      organisationId: fixture.organisation.id,
      leaseId: lease.id,
      propertyId: fixture.property.id,
      unitId: fixture.unit.id,
      amountMinor: "250000",
      currencyCode: "GHS",
    };
    const overdue = await db.rentObligation.create({ data: { ...obligationData, dueDate: utcDay(-1), periodStart: utcDay(-30), periodEnd: utcDay(-1) } });
    const due = await db.rentObligation.create({ data: { ...obligationData, dueDate: utcDay(), periodStart: utcDay(), periodEnd: utcDay(29) } });
    const future = await db.rentObligation.create({ data: { ...obligationData, dueDate: utcDay(1), periodStart: utcDay(30), periodEnd: utcDay(59) } });
    await db.auditEvent.deleteMany({ where: { organisationId: fixture.organisation.id } });
    await db.domainEvent.deleteMany({ where: { organisationId: fixture.organisation.id } });
    const job = await enqueueJob({
      organisationId: fixture.organisation.id,
      type: "rent-obligation-status",
      idempotencyKey: "rent-statuses",
      payload: { organisationId: fixture.organisation.id },
    });

    await runDueJobs(jobHandlers);

    expect(await db.rentObligation.findUniqueOrThrow({ where: { id: overdue.id } })).toMatchObject({ status: "OVERDUE" });
    expect(await db.rentObligation.findUniqueOrThrow({ where: { id: due.id } })).toMatchObject({ status: "DUE" });
    expect(await db.rentObligation.findUniqueOrThrow({ where: { id: future.id } })).toMatchObject({ status: "UPCOMING" });
    expect((await db.auditEvent.findMany({ where: { organisationId: fixture.organisation.id } })).map(({ action }) => action).sort()).toEqual([
      "rent_obligation.due",
      "rent_obligation.overdue",
    ]);
    expect((await db.domainEvent.findMany({ where: { organisationId: fixture.organisation.id } })).map(({ name }) => name).sort()).toEqual([
      "rent_obligation.due",
      "rent_obligation.overdue",
    ]);
    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "SUCCEEDED",
      completedAt: expect.any(Date),
    });
  });

  it("honours enabled policies and tenant channel preferences without duplicate reminders", async () => {
    const fixture = await createFixture("Reminder");
    const lease = await createActiveLease(fixture, "REMINDER-LEASE", utcDay(-30), utcDay(10));
    await db.tenantOrganisation.update({
      where: { id: fixture.tenant.relationship.id },
      data: {
        communicationEmailAllowed: true,
        communicationSmsAllowed: false,
        communicationWhatsappAllowed: true,
        communicationInAppAllowed: true,
      },
    });
    await db.reminderPolicy.createMany({
      data: [
        { organisationId: fixture.organisation.id, eventType: "LEASE_EXPIRY", daysOffset: 30, recipientType: "TENANT", channels: ["EMAIL", "SMS", "WHATSAPP", "IN_APP"], enabled: true },
        { organisationId: fixture.organisation.id, eventType: "LEASE_EXPIRY", daysOffset: 60, recipientType: "TENANT", channels: ["EMAIL"], enabled: false },
      ],
    });
    await db.auditEvent.deleteMany({ where: { organisationId: fixture.organisation.id } });
    await db.domainEvent.deleteMany({ where: { organisationId: fixture.organisation.id } });
    for (const suffix of ["first", "repeat"]) {
      await enqueueJob({
        organisationId: fixture.organisation.id,
        type: "lease-expiry-reminders",
        idempotencyKey: `expiry-reminders-${suffix}`,
        payload: { systemUserId: fixture.owner.id, organisationId: fixture.organisation.id },
      });
      await runDueJobs(jobHandlers);
    }

    const notifications = await db.notification.findMany({ where: { leaseId: lease.id }, orderBy: { channel: "asc" } });
    expect(notifications).toHaveLength(3);
    expect(notifications.map(({ channel }) => channel).sort()).toEqual(["EMAIL", "IN_APP", "WHATSAPP"]);
    expect(notifications.every(({ thresholdDays }) => thresholdDays === 30)).toBe(true);
    expect(await db.auditEvent.count({ where: { organisationId: fixture.organisation.id, action: "reminder.scheduled" } })).toBe(1);
    expect(await db.domainEvent.count({ where: { organisationId: fixture.organisation.id, name: "reminder.scheduled" } })).toBe(1);
    expect(await db.backgroundJob.count({ where: { organisationId: fixture.organisation.id, type: "lease-expiry-reminders", status: "SUCCEEDED" } })).toBe(2);
  });

  it("rejects organisation payload spoofing without processing another organisation's records", async () => {
    const fixtureA = await createFixture("IsolationA");
    const fixtureB = await createFixture("IsolationB");
    const leaseB = await createActiveLease(fixtureB, "ISOLATION-B", utcDay(-30), utcDay(90));
    const obligationB = await db.rentObligation.create({
      data: {
        organisationId: fixtureB.organisation.id,
        leaseId: leaseB.id,
        propertyId: fixtureB.property.id,
        unitId: fixtureB.unit.id,
        dueDate: utcDay(-1),
        periodStart: utcDay(-30),
        periodEnd: utcDay(-1),
        amountMinor: "250000",
        currencyCode: "GHS",
      },
    });
    const job = await enqueueJob({
      organisationId: fixtureA.organisation.id,
      type: "rent-obligation-status",
      idempotencyKey: "spoofed-organisation",
      payload: { organisationId: fixtureB.organisation.id },
    });

    await runDueJobs(jobHandlers);

    expect(await db.rentObligation.findUniqueOrThrow({ where: { id: obligationB.id } })).toMatchObject({ status: "UPCOMING" });
    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "FAILED",
      attempts: 1,
      completedAt: null,
      lastError: expect.stringContaining("does not match"),
    });
    expect(await db.domainEvent.count({ where: { organisationId: fixtureB.organisation.id, name: { startsWith: "rent_obligation." } } })).toBe(0);
  });

  it("captures actual handler failures and safely retries them to completion", async () => {
    const fixture = await createFixture("Retry");
    const lease = await createActiveLease(fixture, "RETRY-LEASE", utcDay(-30), utcDay(-1));
    const membership = await db.organisationMember.findFirstOrThrow({
      where: { organisationId: fixture.organisation.id, userId: fixture.owner.id },
    });
    await db.organisationMember.update({ where: { id: membership.id }, data: { status: "SUSPENDED" } });
    const job = await enqueueJob({
      organisationId: fixture.organisation.id,
      type: "lease-expiry",
      idempotencyKey: "retry-handler-failure",
      payload: { systemUserId: fixture.owner.id, organisationId: fixture.organisation.id, leaseId: lease.id },
      maxAttempts: 2,
    });

    await runDueJobs(jobHandlers);

    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "FAILED",
      attempts: 1,
      completedAt: null,
      lastError: "You do not have permission to perform this action.",
    });
    expect(await db.lease.findUniqueOrThrow({ where: { id: lease.id } })).toMatchObject({ status: "ACTIVE" });

    await db.organisationMember.update({ where: { id: membership.id }, data: { status: "ACTIVE" } });
    await db.backgroundJob.update({ where: { id: job.id }, data: { runAt: new Date(0) } });
    await runDueJobs(jobHandlers);

    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "SUCCEEDED",
      attempts: 2,
      lastError: null,
      completedAt: expect.any(Date),
    });
    expect(await db.lease.findUniqueOrThrow({ where: { id: lease.id } })).toMatchObject({ status: "EXPIRED" });
  });
});
