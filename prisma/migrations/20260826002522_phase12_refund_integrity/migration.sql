-- AlterTable
ALTER TABLE "DepositSettlement" ADD COLUMN     "refundedAmountMinor" DECIMAL(19,0) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FinancialLedgerEntry" ADD COLUMN     "depositRefundId" UUID;

-- CreateTable
CREATE TABLE "DepositRefund" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "amountMinor" DECIMAL(19,0) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "evidenceReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "recordedByUserId" UUID NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DepositRefund_settlementId_createdAt_idx" ON "DepositRefund"("settlementId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DepositRefund_organisationId_idempotencyKey_key" ON "DepositRefund"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "FinancialLedgerEntry_depositRefundId_idx" ON "FinancialLedgerEntry"("depositRefundId");

-- AddForeignKey
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_depositRefundId_fkey" FOREIGN KEY ("depositRefundId") REFERENCES "DepositRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositRefund" ADD CONSTRAINT "DepositRefund_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositRefund" ADD CONSTRAINT "DepositRefund_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "DepositSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositRefund" ADD CONSTRAINT "DepositRefund_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DepositRefund" ADD CONSTRAINT "DepositRefund_amount_check" CHECK ("amountMinor" > 0);
ALTER TABLE "DepositSettlement" DROP CONSTRAINT "DepositSettlement_money_check";
ALTER TABLE "DepositSettlement" ADD CONSTRAINT "DepositSettlement_money_check"
  CHECK ("depositReceivedMinor" >= 0 AND "outstandingBalanceMinor" >= 0 AND "approvedDeductionMinor" >= 0 AND "refundAmountMinor" >= 0 AND "refundedAmountMinor" >= 0);

CREATE FUNCTION prevent_completed_move_out_inspection_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."completedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'completed move-out inspections are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MoveOutInspection_completed_immutable"
  BEFORE UPDATE ON "MoveOutInspection"
  FOR EACH ROW EXECUTE FUNCTION prevent_completed_move_out_inspection_mutation();

CREATE FUNCTION prevent_move_out_inspection_child_mutation() RETURNS trigger AS $$
DECLARE
  parent_completed TIMESTAMP(3);
BEGIN
  SELECT "completedAt" INTO parent_completed FROM "MoveOutInspection" WHERE "id" = OLD."inspectionId";
  IF parent_completed IS NOT NULL THEN
    RAISE EXCEPTION 'completed move-out inspection evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MoveOutInspectionArea_completed_immutable"
  BEFORE UPDATE OR DELETE ON "MoveOutInspectionArea"
  FOR EACH ROW EXECUTE FUNCTION prevent_move_out_inspection_child_mutation();
CREATE TRIGGER "MoveOutMeterReading_completed_immutable"
  BEFORE UPDATE OR DELETE ON "MoveOutMeterReading"
  FOR EACH ROW EXECUTE FUNCTION prevent_move_out_inspection_child_mutation();
CREATE TRIGGER "MoveOutInventoryItem_completed_immutable"
  BEFORE UPDATE OR DELETE ON "MoveOutInventoryItem"
  FOR EACH ROW EXECUTE FUNCTION prevent_move_out_inspection_child_mutation();

CREATE FUNCTION prevent_deposit_refund_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'deposit refund records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DepositRefund_immutable"
  BEFORE UPDATE OR DELETE ON "DepositRefund"
  FOR EACH ROW EXECUTE FUNCTION prevent_deposit_refund_mutation();
