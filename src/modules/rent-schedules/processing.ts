import { db } from "@/platform/database/client";

export async function processRentObligationStatuses(organisationId: string, now = new Date()) {
  await db.rentObligation.updateMany({ where: { organisationId, status: "UPCOMING", dueDate: { lte: now } }, data: { status: "DUE" } });
  const result = await db.rentObligation.updateMany({ where: { organisationId, status: "DUE", dueDate: { lt: now } }, data: { status: "OVERDUE" } });
  if (result.count) await db.domainEvent.create({ data: { organisationId, name: "rent_obligation.overdue", aggregateType: "organisation", aggregateId: organisationId, payload: { count: result.count } } });
  return result.count;
}
