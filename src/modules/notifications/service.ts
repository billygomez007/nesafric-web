import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { enqueueJob } from "@/platform/jobs/runner";
import { defaultNotificationProviders, NotificationProviders } from "./providers";

export async function enqueueNotificationDelivery(notification: { id: string; organisationId: string }) {
  return enqueueJob({
    organisationId: notification.organisationId,
    type: "notification-delivery",
    idempotencyKey: `notification-delivery:${notification.id}`,
    payload: { organisationId: notification.organisationId, notificationId: notification.id },
  });
}

function communicationAllowed(notification: {
  channel: "IN_APP" | "EMAIL" | "SMS" | "WHATSAPP";
  organisation: { notifyEmail: boolean; notifySms: boolean; notifyWhatsapp: boolean };
  tenantOrganisation: {
    communicationEmailAllowed: boolean;
    communicationSmsAllowed: boolean;
    communicationWhatsappAllowed: boolean;
    communicationInAppAllowed: boolean;
  } | null;
}) {
  const tenant = notification.tenantOrganisation;
  if (!tenant) {
    // Organisation-level notifications (Phase 20 commercial/subscription events) have no tenant
    // recipient at all — they are addressed to the organisation's own team, not a tenant, so
    // tenant communication preferences do not apply. IN_APP is always visible in-app; other
    // channels still respect the organisation's own channel preference.
    if (notification.channel === "IN_APP") return true;
    if (notification.channel === "EMAIL") return notification.organisation.notifyEmail;
    if (notification.channel === "SMS") return notification.organisation.notifySms;
    return notification.organisation.notifyWhatsapp;
  }
  if (notification.channel === "IN_APP") return tenant.communicationInAppAllowed;
  if (notification.channel === "EMAIL") return tenant.communicationEmailAllowed && notification.organisation.notifyEmail;
  if (notification.channel === "SMS") return tenant.communicationSmsAllowed && notification.organisation.notifySms;
  return tenant.communicationWhatsappAllowed && notification.organisation.notifyWhatsapp;
}

export async function deliverNotification(
  organisationId: string,
  notificationId: string,
  providers: NotificationProviders = defaultNotificationProviders,
) {
  const notification = await db.notification.findFirst({
    where: { id: notificationId, organisationId },
    include: { organisation: true, tenantOrganisation: true },
  });
  if (!notification) throw notFound();
  if (["SENT", "DELIVERED", "SKIPPED", "CANCELLED"].includes(notification.status)) return notification;

  const now = new Date();
  const claimed = await db.notification.updateMany({
    where: { id: notificationId, organisationId, status: { in: ["PENDING", "SCHEDULED", "FAILED"] } },
    data: {
      status: "PROCESSING",
      processingAt: now,
      lastAttemptAt: now,
      deliveryAttempts: { increment: 1 },
      failedAt: null,
      failureReason: null,
    },
  });
  if (!claimed.count) {
    return db.notification.findFirstOrThrow({ where: { id: notificationId, organisationId } });
  }

  if (!communicationAllowed(notification)) {
    return db.$transaction(async (tx) => {
      const skipped = await tx.notification.update({
        where: { id: notificationId },
        data: { status: "SKIPPED", failureReason: `${notification.channel} communication is disabled for this recipient.` },
      });
      await tx.auditEvent.create({ data: { organisationId, action: "notification.skipped", entityType: "notification", entityId: notificationId, metadata: { channel: notification.channel } } });
      await tx.domainEvent.create({ data: { organisationId, name: "notification.skipped", aggregateType: "notification", aggregateId: notificationId, payload: { channel: notification.channel } } });
      return skipped;
    });
  }

  try {
    const result = await providers[notification.channel].deliver({
      notificationId,
      organisationId,
      channel: notification.channel,
      eventType: notification.eventType,
      tenantOrganisationId: notification.tenantOrganisationId,
      leaseId: notification.leaseId,
    });
    const deliveredAt = result.status === "DELIVERED" ? new Date() : undefined;
    return db.$transaction(async (tx) => {
      const delivered = await tx.notification.update({
        where: { id: notificationId },
        data: {
          status: result.status,
          sentAt: new Date(),
          deliveredAt,
          providerReference: result.providerReference,
          failureReason: null,
        },
      });
      const eventName = result.status === "DELIVERED" ? "notification.delivered" : "notification.sent";
      await tx.auditEvent.create({ data: { organisationId, action: eventName, entityType: "notification", entityId: notificationId, metadata: { channel: notification.channel } } });
      await tx.domainEvent.create({ data: { organisationId, name: eventName, aggregateType: "notification", aggregateId: notificationId, payload: { channel: notification.channel, providerReference: result.providerReference ?? null } } });
      return delivered;
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown notification delivery failure";
    await db.$transaction(async (tx) => {
      await tx.notification.update({ where: { id: notificationId }, data: { status: "FAILED", failedAt: new Date(), failureReason: reason } });
      await tx.auditEvent.create({ data: { organisationId, action: "notification.failed", entityType: "notification", entityId: notificationId, metadata: { channel: notification.channel, reason } } });
      await tx.domainEvent.create({ data: { organisationId, name: "notification.failed", aggregateType: "notification", aggregateId: notificationId, payload: { channel: notification.channel, reason } } });
    });
    throw error;
  }
}

export async function listNotifications(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.reminderManage);
  return db.notification.findMany({
    where: { organisationId },
    include: {
      lease: { select: { id: true, referenceNumber: true } },
      tenantOrganisation: { include: { tenant: { select: { id: true, legalName: true, preferredName: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function markNotificationRead(userId: string, organisationId: string, notificationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.reminderManage);
  const notification = await db.notification.findFirst({ where: { id: notificationId, organisationId } });
  if (!notification) throw notFound();
  if (notification.readAt) return notification;
  return db.$transaction(async (tx) => {
    const readAt = new Date();
    const updated = await tx.notification.update({ where: { id: notificationId }, data: { readAt } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "notification.read", entityType: "notification", entityId: notificationId } });
    await tx.domainEvent.create({ data: { organisationId, name: "notification.read", aggregateType: "notification", aggregateId: notificationId, payload: { readAt: readAt.toISOString() } } });
    return updated;
  });
}

export async function markAllNotificationsRead(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.reminderManage);
  const readAt = new Date();
  return db.$transaction(async (tx) => {
    const result = await tx.notification.updateMany({ where: { organisationId, readAt: null }, data: { readAt } });
    if (result.count) {
      await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "notification.read_all", entityType: "organisation", entityId: organisationId, metadata: { count: result.count } } });
      await tx.domainEvent.create({ data: { organisationId, name: "notification.read_all", aggregateType: "organisation", aggregateId: organisationId, payload: { count: result.count, readAt: readAt.toISOString() } } });
    }
    return result.count;
  });
}

export async function retryFailedNotification(userId: string, organisationId: string, notificationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.reminderManage);
  const notification = await db.notification.findFirst({ where: { id: notificationId, organisationId } });
  if (!notification) throw notFound();
  if (notification.status !== "FAILED") {
    throw new AppError("NOTIFICATION_NOT_RETRYABLE", 409, "Only failed notifications can be retried.");
  }
  const job = await db.backgroundJob.findUnique({ where: { idempotencyKey: `notification-delivery:${notification.id}` } });
  if (job && job.attempts >= job.maxAttempts) {
    throw new AppError("NOTIFICATION_RETRY_EXHAUSTED", 409, "Notification delivery attempts are exhausted.");
  }
  await db.$transaction(async (tx) => {
    await tx.notification.update({ where: { id: notification.id }, data: { status: "PENDING", failedAt: null, failureReason: null } });
    if (job) await tx.backgroundJob.update({ where: { id: job.id }, data: { status: "FAILED", runAt: new Date(), lockedAt: null } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "notification.retry_requested", entityType: "notification", entityId: notification.id, metadata: { attempts: notification.deliveryAttempts } } });
    await tx.domainEvent.create({ data: { organisationId, name: "notification.retry_requested", aggregateType: "notification", aggregateId: notification.id, payload: { attempts: notification.deliveryAttempts } } });
  });
  if (!job) await enqueueNotificationDelivery(notification);
  return db.notification.findUniqueOrThrow({ where: { id: notification.id } });
}
