import { randomUUID } from "node:crypto";
import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { AppError, forbidden, notFound } from "@/platform/errors";
import { upsertCalendarEvent } from "@/modules/calendar/service";
import {
  closeLeaseSchema,
  deductionDecisionSchema,
  deductionReversalSchema,
  deductionSchema,
  keyReturnSchema,
  inspectionAcknowledgementSchema,
  moveOutInspectionSchema,
  noticeSchema,
  noticeTransitionSchema,
  refundSchema,
  scheduleMoveOutSchema,
  settlementApprovalSchema,
  turnoverTaskSchema,
  turnoverTaskUpdateSchema,
  turnoverTransitionSchema,
} from "./schemas";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const zero = () => new Prisma.Decimal(0);
const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

const moveOutInclude = {
  notice: { include: { history: { orderBy: { createdAt: "asc" as const } } } },
  history: { orderBy: { createdAt: "asc" as const } },
  inspections: {
    include: { areas: true, meterReadings: true, inventory: true },
    orderBy: { inspectedAt: "desc" as const },
  },
  depositSettlement: {
    include: {
      tenantOrganisation: { include: { tenant: true } },
      deductions: { orderBy: { createdAt: "asc" as const } },
      ledgerEntries: { orderBy: { createdAt: "asc" as const } },
    },
  },
  turnover: {
    include: {
      tasks: { include: { maintenanceRequest: true }, orderBy: { key: "asc" as const } },
      history: { orderBy: { createdAt: "asc" as const } },
    },
  },
  lease: {
    include: {
      property: true,
      unit: true,
      parties: { include: { tenantOrganisation: { include: { tenant: true } } } },
      moveIn: {
        include: {
          inspections: { include: { areas: true, meterReadings: true, inventory: true }, orderBy: { inspectedAt: "desc" as const } },
          keyHandovers: { orderBy: { issuedAt: "asc" as const } },
        },
      },
    },
  },
} satisfies Prisma.MoveOutInclude;

async function record(tx: Tx, organisationId: string, actorUserId: string, name: string, aggregateType: string, aggregateId: string, payload: Record<string, unknown> = {}) {
  await tx.auditEvent.create({ data: { organisationId, actorUserId, action: name, entityType: aggregateType, entityId: aggregateId, metadata: json(payload) } });
  await tx.domainEvent.create({ data: { organisationId, name, aggregateType, aggregateId, payload: json(payload) } });
}

async function leaseTenant(userId: string, organisationId: string, leaseId: string) {
  return db.leaseParty.findFirst({
    where: { leaseId, lease: { organisationId, archivedAt: null }, tenantOrganisation: { userId, archivedAt: null } },
    select: { tenantOrganisationId: true },
  });
}

async function requireRead(userId: string, organisationId: string, leaseId: string) {
  try {
    await requirePermission(userId, organisationId, PERMISSIONS.moveOutRead);
    return { internal: true as const };
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "FORBIDDEN") throw error;
    const tenant = await leaseTenant(userId, organisationId, leaseId);
    if (!tenant) throw forbidden();
    return { internal: false as const, tenantOrganisationId: tenant.tenantOrganisationId };
  }
}

async function getScopedLease(tx: Tx, organisationId: string, leaseId: string) {
  const lease = await tx.lease.findFirst({
    where: { id: leaseId, organisationId, archivedAt: null },
    include: { parties: true, noticeToVacate: true, moveOut: true },
  });
  if (!lease) throw notFound();
  return lease;
}

function defaultClosureRequirements() {
  return { inspectionRequired: true, keyReturnRequired: true, settlementRequired: true };
}

async function recalculateSettlement(tx: Tx, settlementId: string) {
  const settlement = await tx.depositSettlement.findUniqueOrThrow({ where: { id: settlementId } });
  const deposits = await tx.securityDeposit.findMany({ where: { leaseId: settlement.leaseId, organisationId: settlement.organisationId } });
  const received = deposits.reduce((sum, deposit) => sum.plus(deposit.amountMinor), zero());
  const deducted = deposits.reduce((sum, deposit) => sum.plus(deposit.deductedAmountMinor), zero());
  const refunded = deposits.reduce((sum, deposit) => sum.plus(deposit.refundedAmountMinor), zero());
  const approved = await tx.depositDeduction.aggregate({ where: { settlementId, status: "APPROVED" }, _sum: { amountMinor: true } });
  const obligations = await tx.rentObligation.findMany({
    where: { leaseId: settlement.leaseId, status: { not: "CANCELLED" } },
    select: { amountMinor: true, collectedAmountMinor: true },
  });
  const outstanding = obligations.reduce((sum, obligation) => sum.plus(obligation.amountMinor).minus(obligation.collectedAmountMinor), zero());
  const available = Prisma.Decimal.max(zero(), received.minus(deducted).minus(refunded));
  const refundEntitlement = settlement.approvedAt ? settlement.refundAmountMinor : available;
  return tx.depositSettlement.update({
    where: { id: settlementId },
    data: {
      depositReceivedMinor: received,
      priorAdjustmentMinor: refunded.plus(deducted),
      outstandingBalanceMinor: outstanding,
      approvedDeductionMinor: approved._sum.amountMinor ?? zero(),
      refundAmountMinor: refundEntitlement,
      refundedAmountMinor: refunded,
    },
    include: { deductions: { orderBy: { createdAt: "asc" } } },
  });
}

async function createSettlementIfNeeded(tx: Tx, organisationId: string, moveOutId: string) {
  const moveOut = await tx.moveOut.findUniqueOrThrow({ where: { id: moveOutId }, include: { lease: { include: { parties: true } } } });
  let settlement = await tx.depositSettlement.findUnique({ where: { moveOutId } });
  if (!settlement) {
    const primary = moveOut.lease.parties.find(({ isPrimary }) => isPrimary) ?? moveOut.lease.parties[0];
    if (!primary) throw new AppError("LEASE_TENANT_REQUIRED", 409, "A lease tenant is required for settlement.");
    settlement = await tx.depositSettlement.create({
      data: {
        organisationId,
        leaseId: moveOut.leaseId,
        moveOutId,
        tenantOrganisationId: primary.tenantOrganisationId,
        currencyCode: moveOut.lease.currencyCode,
        status: "UNDER_REVIEW",
      },
    });
  }
  return recalculateSettlement(tx, settlement.id);
}

export async function createNoticeToVacate(userId: string, organisationId: string, leaseId: string, input: unknown) {
  const data = noticeSchema.parse(input);
  const tenant = await leaseTenant(userId, organisationId, leaseId);
  let internal = false;
  try {
    await requirePermission(userId, organisationId, PERMISSIONS.moveOutManage);
    internal = true;
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "FORBIDDEN") throw error;
    if (!tenant) throw forbidden();
  }
  if (!internal && (data.source !== "TENANT" || data.tenantOrganisationId && data.tenantOrganisationId !== tenant?.tenantOrganisationId)) throw forbidden();
  return db.$transaction(async (tx) => {
    const lease = await getScopedLease(tx, organisationId, leaseId);
    if (!["ACTIVE", "EXPIRING"].includes(lease.status)) throw new AppError("LEASE_NOTICE_UNAVAILABLE", 409, "Notice can only be recorded for an active or expiring lease.");
    if (data.tenantOrganisationId && !lease.parties.some(({ tenantOrganisationId }) => tenantOrganisationId === data.tenantOrganisationId)) {
      throw new AppError("INVALID_NOTICE_TENANT", 422, "The notice tenant is not a party to this lease.");
    }
    const existing = lease.noticeToVacate;
    if (existing && existing.status !== "WITHDRAWN") throw new AppError("NOTICE_ALREADY_EXISTS", 409, "An active notice already exists for this lease.");
    const tenantOrganisationId = data.tenantOrganisationId ?? tenant?.tenantOrganisationId;
    const notice = existing
      ? await tx.noticeToVacate.update({
        where: { id: existing.id },
        data: { ...data, tenantOrganisationId, createdByUserId: userId, status: "SUBMITTED", withdrawnAt: null, history: { create: { actorUserId: userId, fromStatus: "WITHDRAWN", toStatus: "SUBMITTED" } } },
      })
      : await tx.noticeToVacate.create({
        data: { ...data, organisationId, leaseId, tenantOrganisationId, createdByUserId: userId, history: { create: { actorUserId: userId, toStatus: "SUBMITTED" } } },
      });
    await record(tx, organisationId, userId, "tenancy.notice_given", "notice_to_vacate", notice.id, { leaseId, source: notice.source });
    return notice;
  });
}

export async function transitionNoticeToVacate(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.moveOutManage);
  const data = noticeTransitionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const notice = await tx.noticeToVacate.findFirst({ where: { leaseId, organisationId } });
    if (!notice) throw notFound();
    if (notice.status !== "SUBMITTED") throw new AppError("INVALID_NOTICE_TRANSITION", 409, `A ${notice.status} notice cannot move to ${data.status}.`);
    const updated = await tx.noticeToVacate.update({
      where: { id: notice.id },
      data: {
        status: data.status,
        acknowledgedAt: data.status === "ACKNOWLEDGED" ? new Date() : notice.acknowledgedAt,
        withdrawnAt: data.status === "WITHDRAWN" ? new Date() : notice.withdrawnAt,
        history: { create: { actorUserId: userId, fromStatus: notice.status, toStatus: data.status, note: data.note } },
      },
    });
    await record(tx, organisationId, userId, `tenancy.notice_${data.status.toLowerCase()}`, "notice_to_vacate", notice.id, { leaseId, fromStatus: notice.status, toStatus: data.status });
    return updated;
  });
}

export async function scheduleMoveOut(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.moveOutManage);
  const data = scheduleMoveOutSchema.parse(input);
  return db.$transaction(async (tx) => {
    const lease = await getScopedLease(tx, organisationId, leaseId);
    if (lease.moveOut?.status === "COMPLETED") throw new AppError("MOVE_OUT_COMPLETED", 409, "A completed move-out cannot be changed.");
    if (lease.moveOut && !["NOT_STARTED", "NOTICE_RECEIVED", "SCHEDULED"].includes(lease.moveOut.status)) throw new AppError("MOVE_OUT_SCHEDULE_LOCKED", 409, "This move-out can no longer be rescheduled.");
    if (!["ACTIVE", "EXPIRING", "EXPIRED"].includes(lease.status)) throw new AppError("LEASE_MOVE_OUT_UNAVAILABLE", 409, "Move-out cannot be scheduled for this lease.");
    if (data.responsibleMemberId) {
      const member = await tx.organisationMember.findFirst({ where: { id: data.responsibleMemberId, organisationId, status: "ACTIVE", archivedAt: null } });
      if (!member) throw new AppError("INVALID_MOVE_OUT_ASSIGNEE", 422, "The responsible staff member is invalid.");
    }
    const requirements = { ...defaultClosureRequirements(), ...data.closureRequirements };
    const moveOut = lease.moveOut
      ? await tx.moveOut.update({
        where: { id: lease.moveOut.id },
        data: { scheduledDate: data.scheduledDate, responsibleMemberId: data.responsibleMemberId, notes: data.notes, closureRequirements: json(requirements), status: "SCHEDULED", history: { create: { actorUserId: userId, fromStatus: lease.moveOut.status, toStatus: "SCHEDULED" } } },
      })
      : await tx.moveOut.create({
        data: { organisationId, leaseId, noticeId: lease.noticeToVacate?.id, scheduledDate: data.scheduledDate, responsibleMemberId: data.responsibleMemberId, notes: data.notes, closureRequirements: json(requirements), status: "SCHEDULED", history: { create: { actorUserId: userId, toStatus: "SCHEDULED" } } },
      });
    if (lease.noticeToVacate?.status === "SUBMITTED") {
      await tx.noticeToVacate.update({ where: { id: lease.noticeToVacate.id }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), history: { create: { actorUserId: userId, fromStatus: "SUBMITTED", toStatus: "ACKNOWLEDGED" } } } });
    }
    await record(tx, organisationId, userId, "move_out.scheduled", "move_out", moveOut.id, { leaseId, scheduledDate: data.scheduledDate });
    return moveOut;
  }).then(async (moveOut) => {
    try {
      const dayStart = new Date(moveOut.scheduledDate!);
      await upsertCalendarEvent({
        organisationId, type: "MOVE_OUT", sourceType: "MOVE_OUT", sourceId: moveOut.id,
        title: "Tenant move-out", startAt: dayStart, endAt: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000),
        timezone: "Africa/Accra", actorUserId: userId,
      });
    } catch (error) {
      console.error("Calendar sync failed for move-out scheduling", error);
    }
    return moveOut;
  });
}

export async function createMoveOutInspection(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.moveOutManage);
  const data = moveOutInspectionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const moveOut = await tx.moveOut.findFirst({ where: { leaseId, organisationId }, include: { lease: true } });
    if (!moveOut) throw notFound();
    if (["COMPLETED", "CANCELLED"].includes(moveOut.status)) throw new AppError("MOVE_OUT_LOCKED", 409, "This move-out cannot be changed.");
    const inspector = await tx.organisationMember.findFirst({ where: { id: data.inspectorMemberId, organisationId, status: "ACTIVE", archivedAt: null } });
    if (!inspector) throw new AppError("INVALID_INSPECTOR", 422, "The inspector must be an active organisation member.");
    const inspection = await tx.moveOutInspection.create({
      data: {
        moveOutId: moveOut.id,
        inspectorMemberId: inspector.id,
        inspectedAt: data.inspectedAt,
        overallCondition: data.overallCondition,
        cleaningCondition: data.cleaningCondition,
        notes: data.notes,
        tenantAcknowledged: false,
        tenantAcknowledgedAt: null,
        completedAt: new Date(),
        areas: { create: data.areas.map((area) => ({ ...area, damage: area.damage ? json(area.damage) : undefined, media: area.media ? json(area.media) : undefined })) },
        meterReadings: { create: data.meterReadings.map((reading) => ({ ...reading, value: new Prisma.Decimal(reading.value) })) },
        inventory: { create: data.inventory.map((item) => ({ ...item, metadata: item.metadata ? json(item.metadata) : undefined })) },
      },
      include: { areas: true, meterReadings: true, inventory: true },
    });
    await tx.moveOut.update({ where: { id: moveOut.id }, data: { status: "SETTLEMENT_PENDING", history: { create: { actorUserId: userId, fromStatus: moveOut.status, toStatus: "SETTLEMENT_PENDING" } } } });
    await createSettlementIfNeeded(tx, organisationId, moveOut.id);
    await record(tx, organisationId, userId, "move_out.inspection_completed", "move_out_inspection", inspection.id, { leaseId, moveOutId: moveOut.id });
    return inspection;
  }).then(async (inspection) => {
    try {
      await upsertCalendarEvent({
        organisationId, type: "INSPECTION", sourceType: "MOVE_OUT_INSPECTION", sourceId: inspection.id,
        title: "Move-out inspection", startAt: inspection.inspectedAt, endAt: new Date(inspection.inspectedAt.getTime() + 60 * 60 * 1000),
        timezone: "Africa/Accra", actorUserId: userId,
      });
    } catch (error) {
      console.error("Calendar sync failed for move-out inspection", error);
    }
    return inspection;
  });
}

export async function acknowledgeMoveOutInspection(userId: string, organisationId: string, leaseId: string, inspectionId: string, input: unknown) {
  inspectionAcknowledgementSchema.parse(input);
  const tenant = await leaseTenant(userId, organisationId, leaseId);
  if (!tenant) throw forbidden();
  return db.$transaction(async (tx) => {
    const inspection = await tx.moveOutInspection.findFirst({ where: { id: inspectionId, moveOut: { leaseId, organisationId } } });
    if (!inspection) throw notFound();
    if (!inspection.completedAt) throw new AppError("INSPECTION_NOT_COMPLETE", 409, "Only a completed inspection can be acknowledged.");
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "MoveOutInspection"
      SET "tenantAcknowledged" = true, "tenantAcknowledgedAt" = NOW()
      WHERE "id" = ${inspection.id}::uuid AND "tenantAcknowledged" = false
      RETURNING "id"::text
    `;
    if (!updated.length && !inspection.tenantAcknowledged) throw new AppError("INSPECTION_ACKNOWLEDGEMENT_FAILED", 409, "The inspection could not be acknowledged.");
    await record(tx, organisationId, userId, "move_out.inspection_acknowledged", "move_out_inspection", inspection.id, { leaseId, tenantOrganisationId: tenant.tenantOrganisationId });
    return { ...inspection, tenantAcknowledged: true, tenantAcknowledgedAt: inspection.tenantAcknowledgedAt ?? new Date() };
  });
}

export async function recordKeyReturn(userId: string, organisationId: string, leaseId: string, input: unknown) {
  const member = await requirePermission(userId, organisationId, PERMISSIONS.moveOutManage);
  const data = keyReturnSchema.parse(input);
  return db.$transaction(async (tx) => {
    const moveOut = await tx.moveOut.findFirst({ where: { leaseId, organisationId } });
    if (!moveOut) throw notFound();
    if (moveOut.status === "COMPLETED") throw new AppError("MOVE_OUT_COMPLETED", 409, "A completed move-out cannot be changed.");
    const key = await tx.moveInKeyHandover.findFirst({ where: { id: data.keyHandoverId, moveIn: { leaseId, organisationId } } });
    if (!key) throw notFound();
    if (data.returnedQuantity + data.missingQuantity !== key.quantity) throw new AppError("KEY_RETURN_INCOMPLETE", 422, "Returned and missing quantities must account for every issued item.");
    const updated = await tx.moveInKeyHandover.update({
      where: { id: key.id },
      data: { returnedQuantity: data.returnedQuantity, missingQuantity: data.missingQuantity, returnedAt: data.returnedAt, returnVerifiedById: member.id, returnNotes: data.notes },
    });
    await record(tx, organisationId, userId, "move_out.keys_returned", "move_in_key_handover", key.id, { leaseId, returnedQuantity: data.returnedQuantity, missingQuantity: data.missingQuantity });
    return updated;
  });
}

export async function getConditionComparison(userId: string, organisationId: string, leaseId: string) {
  await requireRead(userId, organisationId, leaseId);
  const lease = await db.lease.findFirst({
    where: { id: leaseId, organisationId },
    include: {
      moveIn: { include: { inspections: { include: { areas: true, meterReadings: true, inventory: true }, orderBy: { inspectedAt: "desc" }, take: 1 }, keyHandovers: true } },
      moveOut: { include: { inspections: { include: { areas: true, meterReadings: true, inventory: true }, orderBy: { inspectedAt: "desc" }, take: 1 } } },
    },
  });
  if (!lease) throw notFound();
  const moveIn = lease.moveIn?.inspections[0];
  const moveOut = lease.moveOut?.inspections[0];
  const compare = <T extends Record<string, unknown>>(before: T[], after: T[], key: (item: T) => string, fields: string[]) => {
    const prior = new Map(before.map((item) => [key(item).toLowerCase(), item]));
    return after.map((item) => {
      const original = prior.get(key(item).toLowerCase());
      const differences = original ? fields.filter((field) => String(original[field]) !== String(item[field])) : fields;
      return { key: key(item), before: original ?? null, after: item, differences, changed: !original || differences.length > 0 };
    });
  };
  return {
    available: Boolean(moveIn && moveOut),
    areas: compare(
      (moveIn?.areas ?? []).map(({ name, condition }) => ({ name, condition })),
      (moveOut?.areas ?? []).map(({ name, condition }) => ({ name, condition })),
      (item) => String(item.name),
      ["condition"],
    ),
    inventory: compare(
      (moveIn?.inventory ?? []).map(({ category, item, quantity, condition }) => ({ category, item, quantity, condition, missing: false })),
      (moveOut?.inventory ?? []).map(({ category, item, quantity, condition, missing }) => ({ category, item, quantity, condition, missing })),
      (item) => `${item.category}:${item.item}`,
      ["quantity", "condition", "missing"],
    ),
    meters: compare(
      (moveIn?.meterReadings ?? []).map(({ type, identifier, value }) => ({ type, identifier, value: value.toString() })),
      (moveOut?.meterReadings ?? []).map(({ type, identifier, value }) => ({ type, identifier, value: value.toString() })),
      (item) => `${item.type}:${item.identifier ?? ""}`,
      ["value"],
    ),
    keys: (lease.moveIn?.keyHandovers ?? []).map((key) => ({ type: key.type, identifier: key.identifier, issued: key.quantity, returned: key.returnedQuantity, missing: key.missingQuantity, changed: key.missingQuantity > 0 })),
  };
}

export async function createDepositDeduction(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.depositSettlementManage);
  const data = deductionSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${leaseId}))::text AS locked`;
    const settlement = await tx.depositSettlement.findFirst({ where: { leaseId, organisationId } });
    if (!settlement) throw notFound();
    if (!["PENDING", "UNDER_REVIEW"].includes(settlement.status)) throw new AppError("SETTLEMENT_LOCKED", 409, "Deductions cannot be added to this settlement.");
    if (data.currencyCode !== settlement.currencyCode) throw new AppError("CURRENCY_MISMATCH", 422, "Deduction currency must match the settlement.");
    if (data.maintenanceRequestId) {
      const request = await tx.maintenanceRequest.findFirst({ where: { id: data.maintenanceRequestId, organisationId, leaseId } });
      if (!request) throw new AppError("INVALID_MAINTENANCE_REFERENCE", 422, "The maintenance request is not linked to this lease.");
    }
    const deduction = await tx.depositDeduction.create({ data: { ...data, organisationId, settlementId: settlement.id, createdByUserId: userId } });
    await record(tx, organisationId, userId, "deposit.deduction_created", "deposit_deduction", deduction.id, { leaseId, amountMinor: deduction.amountMinor.toString(), category: deduction.category });
    return deduction;
  }, serializable);
}

async function distributeDepositChange(
  tx: Tx,
  organisationId: string,
  leaseId: string,
  amount: Prisma.Decimal,
  kind: "DEDUCTION" | "REFUND" | "REVERSAL",
  userId: string,
  settlementId: string,
  deductionId?: string,
  effectiveAt = new Date(),
  refundId?: string,
) {
  const deposits = await tx.securityDeposit.findMany({ where: { organisationId, leaseId }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }] });
  let remaining = amount;
  for (const deposit of deposits) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const available = kind === "REVERSAL"
      ? deposit.deductedAmountMinor
      : deposit.amountMinor.minus(deposit.deductedAmountMinor).minus(deposit.refundedAmountMinor);
    const applied = Prisma.Decimal.min(remaining, available);
    if (applied.lessThanOrEqualTo(0)) continue;
    const deducted = kind === "DEDUCTION" ? deposit.deductedAmountMinor.plus(applied) : kind === "REVERSAL" ? deposit.deductedAmountMinor.minus(applied) : deposit.deductedAmountMinor;
    const refunded = kind === "REFUND" ? deposit.refundedAmountMinor.plus(applied) : deposit.refundedAmountMinor;
    const balance = deposit.amountMinor.minus(deducted).minus(refunded);
    const status = refunded.equals(deposit.amountMinor) ? "REFUNDED" : refunded.greaterThan(0) ? "PARTIALLY_REFUNDED" : deducted.greaterThan(0) ? "PARTIALLY_DEDUCTED" : "HELD";
    await tx.securityDeposit.update({ where: { id: deposit.id }, data: { deductedAmountMinor: deducted, refundedAmountMinor: refunded, status } });
    const type = kind === "DEDUCTION" ? "DEPOSIT_DEDUCTION" : kind === "REFUND" ? "DEPOSIT_REFUND" : "DEPOSIT_ADJUSTMENT";
    const direction = kind === "REVERSAL" ? "CREDIT" : "DEBIT";
    const entry = await tx.financialLedgerEntry.create({
      data: {
        organisationId,
        propertyId: deposit.propertyId,
        unitId: deposit.unitId,
        leaseId,
        securityDepositId: deposit.id,
        depositSettlementId: settlementId,
        depositDeductionId: deductionId,
        depositRefundId: refundId,
        type,
        direction,
        amountMinor: applied,
        currencyCode: deposit.currencyCode,
        effectiveAt,
        reference: `${kind.slice(0, 3)}-${randomUUID()}`,
        description: `${kind.toLowerCase()} deposit settlement entry`,
        createdByUserId: userId,
      },
    });
    await tx.domainEvent.create({ data: { organisationId, name: "ledger.entry_created", aggregateType: "financial_ledger_entry", aggregateId: entry.id, payload: { type, direction, amountMinor: applied.toString(), balanceMinor: balance.toString() } } });
    remaining = remaining.minus(applied);
  }
  if (remaining.greaterThan(0)) throw new AppError("INSUFFICIENT_DEPOSIT_BALANCE", 409, "The deposit balance is insufficient for this transaction.");
}

export async function decideDepositDeduction(userId: string, organisationId: string, leaseId: string, deductionId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.depositSettlementApprove);
  const data = deductionDecisionSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${leaseId}))::text AS locked`;
    const deduction = await tx.depositDeduction.findFirst({ where: { id: deductionId, organisationId, settlement: { leaseId } }, include: { settlement: true } });
    if (!deduction) throw notFound();
    if (deduction.status !== "PENDING") throw new AppError("DEDUCTION_ALREADY_DECIDED", 409, "This deduction has already been decided.");
    if (data.status === "APPROVED") await distributeDepositChange(tx, organisationId, leaseId, deduction.amountMinor, "DEDUCTION", userId, deduction.settlementId, deduction.id);
    const updated = await tx.depositDeduction.update({ where: { id: deduction.id }, data: { status: data.status, decidedByUserId: userId, decisionReason: data.reason, decidedAt: new Date() } });
    await recalculateSettlement(tx, deduction.settlementId);
    await record(tx, organisationId, userId, data.status === "APPROVED" ? "deposit.deduction_approved" : "deposit.deduction_rejected", "deposit_deduction", deduction.id, { leaseId, amountMinor: deduction.amountMinor.toString() });
    return updated;
  }, serializable);
}

export async function reverseDepositDeduction(userId: string, organisationId: string, leaseId: string, deductionId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.depositSettlementApprove);
  const data = deductionReversalSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${leaseId}))::text AS locked`;
    const deduction = await tx.depositDeduction.findFirst({ where: { id: deductionId, organisationId, settlement: { leaseId } }, include: { settlement: true } });
    if (!deduction) throw notFound();
    if (deduction.status !== "APPROVED") throw new AppError("DEDUCTION_NOT_REVERSIBLE", 409, "Only an approved deduction can be reversed.");
    if (deduction.settlement.status !== "UNDER_REVIEW") throw new AppError("SETTLEMENT_LOCKED", 409, "Deductions cannot be reversed after settlement approval.");
    const allocations = await tx.financialLedgerEntry.findMany({
      where: { depositDeductionId: deduction.id, type: "DEPOSIT_DEDUCTION" },
      orderBy: { createdAt: "asc" },
    });
    for (const allocation of allocations) {
      if (!allocation.securityDepositId) throw new AppError("INVALID_DEDUCTION_ALLOCATION", 500, "The deduction allocation is missing its deposit.");
      const deposit = await tx.securityDeposit.findUniqueOrThrow({ where: { id: allocation.securityDepositId } });
      await tx.securityDeposit.update({
        where: { id: deposit.id },
        data: {
          deductedAmountMinor: deposit.deductedAmountMinor.minus(allocation.amountMinor),
          status: deposit.refundedAmountMinor.greaterThan(0) ? "PARTIALLY_REFUNDED" : deposit.deductedAmountMinor.equals(allocation.amountMinor) ? "HELD" : "PARTIALLY_DEDUCTED",
        },
      });
      const entry = await tx.financialLedgerEntry.create({
        data: {
          organisationId,
          propertyId: allocation.propertyId,
          unitId: allocation.unitId,
          leaseId,
          securityDepositId: deposit.id,
          depositSettlementId: deduction.settlementId,
          depositDeductionId: deduction.id,
          type: "DEPOSIT_ADJUSTMENT",
          direction: "CREDIT",
          amountMinor: allocation.amountMinor,
          currencyCode: allocation.currencyCode,
          effectiveAt: new Date(),
          reference: `REV-${randomUUID()}`,
          description: `Reversal of ${allocation.reference}`,
          createdByUserId: userId,
        },
      });
      await tx.domainEvent.create({ data: { organisationId, name: "ledger.entry_created", aggregateType: "financial_ledger_entry", aggregateId: entry.id, payload: { type: entry.type, direction: entry.direction, amountMinor: entry.amountMinor.toString() } } });
    }
    const updated = await tx.depositDeduction.update({ where: { id: deduction.id }, data: { status: "REVERSED", reversedAt: new Date(), reversalReason: data.reason } });
    await recalculateSettlement(tx, deduction.settlementId);
    await record(tx, organisationId, userId, "deposit.deduction_reversed", "deposit_deduction", deduction.id, { leaseId, amountMinor: deduction.amountMinor.toString() });
    return updated;
  }, serializable);
}

export async function approveDepositSettlement(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.depositSettlementApprove);
  const data = settlementApprovalSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${leaseId}))::text AS locked`;
    const settlement = await tx.depositSettlement.findFirst({ where: { leaseId, organisationId }, include: { deductions: true } });
    if (!settlement) throw notFound();
    if (settlement.status !== "UNDER_REVIEW") throw new AppError("SETTLEMENT_NOT_REVIEWABLE", 409, "Only a settlement under review can be approved.");
    if (settlement.deductions.some(({ status }) => status === "PENDING")) throw new AppError("DEDUCTIONS_PENDING", 409, "All deductions must be decided before settlement approval.");
    const calculated = await recalculateSettlement(tx, settlement.id);
    const status = calculated.depositReceivedMinor.equals(0) ? "REFUNDED" : calculated.refundAmountMinor.equals(0) ? "FORFEITED" : "APPROVED";
    const updated = await tx.depositSettlement.update({ where: { id: settlement.id }, data: { status, approvalReason: data.reason, approvedByUserId: userId, approvedAt: new Date() } });
    await tx.moveOut.update({ where: { id: settlement.moveOutId }, data: { status: "READY_TO_CLOSE", history: { create: { actorUserId: userId, fromStatus: "SETTLEMENT_PENDING", toStatus: "READY_TO_CLOSE" } } } });
    await record(tx, organisationId, userId, "deposit.settlement_approved", "deposit_settlement", settlement.id, { leaseId, refundAmountMinor: calculated.refundAmountMinor.toString() });
    return updated;
  }, serializable);
}

export async function recordDepositRefund(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.depositRefundRecord);
  const data = refundSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${leaseId}))::text AS locked`;
    const settlement = await tx.depositSettlement.findFirst({ where: { leaseId, organisationId } });
    if (!settlement) throw notFound();
    const existing = await tx.depositRefund.findUnique({ where: { organisationId_idempotencyKey: { organisationId, idempotencyKey: data.idempotencyKey } } });
    if (existing) {
      if (existing.settlementId !== settlement.id || !existing.amountMinor.equals(data.amountMinor) || existing.reference !== data.reference) {
        throw new AppError("IDEMPOTENCY_CONFLICT", 409, "The idempotency key was already used for a different refund.");
      }
      return existing;
    }
    if (!["APPROVED", "PARTIALLY_REFUNDED"].includes(settlement.status)) throw new AppError("SETTLEMENT_NOT_REFUNDABLE", 409, "The settlement is not approved for refund.");
    const amount = new Prisma.Decimal(data.amountMinor);
    const calculated = await recalculateSettlement(tx, settlement.id);
    const remainingRefund = calculated.refundAmountMinor.minus(calculated.refundedAmountMinor);
    if (amount.greaterThan(remainingRefund)) throw new AppError("REFUND_EXCEEDS_BALANCE", 409, "The refund exceeds the remaining approved amount.");
    const refund = await tx.depositRefund.create({
      data: {
        organisationId,
        settlementId: settlement.id,
        amountMinor: amount,
        currencyCode: settlement.currencyCode,
        reference: data.reference,
        evidenceReference: data.evidenceReference,
        idempotencyKey: data.idempotencyKey,
        recordedByUserId: userId,
        effectiveAt: data.recordedAt ?? new Date(),
      },
    });
    await distributeDepositChange(tx, organisationId, leaseId, amount, "REFUND", userId, settlement.id, undefined, refund.effectiveAt, refund.id);
    const refreshed = await recalculateSettlement(tx, settlement.id);
    const status = refreshed.refundedAmountMinor.greaterThanOrEqualTo(refreshed.refundAmountMinor) ? "REFUNDED" : "PARTIALLY_REFUNDED";
    const updated = await tx.depositSettlement.update({ where: { id: settlement.id }, data: { status, refundReference: data.reference, refundEvidenceReference: data.evidenceReference, refundRecordedByUserId: userId, refundRecordedAt: data.recordedAt ?? new Date() } });
    await record(tx, organisationId, userId, "deposit.refund_recorded", "deposit_settlement", settlement.id, { leaseId, amountMinor: amount.toString(), reference: data.reference });
    return { refund, settlement: updated };
  }, serializable);
}

export async function closeDepositSettlement(userId: string, organisationId: string, leaseId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.depositSettlementApprove);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${leaseId}))::text AS locked`;
    const settlement = await tx.depositSettlement.findFirst({ where: { leaseId, organisationId } });
    if (!settlement) throw notFound();
    if (!["REFUNDED", "FORFEITED"].includes(settlement.status)) throw new AppError("SETTLEMENT_NOT_CLOSABLE", 409, "Only a refunded or validly forfeited settlement can be closed.");
    const updated = await tx.depositSettlement.update({ where: { id: settlement.id }, data: { status: "CLOSED", closedAt: new Date() } });
    await record(tx, organisationId, userId, "deposit.settlement_closed", "deposit_settlement", settlement.id, { leaseId });
    return updated;
  }, serializable);
}

export async function getFinalTenantStatement(userId: string, organisationId: string, leaseId: string) {
  const access = await requireRead(userId, organisationId, leaseId);
  const settlement = await db.depositSettlement.findFirst({
    where: { leaseId, organisationId },
    include: {
      tenantOrganisation: { include: { tenant: true } },
      lease: { include: { property: true, unit: true, moveOut: true } },
      deductions: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!settlement) throw notFound();
  if (!access.internal && settlement.tenantOrganisationId !== access.tenantOrganisationId) throw forbidden();
  return {
    settlementId: settlement.id,
    tenantOrganisationId: settlement.tenantOrganisationId,
    tenant: settlement.tenantOrganisation.tenant,
    lease: { id: settlement.lease.id, referenceNumber: settlement.lease.referenceNumber },
    property: settlement.lease.property,
    unit: settlement.lease.unit,
    moveOutDate: settlement.lease.moveOut?.actualDate ?? settlement.lease.moveOut?.scheduledDate,
    currencyCode: settlement.currencyCode,
    outstandingRentMinor: settlement.outstandingBalanceMinor.toString(),
    depositReceivedMinor: settlement.depositReceivedMinor.toString(),
    deductions: settlement.deductions,
    approvedDeductionMinor: settlement.approvedDeductionMinor.toString(),
    refundAmountMinor: settlement.refundAmountMinor.toString(),
    refundedAmountMinor: settlement.refundedAmountMinor.toString(),
    remainingRefundMinor: Prisma.Decimal.max(zero(), settlement.refundAmountMinor.minus(settlement.refundedAmountMinor)).toString(),
    status: settlement.status,
  };
}

export async function closeLeaseAfterMoveOut(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.leaseClose);
  const data = closeLeaseSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${leaseId}))::text AS locked`;
    const moveOut = await tx.moveOut.findFirst({
      where: { leaseId, organisationId },
      include: { lease: { include: { moveIn: { include: { keyHandovers: true } } } }, inspections: true, depositSettlement: true },
    });
    if (!moveOut) throw notFound();
    if (moveOut.status === "COMPLETED") throw new AppError("MOVE_OUT_COMPLETED", 409, "Move-out is already completed.");
    if (moveOut.status !== "READY_TO_CLOSE") throw new AppError("MOVE_OUT_NOT_READY_TO_CLOSE", 409, "Move-out must complete settlement review before lease closure.");
    const requirements = { ...defaultClosureRequirements(), ...((moveOut.closureRequirements as Record<string, boolean> | null) ?? {}) };
    if (requirements.inspectionRequired && !moveOut.inspections.some(({ completedAt }) => completedAt)) throw new AppError("MOVE_OUT_INSPECTION_REQUIRED", 409, "A completed move-out inspection is required.");
    const keys = moveOut.lease.moveIn?.keyHandovers ?? [];
    if (requirements.keyReturnRequired && keys.some((key) => key.returnedQuantity + key.missingQuantity !== key.quantity)) throw new AppError("KEY_RETURN_REQUIRED", 409, "All issued keys and access devices must be accounted for.");
    if (requirements.settlementRequired && moveOut.depositSettlement?.status !== "CLOSED") throw new AppError("SETTLEMENT_NOT_CLOSED", 409, "The deposit settlement must be closed.");
    const updated = await tx.moveOut.update({ where: { id: moveOut.id }, data: { status: "COMPLETED", actualDate: data.actualMoveOutDate, closedAt: new Date(), history: { create: { actorUserId: userId, fromStatus: moveOut.status, toStatus: "COMPLETED", note: data.note } } } });
    const version = await tx.leaseHistory.aggregate({ where: { leaseId }, _max: { version: true } });
    const leaseStatus = moveOut.lease.status === "EXPIRED" ? "EXPIRED" : "TERMINATED";
    const lease = await tx.lease.update({ where: { id: leaseId }, data: { status: leaseStatus, moveStatus: "MOVED_OUT" } });
    await tx.leaseHistory.create({ data: { leaseId, version: (version._max.version ?? 0) + 1, status: leaseStatus, startDate: lease.startDate, endDate: lease.endDate, rentAmountMinor: lease.rentAmountMinor, currencyCode: lease.currencyCode, rentFrequency: lease.rentFrequency, depositAmountMinor: lease.depositAmountMinor, notes: lease.notes, changedByUserId: userId } });
    if (moveOut.noticeId) await tx.noticeToVacate.update({ where: { id: moveOut.noticeId }, data: { status: "COMPLETED", completedAt: new Date(), history: { create: { actorUserId: userId, fromStatus: "ACKNOWLEDGED", toStatus: "COMPLETED" } } } });
    const turnover = await tx.vacancyTurnover.create({
      data: {
        organisationId,
        moveOutId: moveOut.id,
        propertyId: moveOut.lease.propertyId,
        unitId: moveOut.lease.unitId,
        status: "INSPECTION_REQUIRED",
        tasks: { create: [
          { key: "inspection_review", label: "Review move-out inspection", status: "COMPLETED" },
          { key: "repairs", label: "Complete required repairs", required: false },
          { key: "cleaning", label: "Complete turnover cleaning", required: true },
        ] },
        history: { create: { actorUserId: userId, toStatus: "INSPECTION_REQUIRED" } },
      },
    });
    await record(tx, organisationId, userId, "lease.closed", "lease", leaseId, { moveOutId: moveOut.id });
    await record(tx, organisationId, userId, "vacancy.turnover_started", "vacancy_turnover", turnover.id, { leaseId });
    await record(tx, organisationId, userId, "move_out.completed", "move_out", moveOut.id, { leaseId });
    return updated;
  }, serializable);
}

const turnoverTransitions: Record<string, string[]> = {
  INSPECTION_REQUIRED: ["REPAIRS_REQUIRED", "CLEANING_REQUIRED", "READY_FOR_MARKETING"],
  REPAIRS_REQUIRED: ["CLEANING_REQUIRED", "READY_FOR_MARKETING"],
  CLEANING_REQUIRED: ["READY_FOR_MARKETING"],
  READY_FOR_MARKETING: ["READY_FOR_OCCUPANCY"],
  READY_FOR_OCCUPANCY: ["COMPLETED"],
};

export async function addTurnoverTask(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.moveOutManage);
  const data = turnoverTaskSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${leaseId}))::text AS locked`;
    const turnover = await tx.vacancyTurnover.findFirst({ where: { organisationId, moveOut: { leaseId } } });
    if (!turnover) throw notFound();
    if (["READY_FOR_MARKETING", "READY_FOR_OCCUPANCY", "COMPLETED"].includes(turnover.status)) throw new AppError("TURNOVER_TASKS_LOCKED", 409, "Tasks cannot be added after turnover readiness.");
    if (data.maintenanceRequestId) {
      const request = await tx.maintenanceRequest.findFirst({ where: { id: data.maintenanceRequestId, organisationId, leaseId } });
      if (!request) throw new AppError("INVALID_MAINTENANCE_REFERENCE", 422, "The maintenance request is not linked to this lease.");
    }
    const task = await tx.vacancyTurnoverTask.create({ data: { ...data, turnoverId: turnover.id } });
    await record(tx, organisationId, userId, "vacancy.turnover_task_created", "vacancy_turnover_task", task.id, { leaseId, turnoverId: turnover.id });
    return task;
  });
}

export async function updateTurnoverTask(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.moveOutManage);
  const data = turnoverTaskUpdateSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${leaseId}))::text AS locked`;
    const task = await tx.vacancyTurnoverTask.findFirst({ where: { id: data.taskId, turnover: { organisationId, moveOut: { leaseId } } }, include: { turnover: true } });
    if (!task) throw notFound();
    if (["READY_FOR_MARKETING", "READY_FOR_OCCUPANCY", "COMPLETED"].includes(task.turnover.status)) throw new AppError("TURNOVER_TASKS_LOCKED", 409, "Tasks cannot be changed after turnover readiness.");
    const updated = await tx.vacancyTurnoverTask.update({ where: { id: task.id }, data: { status: data.status, notes: data.notes, completedAt: data.status === "COMPLETED" ? new Date() : null } });
    await record(tx, organisationId, userId, "vacancy.turnover_task_updated", "vacancy_turnover_task", task.id, { leaseId, fromStatus: task.status, toStatus: data.status });
    return updated;
  });
}

export async function transitionVacancyTurnover(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.moveOutManage);
  const data = turnoverTransitionSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${leaseId}))::text AS locked`;
    const turnover = await tx.vacancyTurnover.findFirst({ where: { organisationId, moveOut: { leaseId } }, include: { tasks: true, moveOut: { include: { lease: true } } } });
    if (!turnover) throw notFound();
    if (!turnoverTransitions[turnover.status]?.includes(data.status)) throw new AppError("INVALID_TURNOVER_TRANSITION", 409, `Cannot move turnover from ${turnover.status} to ${data.status}.`);
    if (["READY_FOR_MARKETING", "READY_FOR_OCCUPANCY", "COMPLETED"].includes(data.status) && turnover.tasks.some(({ required, status }) => required && status !== "COMPLETED")) {
      throw new AppError("TURNOVER_TASKS_INCOMPLETE", 409, "Complete required turnover tasks first.");
    }
    if (data.status === "READY_FOR_OCCUPANCY" && turnover.unitId) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${turnover.unitId}))::text AS locked`;
      const competing = await tx.lease.findFirst({ where: { unitId: turnover.unitId, id: { not: turnover.moveOut.leaseId }, status: { in: ["ACTIVE", "EXPIRING"] }, archivedAt: null } });
      if (competing) throw new AppError("UNIT_HAS_ACTIVE_LEASE", 409, "The unit cannot be made available while another active lease exists.");
      const unit = await tx.unit.findUniqueOrThrow({ where: { id: turnover.unitId } });
      if (unit.status === "RESERVED") throw new AppError("UNIT_RESERVED", 409, "A reserved unit cannot be released by turnover.");
      if (unit.status !== "AVAILABLE") await tx.unit.update({ where: { id: turnover.unitId }, data: { status: "AVAILABLE" } });
      await record(tx, organisationId, userId, "unit.available", "unit", turnover.unitId, { leaseId });
    }
    const now = new Date();
    const updated = await tx.vacancyTurnover.update({
      where: { id: turnover.id },
      data: {
        status: data.status,
        relistingReady: ["READY_FOR_MARKETING", "READY_FOR_OCCUPANCY", "COMPLETED"].includes(data.status),
        marketingReadyAt: data.status === "READY_FOR_MARKETING" ? now : turnover.marketingReadyAt,
        occupancyReadyAt: data.status === "READY_FOR_OCCUPANCY" ? now : turnover.occupancyReadyAt,
        completedAt: data.status === "COMPLETED" ? now : turnover.completedAt,
        history: { create: { actorUserId: userId, fromStatus: turnover.status, toStatus: data.status, note: data.note } },
      },
    });
    const eventName = data.status === "READY_FOR_MARKETING" ? "vacancy.ready_for_marketing" : "vacancy.turnover_status_changed";
    await record(tx, organisationId, userId, eventName, "vacancy_turnover", turnover.id, { leaseId, fromStatus: turnover.status, toStatus: data.status });
    return updated;
  });
}

export async function getMoveOut(userId: string, organisationId: string, leaseId: string) {
  const access = await requireRead(userId, organisationId, leaseId);
  const moveOut = await db.moveOut.findFirst({ where: { leaseId, organisationId }, include: moveOutInclude });
  if (!moveOut) throw notFound();
  const comparison = await getConditionComparison(userId, organisationId, leaseId);
  const previousListings = await db.listing.findMany({ where: { organisationId, propertyId: moveOut.lease.propertyId, unitId: moveOut.lease.unitId }, select: { id: true, title: true, status: true, archivedAt: true }, orderBy: { createdAt: "desc" } });
  if (!access.internal) {
    const settlement = moveOut.depositSettlement?.tenantOrganisationId === access.tenantOrganisationId
      ? {
        id: moveOut.depositSettlement.id,
        status: moveOut.depositSettlement.status,
        currencyCode: moveOut.depositSettlement.currencyCode,
        depositReceivedMinor: moveOut.depositSettlement.depositReceivedMinor,
        outstandingBalanceMinor: moveOut.depositSettlement.outstandingBalanceMinor,
        approvedDeductionMinor: moveOut.depositSettlement.approvedDeductionMinor,
        refundAmountMinor: moveOut.depositSettlement.refundAmountMinor,
        refundedAmountMinor: moveOut.depositSettlement.refundedAmountMinor,
        deductions: moveOut.depositSettlement.deductions.map(({ id, category, amountMinor, currencyCode, explanation, status, createdAt }) => ({ id, category, amountMinor, currencyCode, explanation, status, createdAt })),
        ledgerEntries: [],
      }
      : null;
    return {
      id: moveOut.id,
      leaseId: moveOut.leaseId,
      status: moveOut.status,
      scheduledDate: moveOut.scheduledDate,
      actualDate: moveOut.actualDate,
      closedAt: moveOut.closedAt,
      notice: moveOut.notice ? {
        id: moveOut.notice.id,
        noticeDate: moveOut.notice.noticeDate,
        intendedMoveOutDate: moveOut.notice.intendedMoveOutDate,
        source: moveOut.notice.source,
        reason: moveOut.notice.reason,
        status: moveOut.notice.status,
        history: moveOut.notice.history.map(({ fromStatus, toStatus, createdAt }) => ({ fromStatus, toStatus, createdAt })),
      } : null,
      history: [],
      inspections: moveOut.inspections.map(({ id, inspectedAt, overallCondition, cleaningCondition, tenantAcknowledged, completedAt, areas, meterReadings, inventory }) => ({
        id, inspectedAt, overallCondition, cleaningCondition, tenantAcknowledged, completedAt, areas, meterReadings, inventory,
      })),
      depositSettlement: settlement,
      turnover: moveOut.turnover ? { id: moveOut.turnover.id, status: moveOut.turnover.status, relistingReady: moveOut.turnover.relistingReady, tasks: moveOut.turnover.tasks.map(({ id, key, label, status, required }) => ({ id, key, label, status, required })), history: [] } : null,
      lease: {
        id: moveOut.lease.id,
        referenceNumber: moveOut.lease.referenceNumber,
        status: moveOut.lease.status,
        moveStatus: moveOut.lease.moveStatus,
        currencyCode: moveOut.lease.currencyCode,
        property: moveOut.lease.property,
        unit: moveOut.lease.unit,
        parties: [],
        moveIn: moveOut.lease.moveIn ? {
          keyHandovers: moveOut.lease.moveIn.keyHandovers.filter(({ tenantOrganisationId }) => tenantOrganisationId === access.tenantOrganisationId),
          inspections: [],
        } : null,
      },
      comparison,
      previousListings,
      capabilities: { manage: false, approveSettlement: false, recordRefund: false, closeLease: false },
    };
  }
  return {
    ...moveOut,
    comparison,
    previousListings,
    capabilities: {
      manage: true,
      approveSettlement: await hasPermission(userId, organisationId, PERMISSIONS.depositSettlementApprove),
      recordRefund: await hasPermission(userId, organisationId, PERMISSIONS.depositRefundRecord),
      closeLease: await hasPermission(userId, organisationId, PERMISSIONS.leaseClose),
    },
  };
}

async function hasPermission(userId: string, organisationId: string, permission: string) {
  try {
    await requirePermission(userId, organisationId, permission);
    return true;
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "FORBIDDEN") throw error;
    return false;
  }
}
