-- CreateEnum
CREATE TYPE "RenewalWorkflowStatus" AS ENUM ('NONE', 'REQUESTED', 'UNDER_DISCUSSION', 'APPROVED', 'DECLINED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RentObligationStatus" AS ENUM ('UPCOMING', 'DUE', 'OVERDUE', 'CANCELLED', 'SATISFIED');

-- CreateEnum
CREATE TYPE "ReminderEventType" AS ENUM ('LEASE_EXPIRY', 'RENT_DUE', 'RENT_OVERDUE', 'DOCUMENT_EXPIRY', 'INSPECTION_DUE', 'MAINTENANCE_FOLLOWUP');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('SCHEDULED', 'SENT', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Lease" ADD COLUMN     "renewalWorkflowStatus" "RenewalWorkflowStatus" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifySms" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TenantOrganisation" ADD COLUMN     "communicationEmailAllowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "communicationInAppAllowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "communicationSmsAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "communicationWhatsappAllowed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LeaseAmendment" (
    "id" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaseAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentObligation" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "unitId" UUID,
    "dueDate" DATE NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amountMinor" DECIMAL(19,0) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "status" "RentObligationStatus" NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderPolicy" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "eventType" "ReminderEventType" NOT NULL,
    "daysOffset" INTEGER NOT NULL,
    "recipientType" TEXT NOT NULL,
    "channels" "NotificationChannel"[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "leaseId" UUID,
    "tenantOrganisationId" UUID,
    "eventType" "ReminderEventType" NOT NULL,
    "thresholdDays" INTEGER,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "providerReference" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaseAmendment_leaseId_sequence_key" ON "LeaseAmendment"("leaseId", "sequence");

-- CreateIndex
CREATE INDEX "RentObligation_organisationId_status_dueDate_idx" ON "RentObligation"("organisationId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "RentObligation_leaseId_periodStart_periodEnd_key" ON "RentObligation"("leaseId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderPolicy_organisationId_eventType_daysOffset_recipien_key" ON "ReminderPolicy"("organisationId", "eventType", "daysOffset", "recipientType");

-- CreateIndex
CREATE INDEX "Notification_organisationId_status_scheduledAt_idx" ON "Notification"("organisationId", "status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_leaseId_tenantOrganisationId_eventType_thresho_key" ON "Notification"("leaseId", "tenantOrganisationId", "eventType", "thresholdDays", "channel");

-- AddForeignKey
ALTER TABLE "LeaseAmendment" ADD CONSTRAINT "LeaseAmendment_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentObligation" ADD CONSTRAINT "RentObligation_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentObligation" ADD CONSTRAINT "RentObligation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentObligation" ADD CONSTRAINT "RentObligation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentObligation" ADD CONSTRAINT "RentObligation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderPolicy" ADD CONSTRAINT "ReminderPolicy_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
