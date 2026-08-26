import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import { createLease } from "./helpers/lease";
import {
  enqueueNotificationDelivery,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/modules/notifications/service";
import { NotificationProviders } from "@/modules/notifications/providers";
import { createOrganisation } from "@/modules/organisations/service";
import { scheduleExpiryReminders } from "@/modules/reminders/service";
import { createTenant } from "@/modules/tenants/service";
import { db } from "@/platform/database/client";
import { createJobHandlers, jobHandlers } from "@/platform/jobs/handlers";
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
    email: `${key.toLowerCase()}@delivery.test`,
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

async function createNotification(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  channel: "IN_APP" | "EMAIL" | "SMS" | "WHATSAPP",
  thresholdDays: number,
) {
  return db.notification.create({
    data: {
      organisationId: fixture.organisation.id,
      leaseId: fixture.lease.id,
      tenantOrganisationId: fixture.tenant.relationship.id,
      eventType: "LEASE_EXPIRY",
      thresholdDays,
      channel,
      scheduledAt: new Date(),
    },
  });
}

function providers(overrides: Partial<NotificationProviders> = {}): NotificationProviders {
  const unavailable = (channel: string) => ({
    async deliver() {
      throw new Error(`${channel} test provider is unavailable.`);
    },
  });
  return {
    IN_APP: { async deliver(request) { return { status: "DELIVERED", providerReference: `in-app:${request.notificationId}` }; } },
    EMAIL: unavailable("EMAIL"),
    SMS: unavailable("SMS"),
    WHATSAPP: unavailable("WHATSAPP"),
    ...overrides,
  };
}

describe("PostgreSQL Phase 4B notification delivery", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("queues and delivers an in-app reminder through the worker", async () => {
    const fixture = await createFixture("InApp");
    await db.reminderPolicy.create({
      data: { organisationId: fixture.organisation.id, eventType: "LEASE_EXPIRY", daysOffset: 30, recipientType: "TENANT", channels: ["IN_APP"] },
    });

    expect(await scheduleExpiryReminders(fixture.owner.id, fixture.organisation.id)).toBe(1);
    const notification = await db.notification.findFirstOrThrow({ where: { organisationId: fixture.organisation.id } });
    expect(notification).toMatchObject({ status: "PENDING", readAt: null, deliveryAttempts: 0 });
    const job = await db.backgroundJob.findUniqueOrThrow({ where: { idempotencyKey: `notification-delivery:${notification.id}` } });

    await runDueJobs(jobHandlers);

    expect(await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).toMatchObject({
      status: "DELIVERED",
      deliveryAttempts: 1,
      processingAt: expect.any(Date),
      lastAttemptAt: expect.any(Date),
      sentAt: expect.any(Date),
      deliveredAt: expect.any(Date),
      providerReference: `in-app:${notification.id}`,
    });
    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "SUCCEEDED", attempts: 1 });
    expect(await db.auditEvent.count({ where: { action: "notification.delivered", entityId: notification.id } })).toBe(1);
    expect(await db.domainEvent.count({ where: { name: "notification.delivered", aggregateId: notification.id } })).toBe(1);
  });

  it("supports unread history, individual reads, read-all, isolation, and RBAC", async () => {
    const fixtureA = await createFixture("HistoryA");
    const fixtureB = await createFixture("HistoryB");
    const first = await createNotification(fixtureA, "IN_APP", 30);
    const second = await createNotification(fixtureA, "IN_APP", 60);
    await createNotification(fixtureB, "IN_APP", 30);

    expect(await listNotifications(fixtureA.owner.id, fixtureA.organisation.id)).toHaveLength(2);
    expect((await markNotificationRead(fixtureA.owner.id, fixtureA.organisation.id, first.id)).readAt).toEqual(expect.any(Date));
    expect((await db.notification.findUniqueOrThrow({ where: { id: second.id } })).readAt).toBeNull();
    expect(await markAllNotificationsRead(fixtureA.owner.id, fixtureA.organisation.id)).toBe(1);
    expect((await listNotifications(fixtureA.owner.id, fixtureA.organisation.id)).every(({ readAt }) => readAt)).toBe(true);
    await expect(markNotificationRead(fixtureB.owner.id, fixtureB.organisation.id, first.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const viewer = await registerUser({ displayName: "History Viewer", email: "history.viewer@delivery.test", password: "secure-password-123" });
    const viewerRole = await db.role.findUniqueOrThrow({ where: { key: "viewer" } });
    const membership = await db.organisationMember.create({ data: { organisationId: fixtureA.organisation.id, userId: viewer.id } });
    await db.membershipRole.create({ data: { memberId: membership.id, roleId: viewerRole.id } });
    await expect(listNotifications(viewer.id, fixtureA.organisation.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("prevents duplicate delivery across duplicate enqueue and worker execution", async () => {
    const fixture = await createFixture("Duplicate");
    const notification = await createNotification(fixture, "EMAIL", 30);
    const deliver = vi.fn(async () => ({ status: "SENT" as const, providerReference: "email-123" }));
    const handlers = createJobHandlers(providers({ EMAIL: { deliver } }));

    const first = await enqueueNotificationDelivery(notification);
    const duplicate = await enqueueNotificationDelivery(notification);
    expect(duplicate.id).toBe(first.id);
    await runDueJobs(handlers);
    await runDueJobs(handlers);

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).toMatchObject({
      status: "SENT",
      deliveryAttempts: 1,
      providerReference: "email-123",
    });
  });

  it("skips disabled tenant channels without calling a provider", async () => {
    const fixture = await createFixture("Disabled");
    await db.tenantOrganisation.update({
      where: { id: fixture.tenant.relationship.id },
      data: { communicationEmailAllowed: false },
    });
    const notification = await createNotification(fixture, "EMAIL", 30);
    const deliver = vi.fn(async () => ({ status: "SENT" as const }));
    const job = await enqueueNotificationDelivery(notification);

    await runDueJobs(createJobHandlers(providers({ EMAIL: { deliver } })));

    expect(deliver).not.toHaveBeenCalled();
    expect(await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).toMatchObject({
      status: "SKIPPED",
      deliveryAttempts: 1,
      failureReason: "EMAIL communication is disabled for this recipient.",
    });
    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "SUCCEEDED" });
  });

  it("persists provider failures and retries through the worker", async () => {
    const fixture = await createFixture("RetryDelivery");
    const notification = await createNotification(fixture, "EMAIL", 30);
    let calls = 0;
    const handlers = createJobHandlers(providers({
      EMAIL: {
        async deliver() {
          calls++;
          if (calls === 1) throw new Error("Temporary provider outage");
          return { status: "DELIVERED", providerReference: "email-retry-456" };
        },
      },
    }));
    const job = await enqueueNotificationDelivery(notification);

    await runDueJobs(handlers);

    expect(await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).toMatchObject({
      status: "FAILED",
      deliveryAttempts: 1,
      failedAt: expect.any(Date),
      failureReason: "Temporary provider outage",
    });
    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "FAILED",
      attempts: 1,
      lastError: "Temporary provider outage",
    });

    await db.backgroundJob.update({ where: { id: job.id }, data: { runAt: new Date(0) } });
    await runDueJobs(handlers);

    expect(await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).toMatchObject({
      status: "DELIVERED",
      deliveryAttempts: 2,
      failureReason: null,
      providerReference: "email-retry-456",
    });
    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "SUCCEEDED", attempts: 2, lastError: null });
  });

  it("rejects cross-organisation delivery jobs before provider execution", async () => {
    const fixtureA = await createFixture("DeliveryIsolationA");
    const fixtureB = await createFixture("DeliveryIsolationB");
    const notificationB = await createNotification(fixtureB, "IN_APP", 30);
    const job = await enqueueJob({
      organisationId: fixtureA.organisation.id,
      type: "notification-delivery",
      idempotencyKey: "cross-organisation-delivery",
      payload: { organisationId: fixtureB.organisation.id, notificationId: notificationB.id },
    });

    await runDueJobs(jobHandlers);

    expect(await db.notification.findUniqueOrThrow({ where: { id: notificationB.id } })).toMatchObject({ status: "PENDING", deliveryAttempts: 0 });
    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "FAILED",
      attempts: 1,
      lastError: expect.stringContaining("does not match"),
    });
  });
});
