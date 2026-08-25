import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";

export async function publishDomainEvent(input: {
  organisationId: string; name: string; aggregateType: string; aggregateId: string; payload: Prisma.InputJsonValue;
}) {
  return db.domainEvent.create({ data: input });
}
