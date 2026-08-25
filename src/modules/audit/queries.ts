import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";

export async function getAuditEvents(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.auditRead);
  return db.auditEvent.findMany({ where: { organisationId }, orderBy: { createdAt: "desc" } });
}
