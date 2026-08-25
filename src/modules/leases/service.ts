import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { createLeaseSchema, updateLeaseSchema } from "./schemas";

function historyData(lease: { status: "DRAFT" | "ACTIVE" | "EXPIRING" | "EXPIRED" | "TERMINATED" | "CANCELLED"; startDate: Date; endDate: Date | null; rentAmountMinor: unknown; currencyCode: string; rentFrequency: "MONTHLY" | "QUARTERLY" | "ANNUAL" | "CUSTOM"; depositAmountMinor: unknown; notes: string | null }, changedByUserId: string, version: number) {
  return { leaseId: undefined as string | undefined, version, status: lease.status, startDate: lease.startDate, endDate: lease.endDate, rentAmountMinor: lease.rentAmountMinor as never, currencyCode: lease.currencyCode, rentFrequency: lease.rentFrequency, depositAmountMinor: lease.depositAmountMinor as never, notes: lease.notes, changedByUserId };
}

export async function createLease(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.leaseCreate);
  const data = createLeaseSchema.parse(input);
  const property = await db.property.findFirst({ where: { id: data.propertyId, organisationId, archivedAt: null } });
  if (!property) throw notFound();
  if (data.unitId) {
    const unit = await db.unit.findFirst({ where: { id: data.unitId, propertyId: property.id, archivedAt: null } });
    if (!unit) throw new AppError("INVALID_UNIT", 422, "The selected unit does not belong to this property.");
  }
  const tenants = await db.tenantOrganisation.findMany({ where: { id: { in: data.tenantOrganisationIds }, organisationId, archivedAt: null } });
  if (tenants.length !== new Set(data.tenantOrganisationIds).size) throw new AppError("INVALID_TENANT", 422, "Every lease tenant must belong to this organisation.");
  return db.$transaction(async (tx) => {
    const { tenantOrganisationIds, documents, ...leaseData } = data;
    const lease = await tx.lease.create({ data: { ...leaseData, propertyId: property.id, unitId: data.unitId, organisationId } });
    await tx.leaseParty.createMany({ data: tenantOrganisationIds.map((tenantOrganisationId, index) => ({ leaseId: lease.id, tenantOrganisationId, role: "TENANT", isPrimary: index === 0 })) });
    if (documents.length) await tx.leaseDocument.createMany({ data: documents.map((document) => ({ ...document, leaseId: lease.id })) });
    await tx.leaseHistory.create({ data: { ...historyData(lease, userId, 1), leaseId: lease.id } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "lease.created", entityType: "lease", entityId: lease.id } });
    await tx.domainEvent.create({ data: { organisationId, name: "lease.created", aggregateType: "lease", aggregateId: lease.id, payload: { propertyId: lease.propertyId, unitId: lease.unitId } } });
    if (lease.status === "ACTIVE") await tx.domainEvent.create({ data: { organisationId, name: "lease.activated", aggregateType: "lease", aggregateId: lease.id, payload: {} } });
    return lease;
  });
}

export async function getLease(userId: string, organisationId: string, leaseId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.leaseRead);
  const lease = await db.lease.findFirst({ where: { id: leaseId, organisationId, archivedAt: null }, include: { property: true, unit: true, parties: { include: { tenantOrganisation: { include: { tenant: true } } } }, documents: true, history: { orderBy: { version: "desc" } } } });
  if (!lease) throw notFound();
  return lease;
}

export async function listLeases(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.leaseRead);
  return db.lease.findMany({ where: { organisationId, archivedAt: null }, include: { property: { select: { name: true } }, unit: { select: { name: true } }, parties: { include: { tenantOrganisation: { include: { tenant: true } } } } }, orderBy: { startDate: "desc" } });
}

export async function updateLease(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.leaseUpdate);
  const data = updateLeaseSchema.parse(input);
  return db.$transaction(async (tx) => {
    const current = await tx.lease.findFirst({ where: { id: leaseId, organisationId, archivedAt: null }, include: { history: { select: { version: true }, orderBy: { version: "desc" }, take: 1 } } });
    if (!current) throw notFound();
    const nextStart = data.startDate ?? current.startDate;
    const nextEnd = data.endDate ?? current.endDate;
    if (nextEnd && nextEnd < nextStart) throw new AppError("INVALID_LEASE_DATES", 422, "Lease end date cannot precede start date.");
    const lease = await tx.lease.update({ where: { id: current.id }, data });
    await tx.leaseHistory.create({ data: { ...historyData(lease, userId, (current.history[0]?.version ?? 0) + 1), leaseId: lease.id } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "lease.updated", entityType: "lease", entityId: lease.id } });
    await tx.domainEvent.create({ data: { organisationId, name: "lease.updated", aggregateType: "lease", aggregateId: lease.id, payload: { changedFields: Object.keys(data) } } });
    return lease;
  });
}
