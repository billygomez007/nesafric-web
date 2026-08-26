import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { enqueueNotificationDelivery } from "@/modules/notifications/service";
import { createReminderPolicySchema, manualReminderSchema, updateReminderPolicySchema } from "./schemas";
import { Prisma } from "@/platform/database/generated/client";

function invalidPolicy(message: string) {
  return new AppError("INVALID_REMINDER_POLICY", 422, message);
}

function duplicatePolicy() {
  return new AppError("DUPLICATE_REMINDER_POLICY", 409, "A lease-expiry policy already uses this threshold.");
}

export async function listExpiryPolicies(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.reminderManage);
  return db.reminderPolicy.findMany({
    where: { organisationId, eventType: "LEASE_EXPIRY", recipientType: "TENANT" },
    orderBy: [{ enabled: "desc" }, { daysOffset: "desc" }],
  });
}

export async function createExpiryPolicy(userId: string, organisationId: string, daysOffset: number, channels: ("IN_APP" | "EMAIL" | "SMS" | "WHATSAPP")[]) {
  return createReminderPolicy(userId, organisationId, { daysOffset, channels, enabled: true });
}

export async function createReminderPolicy(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.reminderManage);
  const parsed = createReminderPolicySchema.safeParse(input);
  if (!parsed.success) throw invalidPolicy(parsed.error.issues[0]?.message ?? "Invalid reminder policy.");
  const duplicate = await db.reminderPolicy.findUnique({
    where: { organisationId_eventType_daysOffset_recipientType: { organisationId, eventType: "LEASE_EXPIRY", daysOffset: parsed.data.daysOffset, recipientType: "TENANT" } },
  });
  if (duplicate) throw duplicatePolicy();
  try {
    return await db.$transaction(async (tx) => {
      const policy = await tx.reminderPolicy.create({
        data: { organisationId, eventType: "LEASE_EXPIRY", recipientType: "TENANT", ...parsed.data },
      });
      await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "reminder_policy.created", entityType: "reminder_policy", entityId: policy.id, metadata: { daysOffset: policy.daysOffset, channels: policy.channels } } });
      await tx.domainEvent.create({ data: { organisationId, name: "reminder_policy.created", aggregateType: "reminder_policy", aggregateId: policy.id, payload: { daysOffset: policy.daysOffset, channels: policy.channels, enabled: policy.enabled } } });
      return policy;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw duplicatePolicy();
    throw error;
  }
}

export async function updateReminderPolicy(userId: string, organisationId: string, policyId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.reminderManage);
  const parsed = updateReminderPolicySchema.safeParse(input);
  if (!parsed.success) throw invalidPolicy(parsed.error.issues[0]?.message ?? "Invalid reminder policy.");
  const current = await db.reminderPolicy.findFirst({
    where: { id: policyId, organisationId, eventType: "LEASE_EXPIRY", recipientType: "TENANT" },
  });
  if (!current) throw notFound();
  if (parsed.data.daysOffset !== undefined && parsed.data.daysOffset !== current.daysOffset) {
    const duplicate = await db.reminderPolicy.findFirst({
      where: { organisationId, eventType: "LEASE_EXPIRY", recipientType: "TENANT", daysOffset: parsed.data.daysOffset, id: { not: policyId } },
    });
    if (duplicate) throw duplicatePolicy();
  }
  return db.$transaction(async (tx) => {
    const policy = await tx.reminderPolicy.update({ where: { id: policyId }, data: parsed.data });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "reminder_policy.updated", entityType: "reminder_policy", entityId: policy.id, metadata: { changedFields: Object.keys(parsed.data) } } });
    await tx.domainEvent.create({ data: { organisationId, name: "reminder_policy.updated", aggregateType: "reminder_policy", aggregateId: policy.id, payload: { changedFields: Object.keys(parsed.data), daysOffset: policy.daysOffset, channels: policy.channels, enabled: policy.enabled } } });
    return policy;
  });
}

export async function scheduleExpiryReminders(userId: string, organisationId: string, now = new Date()) {
  await requirePermission(userId, organisationId, PERMISSIONS.reminderManage);
  const [policies, leases] = await Promise.all([
    db.reminderPolicy.findMany({ where: { organisationId, eventType: "LEASE_EXPIRY", enabled: true } }),
    db.lease.findMany({ where: { organisationId, status: { in: ["ACTIVE", "EXPIRING"] }, endDate: { not: null }, archivedAt: null }, include: { parties: { include: { tenantOrganisation: true } } } }),
  ]);
  let scheduled = 0;
  const notificationIds = await db.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const lease of leases) for (const policy of policies) {
      const threshold = new Date(lease.endDate!.getTime() - policy.daysOffset * 86_400_000);
      if (threshold > now) continue;
      for (const party of lease.parties) for (const channel of policy.channels) {
        const allowed = channel === "EMAIL" ? party.tenantOrganisation.communicationEmailAllowed : channel === "SMS" ? party.tenantOrganisation.communicationSmsAllowed : channel === "WHATSAPP" ? party.tenantOrganisation.communicationWhatsappAllowed : party.tenantOrganisation.communicationInAppAllowed;
        if (!allowed) continue;
        const result = await tx.notification.createMany({
          data: { organisationId, leaseId: lease.id, tenantOrganisationId: party.tenantOrganisationId, eventType: "LEASE_EXPIRY", thresholdDays: policy.daysOffset, channel, scheduledAt: now },
          skipDuplicates: true,
        });
        scheduled += result.count;
        const notification = await tx.notification.findUniqueOrThrow({
          where: { leaseId_tenantOrganisationId_eventType_thresholdDays_dedupeReference_channel: { leaseId: lease.id, tenantOrganisationId: party.tenantOrganisationId, eventType: "LEASE_EXPIRY", thresholdDays: policy.daysOffset, dedupeReference: "", channel } },
          select: { id: true },
        });
        ids.push(notification.id);
      }
    }
    if (scheduled) {
      await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "reminder.scheduled", entityType: "organisation", entityId: organisationId, metadata: { scheduled } } });
      await tx.domainEvent.create({ data: { organisationId, name: "reminder.scheduled", aggregateType: "organisation", aggregateId: organisationId, payload: { scheduled } } });
    }
    return ids;
  });
  for (const id of new Set(notificationIds)) await enqueueNotificationDelivery({ id, organisationId });
  return scheduled;
}

export async function markNotificationSent(userId: string, organisationId: string, notificationId: string, providerReference?: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.reminderManage);
  const notification = await db.notification.findFirst({ where: { id: notificationId, organisationId } });
  if (!notification) throw notFound();
  return db.$transaction(async (tx) => {
    const updated = await tx.notification.update({ where: { id: notification.id }, data: { status: "SENT", sentAt: new Date(), providerReference } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "reminder.sent", entityType: "notification", entityId: updated.id } });
    await tx.domainEvent.create({ data: { organisationId, name: "reminder.sent", aggregateType: "notification", aggregateId: updated.id, payload: {} } });
    return updated;
  });
}

export async function sendManualReminder(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.reminderManage);
  const data = manualReminderSchema.parse(input);
  const lease = await db.lease.findFirst({
    where: {
      id: data.leaseId,
      organisationId,
      archivedAt: null,
      parties: { some: { tenantOrganisationId: data.tenantOrganisationId } },
    },
    include: { organisation: true, parties: { where: { tenantOrganisationId: data.tenantOrganisationId }, include: { tenantOrganisation: true } } },
  });
  if (!lease) throw notFound();
  if (data.eventType === "LEASE_EXPIRY" && !["ACTIVE", "EXPIRING"].includes(lease.status)) {
    throw new AppError("LEASE_REMINDER_NOT_ELIGIBLE", 409, "Lease-expiry reminders require an active or expiring lease.");
  }
  if (data.eventType === "RENT_OVERDUE" && !await db.rentObligation.count({ where: { leaseId: lease.id, organisationId, status: "OVERDUE" } })) {
    throw new AppError("RENT_REMINDER_NOT_ELIGIBLE", 409, "Overdue-rent reminders require an overdue obligation.");
  }
  const tenant = lease.parties[0]!.tenantOrganisation;
  const allowed =
    data.channel === "IN_APP" ? tenant.communicationInAppAllowed :
    data.channel === "EMAIL" ? tenant.communicationEmailAllowed && lease.organisation.notifyEmail :
    data.channel === "SMS" ? tenant.communicationSmsAllowed && lease.organisation.notifySms :
    tenant.communicationWhatsappAllowed && lease.organisation.notifyWhatsapp;
  if (!allowed) throw new AppError("COMMUNICATION_CHANNEL_DISABLED", 409, "The selected communication channel is disabled for this tenant.");
  const notification = await db.$transaction(async (tx) => {
    const created = await tx.notification.create({
      data: {
        organisationId,
        leaseId: lease.id,
        tenantOrganisationId: data.tenantOrganisationId,
        eventType: data.eventType,
        channel: data.channel,
        scheduledAt: new Date(),
      },
    });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "reminder.manual_scheduled", entityType: "notification", entityId: created.id, metadata: { leaseId: lease.id, eventType: data.eventType, channel: data.channel } } });
    await tx.domainEvent.create({ data: { organisationId, name: "reminder.manual_scheduled", aggregateType: "notification", aggregateId: created.id, payload: { leaseId: lease.id, eventType: data.eventType, channel: data.channel } } });
    return created;
  });
  await enqueueNotificationDelivery(notification);
  return notification;
}
