import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { communicationPreferencesSchema, createTenantSchema, updateTenantSchema } from "./schemas";

export async function createTenant(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.tenantCreate);
  const data = createTenantSchema.parse(input);
  return db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { legalName: data.legalName, preferredName: data.preferredName } });
    const relationship = await tx.tenantOrganisation.create({
      data: {
        tenantId: tenant.id,
        organisationId,
        email: data.email,
        phone: data.phone,
        addressLine1: data.addressLine1,
        city: data.city,
        countryCode: data.countryCode,
        notes: data.notes,
      },
    });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "tenant.created", entityType: "tenant", entityId: relationship.id } });
    await tx.domainEvent.create({ data: { organisationId, name: "tenant.created", aggregateType: "tenant", aggregateId: relationship.id, payload: { tenantId: tenant.id } } });
    return { tenant, relationship };
  });
}

export async function getTenant(userId: string, organisationId: string, tenantOrganisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.tenantRead);
  const tenant = await db.tenantOrganisation.findFirst({
    where: { id: tenantOrganisationId, organisationId, archivedAt: null },
    include: { tenant: true, leaseParties: { include: { lease: { select: { id: true, referenceNumber: true, status: true, startDate: true, endDate: true, property: { select: { name: true } }, unit: { select: { name: true } } } } }, orderBy: { lease: { startDate: "desc" } } } },
  });
  if (!tenant) throw notFound();
  return tenant;
}

export async function listTenants(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.tenantRead);
  return db.tenantOrganisation.findMany({ where: { organisationId, archivedAt: null }, include: { tenant: true }, orderBy: { createdAt: "desc" } });
}

export async function updateTenant(userId: string, organisationId: string, tenantOrganisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.tenantUpdate);
  const data = updateTenantSchema.parse(input);
  return db.$transaction(async (tx) => {
    const relationship = await tx.tenantOrganisation.findFirst({ where: { id: tenantOrganisationId, organisationId, archivedAt: null } });
    if (!relationship) throw notFound();
    const { legalName, preferredName, ...profile } = data;
    if (legalName !== undefined || preferredName !== undefined) await tx.tenant.update({ where: { id: relationship.tenantId }, data: { legalName, preferredName } });
    const updated = await tx.tenantOrganisation.update({ where: { id: relationship.id }, data: profile });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "tenant.updated", entityType: "tenant", entityId: updated.id } });
    await tx.domainEvent.create({ data: { organisationId, name: "tenant.updated", aggregateType: "tenant", aggregateId: updated.id, payload: { changedFields: Object.keys(data) } } });
    return updated;
  });
}

export async function updateTenantCommunicationPreferences(userId: string, organisationId: string, tenantOrganisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.tenantUpdate);
  const parsed = communicationPreferencesSchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_COMMUNICATION_PREFERENCES", 422, parsed.error.issues[0]?.message ?? "Invalid communication preferences.");
  return db.$transaction(async (tx) => {
    const current = await tx.tenantOrganisation.findFirst({ where: { id: tenantOrganisationId, organisationId, archivedAt: null } });
    if (!current) throw notFound();
    const updated = await tx.tenantOrganisation.update({ where: { id: current.id }, data: parsed.data });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "tenant.communication_preferences_updated", entityType: "tenant", entityId: updated.id, metadata: parsed.data } });
    await tx.domainEvent.create({ data: { organisationId, name: "tenant.communication_preferences_updated", aggregateType: "tenant", aggregateId: updated.id, payload: parsed.data } });
    return updated;
  });
}
