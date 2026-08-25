import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";

export async function getOrganisationMembers(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.organisationManageMembers);
  return db.organisationMember.findMany({
    where: { organisationId, archivedAt: null },
    select: { id: true, status: true, user: { select: { id: true, email: true, displayName: true } } },
  });
}
