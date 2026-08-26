import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createLease } from "./helpers/lease";
import { createSecurityDeposit } from "@/modules/payments/service";
import {
  completeMoveIn,
  createMoveInInspection,
  issueMoveInKeys,
  scheduleMoveIn,
} from "@/modules/lease-execution/service";
import {
  addTurnoverTask,
  acknowledgeMoveOutInspection,
  approveDepositSettlement,
  closeDepositSettlement,
  closeLeaseAfterMoveOut,
  createDepositDeduction,
  createMoveOutInspection,
  createNoticeToVacate,
  decideDepositDeduction,
  getConditionComparison,
  getFinalTenantStatement,
  getMoveOut,
  recordDepositRefund,
  recordKeyReturn,
  reverseDepositDeduction,
  scheduleMoveOut,
  transitionVacancyTurnover,
  updateTurnoverTask,
} from "@/modules/move-out/service";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

async function addMember(organisationId: string, userId: string, roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const member = await db.organisationMember.create({ data: { organisationId, userId } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
  return member;
}

describe("PostgreSQL Phase 12 move-out and settlement", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("controls notice, inspection, settlement, closure, turnover, availability, isolation, RBAC, and events", async () => {
    const owner = await registerUser({ displayName: "Move-out Owner", email: "moveout-owner@example.com", password: "secure-password-123" });
    const tenantUser = await registerUser({ displayName: "Move-out Tenant", email: "moveout-tenant@example.com", password: "secure-password-123" });
    const managerUser = await registerUser({ displayName: "Move-out Manager", email: "moveout-manager@example.com", password: "secure-password-123" });
    const viewerUser = await registerUser({ displayName: "Move-out Viewer", email: "moveout-viewer@example.com", password: "secure-password-123" });
    const outsider = await registerUser({ displayName: "Other Owner", email: "moveout-other@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Move-out Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(outsider.id, { name: "Other Move-out Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const ownerMember = await db.organisationMember.findFirstOrThrow({ where: { organisationId: organisation.id, userId: owner.id } });
    await addMember(organisation.id, managerUser.id, "property_manager");
    await addMember(organisation.id, viewerUser.id, "viewer");
    const property = await createProperty(owner.id, organisation.id, {
      name: "Turnover House",
      referenceNumber: "TURN-001",
      category: "Residential",
      countryCode: "GH",
      currencyCode: "GHS",
      units: [{ name: "A1" }],
    });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const { relationship } = await createTenant(owner.id, organisation.id, {
      legalName: "Move-out Tenant",
      email: "moveout-tenant@example.com",
      countryCode: "GH",
    });
    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });
    const lease = await createLease(owner.id, organisation.id, {
      referenceNumber: "TURN-LEASE-001",
      propertyId: property.id,
      unitId: unit.id,
      tenantOrganisationIds: [relationship.id],
      startDate: "2025-09-01",
      endDate: "2026-08-31",
      rentAmountMinor: "200000",
      currencyCode: "GHS",
      rentFrequency: "MONTHLY",
      depositAmountMinor: "500000",
      status: "ACTIVE",
    });
    await db.unit.update({ where: { id: unit.id }, data: { status: "OCCUPIED" } });
    const previousListing = await db.listing.create({
      data: {
        organisationId: organisation.id,
        propertyId: property.id,
        unitId: unit.id,
        createdByUserId: owner.id,
        listingType: "RENT",
        category: "Residential",
        title: "Previous A1 listing",
        publicDescription: "Previously marketed rental listing retained for turnover readiness history.",
        rentAmountMinor: "200000",
        currencyCode: "GHS",
        frequency: "MONTHLY",
        availableFrom: new Date("2025-09-01"),
        countryCode: "GH",
        status: "ARCHIVED",
        archivedAt: new Date("2025-09-01"),
      },
    });
    await createSecurityDeposit(owner.id, organisation.id, {
      tenantOrganisationId: relationship.id,
      leaseId: lease.id,
      amountMinor: "500000",
      currencyCode: "GHS",
      receivedAt: "2025-08-25",
      method: "BANK_TRANSFER",
      externalReference: "TURN-DEP-001",
      idempotencyKey: "turn-dep-001",
    });
    await scheduleMoveIn(owner.id, organisation.id, lease.id, { scheduledDate: "2025-09-01", responsibleMemberId: ownerMember.id });
    await createMoveInInspection(owner.id, organisation.id, lease.id, {
      inspectorMemberId: ownerMember.id,
      inspectedAt: "2025-09-01T08:00:00Z",
      overallCondition: "GOOD",
      tenantAcknowledged: true,
      areas: [{ name: "Living room", condition: "GOOD" }],
      meterReadings: [{ type: "ELECTRICITY", identifier: "ECG-1", value: "100", unit: "kWh", readAt: "2025-09-01T08:00:00Z" }],
      inventory: [{ category: "APPLIANCE", item: "Fridge", quantity: 1, condition: "GOOD" }],
    });
    const keys = await issueMoveInKeys(owner.id, organisation.id, lease.id, {
      tenantOrganisationId: relationship.id,
      type: "FRONT_DOOR_KEY",
      quantity: 2,
      issuedAt: "2025-09-01T09:00:00Z",
    });
    await completeMoveIn(owner.id, organisation.id, lease.id, { actualDate: "2025-09-01" });

    const notice = await createNoticeToVacate(tenantUser.id, organisation.id, lease.id, {
      noticeDate: "2026-07-01",
      intendedMoveOutDate: "2026-08-20",
      source: "TENANT",
      reason: "Relocating",
    });
    expect(notice).toMatchObject({ status: "SUBMITTED", source: "TENANT", tenantOrganisationId: relationship.id });
    await expect(createNoticeToVacate(viewerUser.id, organisation.id, lease.id, {
      noticeDate: "2026-07-02", intendedMoveOutDate: "2026-08-20", source: "LANDLORD",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const moveOut = await scheduleMoveOut(managerUser.id, organisation.id, lease.id, {
      scheduledDate: "2026-08-20",
      responsibleMemberId: ownerMember.id,
    });
    expect(moveOut.status).toBe("SCHEDULED");
    await expect(closeLeaseAfterMoveOut(managerUser.id, organisation.id, lease.id, { actualMoveOutDate: "2026-08-20" }))
      .rejects.toMatchObject({ code: "MOVE_OUT_NOT_READY_TO_CLOSE" });

    const inspection = await createMoveOutInspection(managerUser.id, organisation.id, lease.id, {
      inspectorMemberId: ownerMember.id,
      inspectedAt: "2026-08-20T08:00:00Z",
      overallCondition: "FAIR",
      cleaningCondition: "CLEANING_REQUIRED",
      tenantAcknowledged: true,
      areas: [{ name: "Living room", condition: "DAMAGED", damage: [{ type: "WALL_SCRATCH" }] }],
      meterReadings: [{ type: "ELECTRICITY", identifier: "ECG-1", value: "450", unit: "kWh", readAt: "2026-08-20T08:00:00Z" }],
      inventory: [{ category: "APPLIANCE", item: "Fridge", quantity: 1, condition: "DAMAGED", missing: false }],
    });
    expect(inspection.completedAt).toBeTruthy();
    await acknowledgeMoveOutInspection(tenantUser.id, organisation.id, lease.id, inspection.id, { acknowledged: true });
    expect((await db.moveOutInspection.findUniqueOrThrow({ where: { id: inspection.id } })).tenantAcknowledged).toBe(true);
    await expect(db.moveOutInspectionArea.update({ where: { id: inspection.areas[0]!.id }, data: { condition: "REWRITTEN" } })).rejects.toBeTruthy();
    const comparison = await getConditionComparison(managerUser.id, organisation.id, lease.id);
    expect(comparison.areas[0]).toMatchObject({ key: "Living room", changed: true });
    expect(comparison.meters[0]).toMatchObject({ changed: true });
    await recordKeyReturn(managerUser.id, organisation.id, lease.id, {
      keyHandoverId: keys.id,
      returnedQuantity: 1,
      missingQuantity: 1,
      returnedAt: "2026-08-20T10:00:00Z",
    });
    expect((await getConditionComparison(managerUser.id, organisation.id, lease.id)).keys[0]).toMatchObject({ returned: 1, missing: 1, changed: true });

    const deduction = await createDepositDeduction(managerUser.id, organisation.id, lease.id, {
      category: "KEY_REPLACEMENT",
      amountMinor: "10000",
      currencyCode: "GHS",
      explanation: "Replacement for one missing front-door key.",
      evidenceReference: "evidence/key-return-001",
    });
    await expect(decideDepositDeduction(managerUser.id, organisation.id, lease.id, deduction.id, { status: "APPROVED", reason: "Verified" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await decideDepositDeduction(owner.id, organisation.id, lease.id, deduction.id, { status: "APPROVED", reason: "Replacement cost verified." });
    expect(await db.financialLedgerEntry.count({ where: { depositDeductionId: deduction.id, type: "DEPOSIT_DEDUCTION" } })).toBe(1);
    const immutableLedger = await db.financialLedgerEntry.findFirstOrThrow({ where: { depositDeductionId: deduction.id, type: "DEPOSIT_DEDUCTION" } });
    await expect(db.financialLedgerEntry.update({ where: { id: immutableLedger.id }, data: { description: "rewritten" } })).rejects.toBeTruthy();
    await reverseDepositDeduction(owner.id, organisation.id, lease.id, deduction.id, { reason: "Replacement key was recovered." });
    expect(await db.financialLedgerEntry.count({ where: { depositDeductionId: deduction.id, type: "DEPOSIT_ADJUSTMENT" } })).toBe(1);
    expect(await db.financialLedgerEntry.count({ where: { depositDeductionId: deduction.id } })).toBe(2);

    const cleaning = await createDepositDeduction(managerUser.id, organisation.id, lease.id, {
      category: "CLEANING",
      amountMinor: "20000",
      currencyCode: "GHS",
      explanation: "Approved deep-cleaning charge.",
    });
    await decideDepositDeduction(owner.id, organisation.id, lease.id, cleaning.id, { status: "APPROVED", reason: "Cleaning condition documented." });
    await approveDepositSettlement(owner.id, organisation.id, lease.id, { reason: "All deductions reviewed." });
    const statement = await getFinalTenantStatement(tenantUser.id, organisation.id, lease.id);
    expect(statement).toMatchObject({ depositReceivedMinor: "500000", approvedDeductionMinor: "20000", refundAmountMinor: "480000", status: "APPROVED" });
    await expect(closeLeaseAfterMoveOut(owner.id, organisation.id, lease.id, { actualMoveOutDate: "2026-08-20" }))
      .rejects.toMatchObject({ code: "SETTLEMENT_NOT_CLOSED" });
    await recordDepositRefund(owner.id, organisation.id, lease.id, { amountMinor: "180000", reference: "MANUAL-REFUND-1", idempotencyKey: "refund-turn-001" });
    await recordDepositRefund(owner.id, organisation.id, lease.id, { amountMinor: "180000", reference: "MANUAL-REFUND-1", idempotencyKey: "refund-turn-001" });
    expect(await db.depositRefund.count({ where: { settlement: { leaseId: lease.id } } })).toBe(1);
    expect((await db.depositSettlement.findUniqueOrThrow({ where: { leaseId: lease.id } })).status).toBe("PARTIALLY_REFUNDED");
    await recordDepositRefund(owner.id, organisation.id, lease.id, { amountMinor: "300000", reference: "MANUAL-REFUND-2", idempotencyKey: "refund-turn-002" });
    expect(await db.financialLedgerEntry.count({ where: { depositSettlement: { leaseId: lease.id }, type: "DEPOSIT_REFUND" } })).toBe(2);
    await closeDepositSettlement(owner.id, organisation.id, lease.id);
    expect(await getFinalTenantStatement(tenantUser.id, organisation.id, lease.id)).toMatchObject({
      refundAmountMinor: "480000",
      refundedAmountMinor: "480000",
      remainingRefundMinor: "0",
      status: "CLOSED",
    });
    await closeLeaseAfterMoveOut(owner.id, organisation.id, lease.id, { actualMoveOutDate: "2026-08-20", note: "Handover and settlement complete." });
    expect(await db.lease.findUniqueOrThrow({ where: { id: lease.id } })).toMatchObject({ status: "TERMINATED", moveStatus: "MOVED_OUT" });
    await expect(scheduleMoveOut(owner.id, organisation.id, lease.id, { scheduledDate: "2026-08-21" }))
      .rejects.toMatchObject({ code: "MOVE_OUT_COMPLETED" });

    const turnoverData = await getMoveOut(owner.id, organisation.id, lease.id);
    expect(turnoverData.turnover).toMatchObject({ status: "INSPECTION_REQUIRED", relistingReady: false });
    expect(turnoverData.previousListings).toContainEqual(expect.objectContaining({ id: previousListing.id, status: "ARCHIVED" }));
    const repairs = await addTurnoverTask(managerUser.id, organisation.id, lease.id, { key: "damage_repair", label: "Repair living-room wall", required: true });
    await expect(transitionVacancyTurnover(managerUser.id, organisation.id, lease.id, { status: "READY_FOR_MARKETING" }))
      .rejects.toMatchObject({ code: "TURNOVER_TASKS_INCOMPLETE" });
    const cleaningTask = await db.vacancyTurnoverTask.findFirstOrThrow({ where: { turnover: { moveOut: { leaseId: lease.id } }, key: "cleaning" } });
    await updateTurnoverTask(managerUser.id, organisation.id, lease.id, { taskId: repairs.id, status: "COMPLETED" });
    await updateTurnoverTask(managerUser.id, organisation.id, lease.id, { taskId: cleaningTask.id, status: "COMPLETED" });
    await transitionVacancyTurnover(managerUser.id, organisation.id, lease.id, { status: "READY_FOR_MARKETING" });
    const marketingReady = await getMoveOut(owner.id, organisation.id, lease.id);
    expect(marketingReady.turnover).toMatchObject({ relistingReady: true });
    expect(marketingReady.previousListings).toContainEqual(expect.objectContaining({ id: previousListing.id, status: "ARCHIVED" }));

    const competing = await createLease(owner.id, organisation.id, {
      referenceNumber: "TURN-LEASE-002",
      propertyId: property.id,
      unitId: unit.id,
      tenantOrganisationIds: [relationship.id],
      startDate: "2026-09-01",
      rentAmountMinor: "210000",
      currencyCode: "GHS",
      rentFrequency: "MONTHLY",
      status: "ACTIVE",
    });
    await expect(transitionVacancyTurnover(managerUser.id, organisation.id, lease.id, { status: "READY_FOR_OCCUPANCY" }))
      .rejects.toMatchObject({ code: "UNIT_HAS_ACTIVE_LEASE" });
    expect((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).status).toBe("OCCUPIED");
    await db.lease.update({ where: { id: competing.id }, data: { status: "TERMINATED" } });
    await transitionVacancyTurnover(managerUser.id, organisation.id, lease.id, { status: "READY_FOR_OCCUPANCY" });
    await transitionVacancyTurnover(managerUser.id, organisation.id, lease.id, { status: "COMPLETED" });
    expect((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).status).toBe("AVAILABLE");

    await expect(getMoveOut(outsider.id, otherOrganisation.id, lease.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const eventName of [
      "tenancy.notice_given",
      "move_out.scheduled",
      "move_out.inspection_completed",
      "move_out.keys_returned",
      "deposit.deduction_created",
      "deposit.deduction_approved",
      "deposit.settlement_approved",
      "deposit.refund_recorded",
      "lease.closed",
      "vacancy.turnover_started",
      "vacancy.ready_for_marketing",
      "unit.available",
      "move_out.completed",
    ]) {
      expect(await db.domainEvent.count({ where: { organisationId: organisation.id, name: eventName } }), eventName).toBeGreaterThan(0);
      expect(await db.auditEvent.count({ where: { organisationId: organisation.id, action: eventName } }), eventName).toBeGreaterThan(0);
    }
  });
});
