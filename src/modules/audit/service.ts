import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";

export async function recordAudit(input: {
  organisationId: string; actorUserId?: string; action: string; entityType: string; entityId: string; metadata?: Prisma.InputJsonValue;
}) {
  return db.auditEvent.create({ data: input });
}
