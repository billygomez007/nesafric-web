import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";

export async function getDashboard(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.propertyRead);
  const [properties, units, members] = await Promise.all([
    db.property.findMany({ where: { organisationId, archivedAt: null }, select: { id: true, name: true, referenceNumber: true, category: true, status: true }, orderBy: { createdAt: "desc" } }),
    db.unit.count({ where: { property: { organisationId, archivedAt: null }, archivedAt: null } }),
    db.organisationMember.count({ where: { organisationId, status: "ACTIVE", archivedAt: null } }),
  ]);
  return { properties, units, members };
}
