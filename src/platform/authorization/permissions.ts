import { db } from "@/platform/database/client";
import { forbidden } from "@/platform/errors";
import { membershipHasPermission } from "./policy";

export const PERMISSIONS = {
  organisationManageMembers: "organisation.manage_members",
  propertyCreate: "property.create",
  propertyRead: "property.read",
  propertyUpdate: "property.update",
  portfolioCreate: "portfolio.create",
  auditRead: "audit.read",
  tenantCreate: "tenant.create",
  tenantRead: "tenant.read",
  tenantUpdate: "tenant.update",
  leaseCreate: "lease.create",
  leaseRead: "lease.read",
  leaseUpdate: "lease.update",
  reminderManage: "reminder.manage",
  rentScheduleManage: "rent_schedule.manage",
} as const;

export async function requirePermission(userId: string, organisationId: string, permission: string) {
  const membership = await db.organisationMember.findFirst({
    where: { userId, organisationId, status: "ACTIVE", archivedAt: null },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  if (!membership || !membershipHasPermission(membership.roles, permission)) {
    throw forbidden();
  }
  return membership;
}
