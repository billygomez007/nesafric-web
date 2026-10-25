import type { Prisma } from "@/platform/database/generated/client";

/**
 * Leases a linked tenant may report repairs on: a current (active or expiring) lease, or a draft
 * tenancy that has already started and that the landlord connected this tenant to with a redeemed
 * access invitation. The second is how a landlord who signs up on WhatsApp records tenants who
 * already live in the units before lease execution is done. It opens repair reports only: rent,
 * lease status and every other lease rule still follow lease execution.
 */
export function reportableLease(tenantOrganisationId: string, now = new Date()): Prisma.LeaseWhereInput {
  return {
    OR: [
      { status: { in: ["ACTIVE", "EXPIRING"] } },
      { status: "DRAFT", startDate: { lte: now }, accessInvitations: { some: { tenantOrganisationId, redeemedAt: { not: null } } } },
    ],
  };
}
