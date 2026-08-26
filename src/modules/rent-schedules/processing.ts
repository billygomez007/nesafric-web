import { db } from "@/platform/database/client";

export async function processRentObligationStatuses(organisationId: string, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today.getTime() + 86_400_000);
  return db.$transaction(async (tx) => {
    const due = await tx.rentObligation.updateMany({
      where: { organisationId, collectionState: { not: "FULLY_PAID" }, status: "UPCOMING", dueDate: { gte: today, lt: tomorrow } },
      data: { status: "DUE" },
    });
    const overdue = await tx.rentObligation.updateMany({
      where: { organisationId, collectionState: { not: "FULLY_PAID" }, status: { in: ["UPCOMING", "DUE"] }, dueDate: { lt: today } },
      data: { status: "OVERDUE" },
    });
    if (due.count) {
      await tx.auditEvent.create({ data: { organisationId, action: "rent_obligation.due", entityType: "organisation", entityId: organisationId, metadata: { count: due.count } } });
      await tx.domainEvent.create({ data: { organisationId, name: "rent_obligation.due", aggregateType: "organisation", aggregateId: organisationId, payload: { count: due.count } } });
    }
    if (overdue.count) {
      await tx.auditEvent.create({ data: { organisationId, action: "rent_obligation.overdue", entityType: "organisation", entityId: organisationId, metadata: { count: overdue.count } } });
      await tx.domainEvent.create({ data: { organisationId, name: "rent_obligation.overdue", aggregateType: "organisation", aggregateId: organisationId, payload: { count: overdue.count } } });
    }
    return overdue.count;
  });
}
