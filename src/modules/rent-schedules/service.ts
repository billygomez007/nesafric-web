import { db } from "@/platform/database/client";
import { notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";

function addMonths(date: Date, months: number) { const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate())); return next; }
function intervalMonths(frequency: string) { return frequency === "MONTHLY" ? 1 : frequency === "QUARTERLY" ? 3 : frequency === "ANNUAL" ? 12 : 1; }

export async function generateRentSchedule(userId: string, organisationId: string, leaseId: string, periods = 12) {
  await requirePermission(userId, organisationId, PERMISSIONS.rentScheduleManage);
  const lease = await db.lease.findFirst({ where: { id: leaseId, organisationId, archivedAt: null } });
  if (!lease) throw notFound();
  const months = intervalMonths(lease.rentFrequency);
  const rows: Array<{ organisationId: string; leaseId: string; propertyId: string; unitId: string | null; dueDate: Date; periodStart: Date; periodEnd: Date; amountMinor: typeof lease.rentAmountMinor; currencyCode: string }> = [];
  for (let index = 0; index < periods; index++) {
    const periodStart = addMonths(lease.startDate, index * months);
    if (lease.endDate && periodStart > lease.endDate) break;
    const periodEnd = new Date(addMonths(periodStart, months).getTime() - 86_400_000);
    rows.push({ organisationId, leaseId: lease.id, propertyId: lease.propertyId, unitId: lease.unitId, dueDate: periodStart, periodStart, periodEnd: lease.endDate && periodEnd > lease.endDate ? lease.endDate : periodEnd, amountMinor: lease.rentAmountMinor, currencyCode: lease.currencyCode });
  }
  const result = await db.$transaction(async (tx) => {
    for (const row of rows) await tx.rentObligation.upsert({ where: { leaseId_periodStart_periodEnd: { leaseId: row.leaseId, periodStart: row.periodStart, periodEnd: row.periodEnd } }, update: {}, create: row });
    await tx.domainEvent.create({ data: { organisationId, name: "rent_schedule.generated", aggregateType: "lease", aggregateId: lease.id, payload: { periods: rows.length } } });
    return rows.length;
  });
  return result;
}
