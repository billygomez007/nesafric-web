-- CreateEnum
CREATE TYPE "RecurringChargeType" AS ENUM ('SERVICE_CHARGE', 'WASTE_COLLECTION', 'ELECTRICITY', 'WATER', 'GAS', 'SECURITY', 'CLEANING', 'PARKING', 'INTERNET', 'GENERATOR_FUEL', 'MAINTENANCE_LEVY', 'COMMON_AREA', 'ASSOCIATION_FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "RecurringChargeCalculationType" AS ENUM ('FIXED', 'VARIABLE');

-- CreateEnum
CREATE TYPE "RecurringChargeFrequency" AS ENUM ('ONE_TIME', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RecurringChargeBillingMode" AS ENUM ('SEPARATE', 'INCLUDED_IN_RENT');

-- CreateEnum
CREATE TYPE "RecurringChargeStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "ChargeObligationStatus" AS ENUM ('DRAFT', 'UPCOMING', 'DUE', 'OVERDUE', 'SATISFIED', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChargeCollectionState" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'FULLY_PAID');

-- CreateTable
CREATE TABLE "RecurringChargeDefinition" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "unitId" UUID,
    "type" "RecurringChargeType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "calculationType" "RecurringChargeCalculationType" NOT NULL DEFAULT 'FIXED',
    "amountMinor" DECIMAL(19,0),
    "currencyCode" CHAR(3) NOT NULL,
    "frequency" "RecurringChargeFrequency" NOT NULL,
    "customFrequency" TEXT,
    "billingMode" "RecurringChargeBillingMode" NOT NULL DEFAULT 'SEPARATE',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "dueDay" INTEGER,
    "notifyTenant" BOOLEAN NOT NULL DEFAULT true,
    "reminderDaysBefore" INTEGER,
    "status" "RecurringChargeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "RecurringChargeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeObligation" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "recurringChargeDefinitionId" UUID NOT NULL,
    "tenantOrganisationId" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "unitId" UUID,
    "dueDate" DATE NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amountMinor" DECIMAL(19,0),
    "currencyCode" CHAR(3) NOT NULL,
    "typeSnapshot" "RecurringChargeType" NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "descriptionSnapshot" TEXT,
    "billingModeSnapshot" "RecurringChargeBillingMode" NOT NULL,
    "status" "ChargeObligationStatus" NOT NULL DEFAULT 'UPCOMING',
    "collectionState" "ChargeCollectionState" NOT NULL DEFAULT 'UNPAID',
    "collectedAmountMinor" DECIMAL(19,0) NOT NULL DEFAULT 0,
    "waivedAmountMinor" DECIMAL(19,0) NOT NULL DEFAULT 0,
    "finalisedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargePaymentAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "chargeObligationId" UUID NOT NULL,
    "amountMinor" DECIMAL(19,0) NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),

    CONSTRAINT "ChargePaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringChargeDefinition_organisationId_status_archivedAt_idx" ON "RecurringChargeDefinition"("organisationId", "status", "archivedAt");

-- CreateIndex
CREATE INDEX "RecurringChargeDefinition_leaseId_status_idx" ON "RecurringChargeDefinition"("leaseId", "status");

-- CreateIndex
CREATE INDEX "RecurringChargeDefinition_propertyId_unitId_idx" ON "RecurringChargeDefinition"("propertyId", "unitId");

-- CreateIndex
CREATE INDEX "ChargeObligation_organisationId_status_dueDate_idx" ON "ChargeObligation"("organisationId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "ChargeObligation_leaseId_dueDate_idx" ON "ChargeObligation"("leaseId", "dueDate");

-- CreateIndex
CREATE INDEX "ChargeObligation_tenantOrganisationId_status_dueDate_idx" ON "ChargeObligation"("tenantOrganisationId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "ChargeObligation_propertyId_unitId_idx" ON "ChargeObligation"("propertyId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeObligation_recurringChargeDefinitionId_tenantOrganisa_key" ON "ChargeObligation"("recurringChargeDefinitionId", "tenantOrganisationId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "ChargePaymentAllocation_chargeObligationId_reversedAt_idx" ON "ChargePaymentAllocation"("chargeObligationId", "reversedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChargePaymentAllocation_paymentId_chargeObligationId_key" ON "ChargePaymentAllocation"("paymentId", "chargeObligationId");

-- AddForeignKey
ALTER TABLE "RecurringChargeDefinition" ADD CONSTRAINT "RecurringChargeDefinition_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringChargeDefinition" ADD CONSTRAINT "RecurringChargeDefinition_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringChargeDefinition" ADD CONSTRAINT "RecurringChargeDefinition_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringChargeDefinition" ADD CONSTRAINT "RecurringChargeDefinition_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeObligation" ADD CONSTRAINT "ChargeObligation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeObligation" ADD CONSTRAINT "ChargeObligation_recurringChargeDefinitionId_fkey" FOREIGN KEY ("recurringChargeDefinitionId") REFERENCES "RecurringChargeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeObligation" ADD CONSTRAINT "ChargeObligation_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeObligation" ADD CONSTRAINT "ChargeObligation_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeObligation" ADD CONSTRAINT "ChargeObligation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeObligation" ADD CONSTRAINT "ChargeObligation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargePaymentAllocation" ADD CONSTRAINT "ChargePaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargePaymentAllocation" ADD CONSTRAINT "ChargePaymentAllocation_chargeObligationId_fkey" FOREIGN KEY ("chargeObligationId") REFERENCES "ChargeObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
