import { db } from "@/platform/database/client";

/**
 * The signed-in user's own tenancies: tenant relationships an organisation has linked to this user
 * account (`TenantOrganisation.userId`), with their current (active or expiring) leases. It is keyed
 * only on the caller's user id, grants nothing, and returns no contact details, notes or amounts.
 * Every tenant action is still authorised by its own route (for example maintenance checks the
 * same link and lease again).
 */
export async function listUserTenancies(userId: string, options: { forRepairs?: boolean } = {}) {
  const relationships = await db.tenantOrganisation.findMany({
    where: { userId, archivedAt: null, organisation: { archivedAt: null } },
    select: {
      id: true,
      organisation: { select: { id: true, name: true } },
      leaseParties: {
        // For repair reports, also a started draft tenancy the landlord connected the tenant to
        // (the same rule as `reportableLease`, applied per relationship below).
        where: { role: "TENANT", lease: { archivedAt: null, status: { in: options.forRepairs ? ["ACTIVE", "EXPIRING", "DRAFT"] : ["ACTIVE", "EXPIRING"] } } },
        select: {
          lease: {
            select: {
              id: true,
              status: true,
              startDate: true,
              endDate: true,
              property: { select: { id: true, name: true } },
              unit: { select: { id: true, name: true } },
              accessInvitations: { where: { redeemedAt: { not: null } }, select: { tenantOrganisationId: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const now = new Date();
  return relationships.map((relationship) => ({
    tenantOrganisationId: relationship.id,
    organisation: relationship.organisation,
    leases: relationship.leaseParties
      .map(({ lease: { accessInvitations, ...lease } }) => ({ lease, connected: accessInvitations.some((invitation) => invitation.tenantOrganisationId === relationship.id) }))
      .filter(({ lease, connected }) => lease.status !== "DRAFT" || (connected && lease.startDate <= now))
      .map(({ lease }) => lease),
  }));
}
