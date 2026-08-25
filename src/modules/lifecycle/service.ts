import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { Prisma } from "@/platform/database/generated/client";

const transitions: Record<string, string[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
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
