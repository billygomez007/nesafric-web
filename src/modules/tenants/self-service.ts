import { db } from "@/platform/database/client";

/**
 * The signed-in user's own tenancies: tenant relationships an organisation has linked to this user
 * account (`TenantOrganisation.userId`), with their current (active or expiring) leases. It is keyed
 * only on the caller's user id, grants nothing, and returns no contact details, notes or amounts.
 * Every tenant action is still authorised by its own route (for example maintenance checks the
 * same link and lease again).
 */
export async function listUserTenancies(userId: string) {
  const relationships = await db.tenantOrganisation.findMany({
    where: { userId, archivedAt: null, organisation: { archivedAt: null } },
    select: {
      id: true,
      organisation: { select: { id: true, name: true } },
      leaseParties: {
        where: { role: "TENANT", lease: { archivedAt: null, status: { in: ["ACTIVE", "EXPIRING"] } } },
        select: {
          lease: {
            select: {
              id: true,
              status: true,
              startDate: true,
              endDate: true,
              property: { select: { id: true, name: true } },
              unit: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return relationships.map((relationship) => ({
    tenantOrganisationId: relationship.id,
    organisation: relationship.organisation,
    leases: relationship.leaseParties.map((party) => party.lease),
  }));
}
