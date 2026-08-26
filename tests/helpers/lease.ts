import { createLease as createDraftLease } from "@/modules/leases/service";
import { db } from "@/platform/database/client";

export async function createLease(userId: string, organisationId: string, input: Record<string, unknown>) {
  const requestedStatus = input.status;
  const lease = await createDraftLease(userId, organisationId, { ...input, status: "DRAFT" });
  if (requestedStatus === "ACTIVE") {
    return db.lease.update({
      where: { id: lease.id },
      data: { status: "ACTIVE", executionStatus: "ACTIVE" },
    });
  }
  return lease;
}
