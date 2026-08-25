import { db } from "@/platform/database/client";
import { notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";

export async function createExpiryPolicy(userId: string, organisationId: string, daysOffset: number, channels: ("IN_APP" | "EMAIL" | "SMS" | "WHATSAPP")[]) {
  await requirePermission(userId, organisationId, PERMISSIONS.reminderManage);
  return db.reminderPolicy.upsert({ where: { organisationId_eventType_daysOffset_recipientType: { organisationId, eventType: "LEASE_EXPIRY", daysOffset, recipientType: "TENANT" } }, update: { channels, enabled: true }, create: { organisationId, eventType: "LEASE_EXPIRY", daysOffset, recipientType: "TENANT", channels } });
}

export async function scheduleExpiryReminders(userId: string, organisationId: string, now = new Date()) {
  await requirePermission(userId, organisationId, PERMISSIONS.reminderManage);
  const [policies, leases] = await Promise.all([
    db.reminderPolicy.findMany({ where: { organisationId, eventType: "LEASE_EXPIRY", enabled: true } }),
    db.lease.findMany({ where: { organisationId, status: { in: ["ACTIVE", "EXPIRING"] }, endDate: { not: null }, archivedAt: null }, include: { parties: { include: { tenantOrganisation: true } } } }),
  ]);
  let scheduled = 0;
  await db.$transaction(async (tx) => {
    for (const lease of leases) for (const policy of policies) {
      const threshold = new Date(lease.endDate!.getTime() - policy.daysOffset * 86_400_000);
      if (threshold > now) continue;
      for (const party of lease.parties) for (const channel of policy.channels) {
        const allowed = channel === "EMAIL" ? party.tenantOrganisation.communicationEmailAllowed : channel === "SMS" ? party.tenantOrganisation.communicationSmsAllowed : channel === "WHATSAPP" ? party.tenantOrganisation.communicationWhatsappAllowed : party.tenantOrganisation.communicationInAppAllowed;
        if (!allowed) continue;
        await tx.notification.upsert({ where: { leaseId_tenantOrganisationId_eventType_thresholdDays_channel: { leaseId: lease.id, tenantOrganisationId: party.tenantOrganisationId, eventType: "LEASE_EXPIRY", thresholdDays: policy.daysOffset, channel } }, update: {}, create: { organisationId, leaseId: lease.id, tenantOrganisationId: party.tenantOrganisationId, eventType: "LEASE_EXPIRY", thresholdDays: policy.daysOffset, channel, scheduledAt: now } });
        scheduled++;
      }
    }
    if (scheduled) await tx.domainEvent.create({ data: { organisationId, name: "reminder.scheduled", aggregateType: "organisation", aggregateId: organisationId, payload: { scheduled } } });
  });
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
