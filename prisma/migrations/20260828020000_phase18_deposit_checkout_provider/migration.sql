-- Phase 18 follow-up: real provider-backed security-deposit checkout. Reuses the existing
-- PaymentIntent/Payment/PaymentReconciliationEvent provider architecture but keeps deposits
-- financially separate from rent: a DEPOSIT-purpose intent never allocates to a RentObligation
-- and never produces a Payment/Receipt. `reconcileProviderEvent` creates or updates the
-- SecurityDeposit only after a verified successful webhook, tagged with `source = PROVIDER`
-- and a DEPOSIT_RECEIPT ledger entry; failed/mismatched/cancelled events never create one.

-- CreateEnum
CREATE TYPE "PaymentIntentPurpose" AS ENUM ('RENT', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "SecurityDepositSource" AS ENUM ('MANUAL', 'PROVIDER');

-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'DEPOSIT_RECEIPT';

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "purpose" "PaymentIntentPurpose" NOT NULL DEFAULT 'RENT';

-- AlterTable
ALTER TABLE "PaymentReconciliationEvent" ADD COLUMN     "securityDepositId" UUID;

-- AlterTable
ALTER TABLE "SecurityDeposit" ADD COLUMN     "paymentIntentId" UUID,
ADD COLUMN     "providerKey" TEXT,
ADD COLUMN     "providerTransactionRef" TEXT,
ADD COLUMN     "source" "SecurityDepositSource" NOT NULL DEFAULT 'MANUAL';

-- CreateIndex
CREATE INDEX "PaymentReconciliationEvent_securityDepositId_idx" ON "PaymentReconciliationEvent"("securityDepositId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityDeposit_paymentIntentId_key" ON "SecurityDeposit"("paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityDeposit_providerKey_providerTransactionRef_key" ON "SecurityDeposit"("providerKey", "providerTransactionRef");

-- AddForeignKey
ALTER TABLE "SecurityDeposit" ADD CONSTRAINT "SecurityDeposit_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReconciliationEvent" ADD CONSTRAINT "PaymentReconciliationEvent_securityDepositId_fkey" FOREIGN KEY ("securityDepositId") REFERENCES "SecurityDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

