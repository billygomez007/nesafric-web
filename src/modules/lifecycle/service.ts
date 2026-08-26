import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { Prisma } from "@/platform/database/generated/client";
import { renewalTransitionSchema } from "@/modules/leases/schemas";

const transitions: Record<string, string[]> = {
  DRAFT: ["CANCELLED"],
  ACTIVE: ["EXPIRING", "EXPIRED", "TERMINATED"],
  EXPIRING: ["ACTIVE", "EXPIRED", "TERMINATED"],
  EXPIRED: [],
  TERMINATED: [],
  CANCELLED: [],
};

export async function transitionLease(userId: string, organisationId: string, leaseId: string, status: "DRAFT" | "ACTIVE" | "EXPIRING" | "EXPIRED" | "TERMINATED" | "CANCELLED") {
  await requirePermission(userId, organisationId, PERMISSIONS.leaseUpdate);
  return db.$transaction(async (tx) => {
    const lease = await tx.lease.findFirst({ where: { id: leaseId, organisationId, archivedAt: null }, include: { history: { orderBy: { version: "desc" }, take: 1 } } });
    if (!lease) throw notFound();
    if (!transitions[lease.status].includes(status)) throw new AppError("INVALID_LEASE_TRANSITION", 422, `Cannot transition ${lease.status} to ${status}.`);
    const updated = await tx.lease.update({ where: { id: lease.id }, data: { status } });
    const version = (lease.history[0]?.version ?? 0) + 1;
    await tx.leaseHistory.create({ data: { leaseId: lease.id, version, status, startDate: updated.startDate, endDate: updated.endDate, rentAmountMinor: updated.rentAmountMinor, currencyCode: updated.currencyCode, rentFrequency: updated.rentFrequency, depositAmountMinor: updated.depositAmountMinor, notes: updated.notes, changedByUserId: userId } });
    const event = status === "ACTIVE" ? "lease.activated" : status === "EXPIRING" ? "lease.expiring" : status === "EXPIRED" ? "lease.expired" : status === "TERMINATED" ? "lease.terminated" : "lease.cancelled";
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: event, entityType: "lease", entityId: lease.id } });
    await tx.domainEvent.create({ data: { organisationId, name: event, aggregateType: "lease", aggregateId: lease.id, payload: { previousStatus: lease.status } } });
    return updated;
  });
}

export async function processLeaseExpiry(userId: string, organisationId: string, leaseId: string, now = new Date()) {
  await requirePermission(userId, organisationId, PERMISSIONS.leaseUpdate);
  const lease = await db.lease.findFirst({ where: { id: leaseId, organisationId, archivedAt: null } });
  if (!lease) throw notFound();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!lease.endDate || lease.endDate >= today || !["ACTIVE", "EXPIRING"].includes(lease.status)) return false;
  await transitionLease(userId, organisationId, leaseId, "EXPIRED");
  return true;
}

export async function amendLease(userId: string, organisationId: string, leaseId: string, summary: string, changes: Record<string, unknown>) {
  await requirePermission(userId, organisationId, PERMISSIONS.leaseUpdate);
  return db.$transaction(async (tx) => {
    const lease = await tx.lease.findFirst({ where: { id: leaseId, organisationId, archivedAt: null } });
    if (!lease) throw notFound();
    const amendment = await tx.leaseAmendment.create({ data: { leaseId, sequence: (await tx.leaseAmendment.count({ where: { leaseId } })) + 1, summary, changes: JSON.parse(JSON.stringify(changes)) as Prisma.InputJsonValue, createdByUserId: userId } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "lease.amended", entityType: "lease_amendment", entityId: amendment.id } });
    await tx.domainEvent.create({ data: { organisationId, name: "lease.amended", aggregateType: "lease", aggregateId: leaseId, payload: { amendmentId: amendment.id } } });
    return amendment;
  });
}

const renewalTransitions = {
  NONE: ["REQUESTED"],
  REQUESTED: ["UNDER_DISCUSSION", "DECLINED"],
  UNDER_DISCUSSION: ["APPROVED", "DECLINED"],
  APPROVED: ["COMPLETED"],
  DECLINED: ["REQUESTED"],
  COMPLETED: [],
} as const;

export async function transitionLeaseRenewal(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.leaseUpdate);
  const { status } = renewalTransitionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const lease = await tx.lease.findFirst({ where: { id: leaseId, organisationId, archivedAt: null } });
    if (!lease) throw notFound();
    const allowed = renewalTransitions[lease.renewalWorkflowStatus];
    if (!(allowed as readonly string[]).includes(status)) {
      throw new AppError("INVALID_RENEWAL_TRANSITION", 422, `Cannot transition renewal from ${lease.renewalWorkflowStatus} to ${status}.`);
    }
    const updated = await tx.lease.update({ where: { id: lease.id }, data: { renewalWorkflowStatus: status } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "lease.renewal_status_changed", entityType: "lease", entityId: lease.id, metadata: { previousStatus: lease.renewalWorkflowStatus, status } } });
    await tx.domainEvent.create({ data: { organisationId, name: "lease.renewal_status_changed", aggregateType: "lease", aggregateId: lease.id, payload: { previousStatus: lease.renewalWorkflowStatus, status } } });
    return updated;
  });
}
