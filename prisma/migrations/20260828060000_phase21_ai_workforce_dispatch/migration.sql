-- CreateEnum
CREATE TYPE "DispatchAttemptStatus" AS ENUM ('CONTACT_PENDING', 'CONTACTED', 'ACCEPTED', 'DECLINED', 'NO_RESPONSE', 'BACKUP_REQUIRED', 'ASSIGNED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AIEmployeeRole" ADD VALUE 'AI_MAINTENANCE_COORDINATOR';
ALTER TYPE "AIEmployeeRole" ADD VALUE 'AI_SALES_RECEPTIONIST';
ALTER TYPE "AIEmployeeRole" ADD VALUE 'AI_SALES_AGENT';
ALTER TYPE "AIEmployeeRole" ADD VALUE 'AI_LEAD_MANAGER';
ALTER TYPE "AIEmployeeRole" ADD VALUE 'AI_LISTING_ASSISTANT';

-- DropIndex
DROP INDEX "ProviderOrganisation_landlordOrganisationId_status_idx";

-- AlterTable
ALTER TABLE "AIEmployeeActivity" ADD COLUMN     "marketplaceProfessionalId" UUID,
ALTER COLUMN "organisationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "AIEmployeeHandoff" ADD COLUMN     "assignedRepresentativeMemberId" UUID,
ADD COLUMN     "marketplaceProfessionalId" UUID,
ALTER COLUMN "organisationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProviderOrganisation" ADD COLUMN     "isBackup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 100;

-- CreateTable
CREATE TABLE "MaintenanceDispatchAttempt" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "maintenanceRequestId" UUID NOT NULL,
    "tier" TEXT NOT NULL,
    "serviceProviderId" UUID,
    "status" "DispatchAttemptStatus" NOT NULL DEFAULT 'CONTACT_PENDING',
    "reason" TEXT,
    "contactedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "initiatedByAIEmployeeId" UUID,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceDispatchAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceDispatchAttempt_organisationId_status_createdAt_idx" ON "MaintenanceDispatchAttempt"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MaintenanceDispatchAttempt_workOrderId_createdAt_idx" ON "MaintenanceDispatchAttempt"("workOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "MaintenanceDispatchAttempt_serviceProviderId_status_idx" ON "MaintenanceDispatchAttempt"("serviceProviderId", "status");

-- CreateIndex
CREATE INDEX "AIEmployeeActivity_marketplaceProfessionalId_createdAt_idx" ON "AIEmployeeActivity"("marketplaceProfessionalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIEmployeeActivity_marketplaceProfessionalId_idempotencyKey_key" ON "AIEmployeeActivity"("marketplaceProfessionalId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AIEmployeeHandoff_marketplaceProfessionalId_status_urgency_idx" ON "AIEmployeeHandoff"("marketplaceProfessionalId", "status", "urgency");

-- CreateIndex
CREATE INDEX "ProviderOrganisation_landlordOrganisationId_status_isBackup_idx" ON "ProviderOrganisation"("landlordOrganisationId", "status", "isBackup", "priority");

-- AddForeignKey
ALTER TABLE "AIEmployeeActivity" ADD CONSTRAINT "AIEmployeeActivity_marketplaceProfessionalId_fkey" FOREIGN KEY ("marketplaceProfessionalId") REFERENCES "MarketplaceProfessional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeeHandoff" ADD CONSTRAINT "AIEmployeeHandoff_marketplaceProfessionalId_fkey" FOREIGN KEY ("marketplaceProfessionalId") REFERENCES "MarketplaceProfessional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeeHandoff" ADD CONSTRAINT "AIEmployeeHandoff_assignedRepresentativeMemberId_fkey" FOREIGN KEY ("assignedRepresentativeMemberId") REFERENCES "MarketplaceProfessionalMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceDispatchAttempt" ADD CONSTRAINT "MaintenanceDispatchAttempt_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceDispatchAttempt" ADD CONSTRAINT "MaintenanceDispatchAttempt_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceDispatchAttempt" ADD CONSTRAINT "MaintenanceDispatchAttempt_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceDispatchAttempt" ADD CONSTRAINT "MaintenanceDispatchAttempt_serviceProviderId_fkey" FOREIGN KEY ("serviceProviderId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceDispatchAttempt" ADD CONSTRAINT "MaintenanceDispatchAttempt_initiatedByAIEmployeeId_fkey" FOREIGN KEY ("initiatedByAIEmployeeId") REFERENCES "AIEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceDispatchAttempt" ADD CONSTRAINT "MaintenanceDispatchAttempt_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "MarketplaceAsset_marketplaceProfessionalId_archivedAt_availabil" RENAME TO "MarketplaceAsset_marketplaceProfessionalId_archivedAt_avail_idx";

