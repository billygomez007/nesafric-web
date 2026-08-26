CREATE TYPE "RentCollectionState" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'FULLY_PAID');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD');
CREATE TYPE "PaymentSource" AS ENUM ('MANUAL', 'PROVIDER');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REVERSED');
CREATE TYPE "ReconciliationStatus" AS ENUM ('UNMATCHED', 'PENDING', 'MATCHED', 'MISMATCHED', 'DUPLICATE');
CREATE TYPE "ReceiptStatus" AS ENUM ('ISSUED', 'VOIDED');
CREATE TYPE "SecurityDepositStatus" AS ENUM ('HELD', 'PARTIALLY_REFUNDED', 'REFUNDED', 'PARTIALLY_DEDUCTED', 'APPLIED');
CREATE TYPE "LedgerEntryType" AS ENUM ('RENT_CHARGE', 'RENT_PAYMENT', 'DEPOSIT_RECEIVED', 'PAYMENT_REVERSAL', 'MANUAL_ADJUSTMENT');
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

ALTER TABLE "RentObligation"
  ADD COLUMN "collectionState" "RentCollectionState" NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN "collectedAmountMinor" DECIMAL(19,0) NOT NULL DEFAULT 0;

CREATE TABLE "PaymentIntent" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "tenantOrganisationId" UUID NOT NULL,
  "leaseId" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "unitId" UUID,
  "internalReference" TEXT NOT NULL,
  "amountMinor" DECIMAL(19,0) NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "providerKey" TEXT NOT NULL,
  "providerIntentRef" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "providerPayload" JSONB,
  "expiresAt" TIMESTAMP(3),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentIntent_amount_positive" CHECK ("amountMinor" > 0)
);

CREATE TABLE "Payment" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "paymentIntentId" UUID,
  "tenantOrganisationId" UUID NOT NULL,
  "leaseId" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "unitId" UUID,
  "internalReference" TEXT NOT NULL,
  "amountMinor" DECIMAL(19,0) NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "source" "PaymentSource" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paidAt" TIMESTAMP(3) NOT NULL,
  "externalReference" TEXT NOT NULL,
  "evidenceReference" TEXT,
  "providerKey" TEXT,
  "providerTransactionRef" TEXT,
  "idempotencyKey" TEXT,
  "reconciliationStatus" "ReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
  "failureReason" TEXT,
  "createdByUserId" UUID,
  "confirmedAt" TIMESTAMP(3),
  "reversedAt" TIMESTAMP(3),
  "reversedByUserId" UUID,
  "reversalReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Payment_amount_positive" CHECK ("amountMinor" > 0),
  CONSTRAINT "Payment_source_provider" CHECK (
    ("source" = 'MANUAL' AND "createdByUserId" IS NOT NULL)
    OR ("source" = 'PROVIDER' AND "providerKey" IS NOT NULL)
  )
);

CREATE TABLE "PaymentAllocation" (
  "id" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "rentObligationId" UUID NOT NULL,
  "amountMinor" DECIMAL(19,0) NOT NULL,
  "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversedAt" TIMESTAMP(3),
  CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentAllocation_amount_positive" CHECK ("amountMinor" > 0)
);

CREATE TABLE "Receipt" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "tenantOrganisationId" UUID NOT NULL,
  "leaseId" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "unitId" UUID,
  "receiptNumber" TEXT NOT NULL,
  "amountMinor" DECIMAL(19,0) NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "status" "ReceiptStatus" NOT NULL DEFAULT 'ISSUED',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt" TIMESTAMP(3),
  CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SecurityDeposit" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "tenantOrganisationId" UUID NOT NULL,
  "leaseId" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "unitId" UUID,
  "internalReference" TEXT NOT NULL,
  "amountMinor" DECIMAL(19,0) NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "externalReference" TEXT NOT NULL,
  "evidenceReference" TEXT,
  "status" "SecurityDepositStatus" NOT NULL DEFAULT 'HELD',
  "refundedAmountMinor" DECIMAL(19,0) NOT NULL DEFAULT 0,
  "deductedAmountMinor" DECIMAL(19,0) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "recordedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecurityDeposit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SecurityDeposit_amounts_valid" CHECK (
    "amountMinor" > 0 AND "refundedAmountMinor" >= 0 AND "deductedAmountMinor" >= 0
    AND "refundedAmountMinor" + "deductedAmountMinor" <= "amountMinor"
  )
);

CREATE TABLE "FinancialLedgerEntry" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "unitId" UUID,
  "leaseId" UUID,
  "rentObligationId" UUID,
  "paymentId" UUID,
  "securityDepositId" UUID,
  "type" "LedgerEntryType" NOT NULL,
  "direction" "LedgerDirection" NOT NULL,
  "amountMinor" DECIMAL(19,0) NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "reference" TEXT NOT NULL,
  "description" TEXT,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialLedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialLedgerEntry_amount_positive" CHECK ("amountMinor" > 0)
);

CREATE TABLE "PaymentReconciliationEvent" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "paymentId" UUID,
  "providerKey" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "transactionRef" TEXT,
  "status" "ReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "PaymentReconciliationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentIntent_organisationId_internalReference_key" ON "PaymentIntent"("organisationId", "internalReference");
CREATE UNIQUE INDEX "PaymentIntent_organisationId_idempotencyKey_key" ON "PaymentIntent"("organisationId", "idempotencyKey");
CREATE UNIQUE INDEX "PaymentIntent_providerKey_providerIntentRef_key" ON "PaymentIntent"("providerKey", "providerIntentRef");
CREATE INDEX "PaymentIntent_organisationId_status_createdAt_idx" ON "PaymentIntent"("organisationId", "status", "createdAt");
CREATE UNIQUE INDEX "Payment_organisationId_internalReference_key" ON "Payment"("organisationId", "internalReference");
CREATE UNIQUE INDEX "Payment_organisationId_idempotencyKey_key" ON "Payment"("organisationId", "idempotencyKey");
CREATE UNIQUE INDEX "Payment_providerKey_providerTransactionRef_key" ON "Payment"("providerKey", "providerTransactionRef");
CREATE INDEX "Payment_organisationId_status_paidAt_idx" ON "Payment"("organisationId", "status", "paidAt");
CREATE INDEX "Payment_organisationId_leaseId_paidAt_idx" ON "Payment"("organisationId", "leaseId", "paidAt");
CREATE INDEX "Payment_organisationId_tenantOrganisationId_paidAt_idx" ON "Payment"("organisationId", "tenantOrganisationId", "paidAt");
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_rentObligationId_key" ON "PaymentAllocation"("paymentId", "rentObligationId");
CREATE INDEX "PaymentAllocation_rentObligationId_reversedAt_idx" ON "PaymentAllocation"("rentObligationId", "reversedAt");
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");
CREATE UNIQUE INDEX "Receipt_receiptNumber_key" ON "Receipt"("receiptNumber");
CREATE INDEX "Receipt_organisationId_issuedAt_idx" ON "Receipt"("organisationId", "issuedAt");
CREATE UNIQUE INDEX "SecurityDeposit_organisationId_internalReference_key" ON "SecurityDeposit"("organisationId", "internalReference");
CREATE INDEX "SecurityDeposit_organisationId_leaseId_receivedAt_idx" ON "SecurityDeposit"("organisationId", "leaseId", "receivedAt");
CREATE INDEX "FinancialLedgerEntry_organisationId_propertyId_effectiveAt_idx" ON "FinancialLedgerEntry"("organisationId", "propertyId", "effectiveAt");
CREATE INDEX "FinancialLedgerEntry_paymentId_idx" ON "FinancialLedgerEntry"("paymentId");
CREATE INDEX "FinancialLedgerEntry_securityDepositId_idx" ON "FinancialLedgerEntry"("securityDepositId");
CREATE UNIQUE INDEX "FinancialLedgerEntry_rentObligationId_type_key" ON "FinancialLedgerEntry"("rentObligationId", "type");
CREATE UNIQUE INDEX "PaymentReconciliationEvent_providerKey_eventKey_key" ON "PaymentReconciliationEvent"("providerKey", "eventKey");
CREATE INDEX "PaymentReconciliationEvent_organisationId_receivedAt_idx" ON "PaymentReconciliationEvent"("organisationId", "receivedAt");

ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_rentObligationId_fkey" FOREIGN KEY ("rentObligationId") REFERENCES "RentObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecurityDeposit" ADD CONSTRAINT "SecurityDeposit_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecurityDeposit" ADD CONSTRAINT "SecurityDeposit_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecurityDeposit" ADD CONSTRAINT "SecurityDeposit_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecurityDeposit" ADD CONSTRAINT "SecurityDeposit_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecurityDeposit" ADD CONSTRAINT "SecurityDeposit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_rentObligationId_fkey" FOREIGN KEY ("rentObligationId") REFERENCES "RentObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_securityDepositId_fkey" FOREIGN KEY ("securityDepositId") REFERENCES "SecurityDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReconciliationEvent" ADD CONSTRAINT "PaymentReconciliationEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReconciliationEvent" ADD CONSTRAINT "PaymentReconciliationEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
