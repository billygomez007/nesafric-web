-- CreateEnum
CREATE TYPE "NoticeToVacateStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'WITHDRAWN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "NoticeToVacateSource" AS ENUM ('TENANT', 'LANDLORD', 'PROPERTY_MANAGER');

-- CreateEnum
CREATE TYPE "MoveOutStatus" AS ENUM ('NOT_STARTED', 'NOTICE_RECEIVED', 'SCHEDULED', 'INSPECTION_PENDING', 'SETTLEMENT_PENDING', 'READY_TO_CLOSE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DepositSettlementStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FORFEITED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DepositDeductionCategory" AS ENUM ('PROPERTY_DAMAGE', 'MISSING_INVENTORY', 'CLEANING', 'UNPAID_RENT', 'UNPAID_APPROVED_CHARGES', 'KEY_REPLACEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DepositDeductionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "VacancyTurnoverStatus" AS ENUM ('INSPECTION_REQUIRED', 'REPAIRS_REQUIRED', 'CLEANING_REQUIRED', 'READY_FOR_MARKETING', 'READY_FOR_OCCUPANCY', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TurnoverTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerEntryType" ADD VALUE 'DEPOSIT_DEDUCTION';
ALTER TYPE "LedgerEntryType" ADD VALUE 'DEPOSIT_REFUND';
ALTER TYPE "LedgerEntryType" ADD VALUE 'DEPOSIT_ADJUSTMENT';

-- AlterTable
ALTER TABLE "FinancialLedgerEntry" ADD COLUMN     "depositDeductionId" UUID,
ADD COLUMN     "depositSettlementId" UUID;

-- AlterTable
ALTER TABLE "MoveInKeyHandover" ADD COLUMN     "missingQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnNotes" TEXT,
ADD COLUMN     "returnVerifiedById" UUID,
ADD COLUMN     "returnedQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "NoticeToVacate" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "tenantOrganisationId" UUID,
    "createdByUserId" UUID NOT NULL,
    "noticeDate" DATE NOT NULL,
    "intendedMoveOutDate" DATE NOT NULL,
    "source" "NoticeToVacateSource" NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "status" "NoticeToVacateStatus" NOT NULL DEFAULT 'SUBMITTED',
    "acknowledgedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoticeToVacate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeToVacateHistory" (
    "id" UUID NOT NULL,
    "noticeId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "fromStatus" "NoticeToVacateStatus",
    "toStatus" "NoticeToVacateStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeToVacateHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveOut" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "noticeId" UUID,
    "status" "MoveOutStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "scheduledDate" DATE,
    "actualDate" DATE,
    "responsibleMemberId" UUID,
    "notes" TEXT,
    "closureRequirements" JSONB,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoveOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveOutHistory" (
    "id" UUID NOT NULL,
    "moveOutId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "fromStatus" "MoveOutStatus",
    "toStatus" "MoveOutStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoveOutHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveOutInspection" (
    "id" UUID NOT NULL,
    "moveOutId" UUID NOT NULL,
    "inspectorMemberId" UUID NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL,
    "overallCondition" TEXT,
    "cleaningCondition" TEXT,
    "notes" TEXT,
    "tenantAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "tenantAcknowledgedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoveOutInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveOutInspectionArea" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "notes" TEXT,
    "damage" JSONB,
    "media" JSONB,

    CONSTRAINT "MoveOutInspectionArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveOutMeterReading" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "identifier" TEXT,
    "value" DECIMAL(19,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "MoveOutMeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveOutInventoryItem" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "condition" TEXT NOT NULL,
    "missing" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "metadata" JSONB,

    CONSTRAINT "MoveOutInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositSettlement" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "moveOutId" UUID NOT NULL,
    "tenantOrganisationId" UUID NOT NULL,
    "status" "DepositSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "currencyCode" CHAR(3) NOT NULL,
    "depositReceivedMinor" DECIMAL(19,0) NOT NULL DEFAULT 0,
    "priorAdjustmentMinor" DECIMAL(19,0) NOT NULL DEFAULT 0,
    "outstandingBalanceMinor" DECIMAL(19,0) NOT NULL DEFAULT 0,
    "approvedDeductionMinor" DECIMAL(19,0) NOT NULL DEFAULT 0,
    "refundAmountMinor" DECIMAL(19,0) NOT NULL DEFAULT 0,
    "approvalReason" TEXT,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "refundReference" TEXT,
    "refundEvidenceReference" TEXT,
    "refundRecordedByUserId" UUID,
    "refundRecordedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositDeduction" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "category" "DepositDeductionCategory" NOT NULL,
    "amountMinor" DECIMAL(19,0) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidenceReference" TEXT,
    "maintenanceRequestId" UUID,
    "status" "DepositDeductionStatus" NOT NULL DEFAULT 'PENDING',
    "createdByUserId" UUID NOT NULL,
    "decidedByUserId" UUID,
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacancyTurnover" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "moveOutId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "unitId" UUID,
    "status" "VacancyTurnoverStatus" NOT NULL DEFAULT 'INSPECTION_REQUIRED',
    "marketingReadyAt" TIMESTAMP(3),
    "occupancyReadyAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "relistingReady" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VacancyTurnover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacancyTurnoverTask" (
    "id" UUID NOT NULL,
    "turnoverId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "TurnoverTaskStatus" NOT NULL DEFAULT 'PENDING',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceRequestId" UUID,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "VacancyTurnoverTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacancyTurnoverHistory" (
    "id" UUID NOT NULL,
    "turnoverId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "fromStatus" "VacancyTurnoverStatus",
    "toStatus" "VacancyTurnoverStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VacancyTurnoverHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NoticeToVacate_leaseId_key" ON "NoticeToVacate"("leaseId");

-- CreateIndex
CREATE INDEX "NoticeToVacate_organisationId_status_intendedMoveOutDate_idx" ON "NoticeToVacate"("organisationId", "status", "intendedMoveOutDate");

-- CreateIndex
CREATE INDEX "NoticeToVacateHistory_noticeId_createdAt_idx" ON "NoticeToVacateHistory"("noticeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MoveOut_leaseId_key" ON "MoveOut"("leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "MoveOut_noticeId_key" ON "MoveOut"("noticeId");

-- CreateIndex
CREATE INDEX "MoveOut_organisationId_status_scheduledDate_idx" ON "MoveOut"("organisationId", "status", "scheduledDate");

-- CreateIndex
CREATE INDEX "MoveOutHistory_moveOutId_createdAt_idx" ON "MoveOutHistory"("moveOutId", "createdAt");

-- CreateIndex
CREATE INDEX "MoveOutInspection_moveOutId_inspectedAt_idx" ON "MoveOutInspection"("moveOutId", "inspectedAt");

-- CreateIndex
CREATE INDEX "MoveOutInspectionArea_inspectionId_idx" ON "MoveOutInspectionArea"("inspectionId");

-- CreateIndex
CREATE INDEX "MoveOutMeterReading_inspectionId_type_idx" ON "MoveOutMeterReading"("inspectionId", "type");

-- CreateIndex
CREATE INDEX "MoveOutInventoryItem_inspectionId_category_idx" ON "MoveOutInventoryItem"("inspectionId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "DepositSettlement_leaseId_key" ON "DepositSettlement"("leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositSettlement_moveOutId_key" ON "DepositSettlement"("moveOutId");

-- CreateIndex
CREATE INDEX "DepositSettlement_organisationId_status_createdAt_idx" ON "DepositSettlement"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DepositDeduction_organisationId_status_createdAt_idx" ON "DepositDeduction"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DepositDeduction_settlementId_status_idx" ON "DepositDeduction"("settlementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VacancyTurnover_moveOutId_key" ON "VacancyTurnover"("moveOutId");

-- CreateIndex
CREATE INDEX "VacancyTurnover_organisationId_status_createdAt_idx" ON "VacancyTurnover"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VacancyTurnover_propertyId_unitId_idx" ON "VacancyTurnover"("propertyId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "VacancyTurnoverTask_turnoverId_key_key" ON "VacancyTurnoverTask"("turnoverId", "key");

-- CreateIndex
CREATE INDEX "VacancyTurnoverHistory_turnoverId_createdAt_idx" ON "VacancyTurnoverHistory"("turnoverId", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialLedgerEntry_depositSettlementId_idx" ON "FinancialLedgerEntry"("depositSettlementId");

-- CreateIndex
CREATE INDEX "FinancialLedgerEntry_depositDeductionId_idx" ON "FinancialLedgerEntry"("depositDeductionId");

-- AddForeignKey
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_depositSettlementId_fkey" FOREIGN KEY ("depositSettlementId") REFERENCES "DepositSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_depositDeductionId_fkey" FOREIGN KEY ("depositDeductionId") REFERENCES "DepositDeduction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveInKeyHandover" ADD CONSTRAINT "MoveInKeyHandover_returnVerifiedById_fkey" FOREIGN KEY ("returnVerifiedById") REFERENCES "OrganisationMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeToVacate" ADD CONSTRAINT "NoticeToVacate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeToVacate" ADD CONSTRAINT "NoticeToVacate_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeToVacate" ADD CONSTRAINT "NoticeToVacate_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeToVacate" ADD CONSTRAINT "NoticeToVacate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeToVacateHistory" ADD CONSTRAINT "NoticeToVacateHistory_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "NoticeToVacate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeToVacateHistory" ADD CONSTRAINT "NoticeToVacateHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveOut" ADD CONSTRAINT "MoveOut_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveOut" ADD CONSTRAINT "MoveOut_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveOut" ADD CONSTRAINT "MoveOut_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "NoticeToVacate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveOut" ADD CONSTRAINT "MoveOut_responsibleMemberId_fkey" FOREIGN KEY ("responsibleMemberId") REFERENCES "OrganisationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveOutHistory" ADD CONSTRAINT "MoveOutHistory_moveOutId_fkey" FOREIGN KEY ("moveOutId") REFERENCES "MoveOut"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveOutHistory" ADD CONSTRAINT "MoveOutHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveOutInspection" ADD CONSTRAINT "MoveOutInspection_moveOutId_fkey" FOREIGN KEY ("moveOutId") REFERENCES "MoveOut"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveOutInspection" ADD CONSTRAINT "MoveOutInspection_inspectorMemberId_fkey" FOREIGN KEY ("inspectorMemberId") REFERENCES "OrganisationMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveOutInspectionArea" ADD CONSTRAINT "MoveOutInspectionArea_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "MoveOutInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveOutMeterReading" ADD CONSTRAINT "MoveOutMeterReading_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "MoveOutInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveOutInventoryItem" ADD CONSTRAINT "MoveOutInventoryItem_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "MoveOutInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositSettlement" ADD CONSTRAINT "DepositSettlement_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositSettlement" ADD CONSTRAINT "DepositSettlement_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositSettlement" ADD CONSTRAINT "DepositSettlement_moveOutId_fkey" FOREIGN KEY ("moveOutId") REFERENCES "MoveOut"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositSettlement" ADD CONSTRAINT "DepositSettlement_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositSettlement" ADD CONSTRAINT "DepositSettlement_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositSettlement" ADD CONSTRAINT "DepositSettlement_refundRecordedByUserId_fkey" FOREIGN KEY ("refundRecordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositDeduction" ADD CONSTRAINT "DepositDeduction_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositDeduction" ADD CONSTRAINT "DepositDeduction_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "DepositSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositDeduction" ADD CONSTRAINT "DepositDeduction_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositDeduction" ADD CONSTRAINT "DepositDeduction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositDeduction" ADD CONSTRAINT "DepositDeduction_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyTurnover" ADD CONSTRAINT "VacancyTurnover_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyTurnover" ADD CONSTRAINT "VacancyTurnover_moveOutId_fkey" FOREIGN KEY ("moveOutId") REFERENCES "MoveOut"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyTurnover" ADD CONSTRAINT "VacancyTurnover_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyTurnover" ADD CONSTRAINT "VacancyTurnover_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyTurnoverTask" ADD CONSTRAINT "VacancyTurnoverTask_turnoverId_fkey" FOREIGN KEY ("turnoverId") REFERENCES "VacancyTurnover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyTurnoverTask" ADD CONSTRAINT "VacancyTurnoverTask_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyTurnoverHistory" ADD CONSTRAINT "VacancyTurnoverHistory_turnoverId_fkey" FOREIGN KEY ("turnoverId") REFERENCES "VacancyTurnover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyTurnoverHistory" ADD CONSTRAINT "VacancyTurnoverHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MoveInKeyHandover" ADD CONSTRAINT "MoveInKeyHandover_return_quantity_check"
  CHECK ("returnedQuantity" >= 0 AND "missingQuantity" >= 0 AND "returnedQuantity" + "missingQuantity" <= "quantity");
ALTER TABLE "MoveOutInventoryItem" ADD CONSTRAINT "MoveOutInventoryItem_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "DepositSettlement" ADD CONSTRAINT "DepositSettlement_money_check"
  CHECK ("depositReceivedMinor" >= 0 AND "outstandingBalanceMinor" >= 0 AND "approvedDeductionMinor" >= 0 AND "refundAmountMinor" >= 0);
ALTER TABLE "DepositDeduction" ADD CONSTRAINT "DepositDeduction_amount_check" CHECK ("amountMinor" > 0);

CREATE FUNCTION prevent_completed_move_out_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'COMPLETED' THEN
    RAISE EXCEPTION 'completed move-out records are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MoveOut_completed_immutable"
  BEFORE UPDATE OR DELETE ON "MoveOut"
  FOR EACH ROW EXECUTE FUNCTION prevent_completed_move_out_mutation();

CREATE FUNCTION prevent_move_out_inspection_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'move-out inspections are permanent';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MoveOutInspection_permanent"
  BEFORE DELETE ON "MoveOutInspection"
  FOR EACH ROW EXECUTE FUNCTION prevent_move_out_inspection_delete();

CREATE FUNCTION prevent_financial_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'financial ledger entries are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FinancialLedgerEntry_immutable"
  BEFORE UPDATE OR DELETE ON "FinancialLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_ledger_mutation();

INSERT INTO "Permission" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'move_out.read', 'View move-out, inspection, settlement, and turnover records'),
  (gen_random_uuid(), 'move_out.manage', 'Manage notices, move-out workflows, inspections, keys, and turnover'),
  (gen_random_uuid(), 'deposit.settlement.manage', 'Create and review deposit settlements and deductions'),
  (gen_random_uuid(), 'deposit.settlement.approve', 'Approve deductions and deposit settlements'),
  (gen_random_uuid(), 'deposit.refund.record', 'Record completed deposit refunds'),
  (gen_random_uuid(), 'lease.close', 'Close leases after move-out requirements are satisfied')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role CROSS JOIN "Permission" permission
WHERE
  (role."key" IN ('organisation_owner', 'administrator')
    AND permission."key" IN ('move_out.read', 'move_out.manage', 'deposit.settlement.manage', 'deposit.settlement.approve', 'deposit.refund.record', 'lease.close'))
  OR (role."key" = 'property_manager'
    AND permission."key" IN ('move_out.read', 'move_out.manage', 'deposit.settlement.manage', 'lease.close'))
  OR (role."key" = 'viewer' AND permission."key" = 'move_out.read')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
