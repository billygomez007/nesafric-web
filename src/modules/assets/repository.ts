import { Prisma } from "@/platform/database/generated/client";

export function activePropertyScope(organisationId: string, propertyId?: string): Prisma.PropertyWhereInput {
  return { organisationId, archivedAt: null, ...(propertyId ? { id: propertyId } : {}) };
}
