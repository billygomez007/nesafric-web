import { db } from "@/platform/database/client";
import { PERMISSIONS } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";
import type { MaintenanceStatus } from "@/platform/database/generated/client";
import { listOwnedProviders } from "@/modules/providers/service";

const OPEN_MAINTENANCE: MaintenanceStatus[] = ["REPORTED", "TRIAGED", "AWAITING_APPROVAL", "APPROVED", "ASSIGNED", "IN_PROGRESS"];

export type AccountRoles = {
  managed: Array<{ organisationId: string; name: string; properties: number; units: number; openMaintenance: number }>;
  tenancies: Array<{ organisationName: string; propertyName: string; unitName: string | null; status: string; endDate: Date | null }>;
  providers: Array<{ id: string; name: string; pendingJobs: number; activeJobs: number }>;
};

/**
 * What a verified WhatsApp user can see, resolved with the same rules as the web app:
 * - managed portfolios need an active membership with `property.read` in that organisation;
 * - tenancies need a `TenantOrganisation` linked to this user and an ACTIVE/EXPIRING lease;
 * - provider jobs need ownership of the provider profile.
 * Only counts and the person's own tenancy labels leave this function.
 */
export async function resolveAccountRoles(userId: string): Promise<AccountRoles> {
  const memberships = await db.organisationMember.findMany({
    where: { userId, status: "ACTIVE", archivedAt: null, organisation: { archivedAt: null } },
    include: { organisation: { select: { id: true, name: true } }, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  const readable = memberships.filter((membership) => membershipHasPermission(membership.roles, PERMISSIONS.propertyRead));
  const managed = await Promise.all(readable.map(async ({ organisation }) => {
    const canReadMaintenance = memberships.some((membership) => membership.organisationId === organisation.id && membershipHasPermission(membership.roles, PERMISSIONS.maintenanceRead));
    const [properties, units, openMaintenance] = await Promise.all([
      db.property.count({ where: { organisationId: organisation.id, archivedAt: null } }),
      db.unit.count({ where: { archivedAt: null, property: { organisationId: organisation.id, archivedAt: null } } }),
      canReadMaintenance ? db.maintenanceRequest.count({ where: { organisationId: organisation.id, status: { in: OPEN_MAINTENANCE } } }) : Promise.resolve(0),
    ]);
    return { organisationId: organisation.id, name: organisation.name, properties, units, openMaintenance };
  }));

  const leases = await db.lease.findMany({
    where: { status: { in: ["ACTIVE", "EXPIRING"] }, parties: { some: { tenantOrganisation: { userId, archivedAt: null } } } },
    select: { status: true, endDate: true, organisation: { select: { name: true } }, property: { select: { name: true } }, unit: { select: { name: true } } },
    orderBy: { startDate: "desc" },
    take: 10,
  });
  const tenancies = leases.map((lease) => ({ organisationName: lease.organisation.name, propertyName: lease.property.name, unitName: lease.unit?.name ?? null, status: lease.status, endDate: lease.endDate }));

  const owned = await listOwnedProviders(userId);
  const providers = await Promise.all(owned.map(async (provider) => {
    const [pendingJobs, activeJobs] = await Promise.all([
      db.providerAssignment.count({ where: { providerId: provider.id, status: "PENDING" } }),
      db.providerAssignment.count({ where: { providerId: provider.id, status: "ACCEPTED" } }),
    ]);
    return { id: provider.id, name: provider.displayName, pendingJobs, activeJobs };
  }));

  return { managed, tenancies, providers };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function formatAccountSummary(displayName: string, roles: AccountRoles) {
  const lines = [`NesAfric account: ${displayName}`];
  for (const portfolio of roles.managed) {
    lines.push(`\nManaging ${portfolio.name}: ${plural(portfolio.properties, "property").replace("propertys", "properties")}, ${plural(portfolio.units, "unit")}, ${plural(portfolio.openMaintenance, "open maintenance request")}.`);
  }
  for (const tenancy of roles.tenancies) {
    lines.push(`\nTenancy: ${tenancy.propertyName}${tenancy.unitName ? `, ${tenancy.unitName}` : ""} (${tenancy.organisationName})${tenancy.status === "EXPIRING" ? ", lease expiring" : ""}${tenancy.endDate ? `, ends ${tenancy.endDate.toISOString().slice(0, 10)}` : ""}.`);
  }
  for (const provider of roles.providers) {
    lines.push(`\nService provider ${provider.name}: ${plural(provider.pendingJobs, "job")} awaiting your response, ${plural(provider.activeJobs, "accepted job")}.`);
  }
  if (lines.length === 1) lines.push("\nThis account has no managed properties, active tenancies or provider profiles yet.");
  lines.push("\nReply unlink to disconnect this WhatsApp number, or menu for other options.");
  return lines.join("");
}
