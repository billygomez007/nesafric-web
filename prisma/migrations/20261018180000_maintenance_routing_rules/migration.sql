-- Deterministic maintenance routing rules, dispatch attempts, decisions and escalations.
-- CreateEnum
CREATE TYPE "RoutingAuthorizationMode" AS ENUM ('PRE_AUTHORIZED', 'INSPECTION_ONLY', 'QUOTE_REQUIRED', 'APPROVAL_REQUIRED', 'ESCALATE');

-- CreateEnum
CREATE TYPE "EscalationLevel" AS ENUM ('ATTENTION', 'CRITICAL');

-- AlterEnum
ALTER TYPE "DispatchAttemptStatus" ADD VALUE 'CONTACT_FAILED';

-- AlterTable
ALTER TABLE "MaintenanceDispatchAttempt" ADD COLUMN     "attemptNumber" INTEGER,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "messageId" UUID,
ADD COLUMN     "providerAssignmentId" UUID,
ADD COLUMN     "providerOrganisationId" UUID,
ADD COLUMN     "routingRuleId" UUID;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "authorizationMode" "RoutingAuthorizationMode",
ADD COLUMN     "authorizedSpendMinor" BIGINT,
ADD COLUMN     "routingRuleId" UUID;

-- CreateTable
CREATE TABLE "MaintenanceRoutingRule" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "propertyId" UUID,
    "unitId" UUID,
    "category" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priorities" "MaintenancePriority"[] DEFAULT ARRAY[]::"MaintenancePriority"[],
    "primaryProviderOrganisationId" UUID,
    "backupProviderOrganisationIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "autoDispatch" BOOLEAN NOT NULL DEFAULT true,
    "authorizationMode" "RoutingAuthorizationMode" NOT NULL DEFAULT 'QUOTE_REQUIRED',
    "spendingCapMinor" BIGINT,
    "responseTimeoutMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "escalationMemberId" UUID,
    "notifyTenant" BOOLEAN NOT NULL DEFAULT true,
    "requireCompletionVerification" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceRoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRoutingDecision" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "maintenanceRequestId" UUID NOT NULL,
    "routingRuleId" UUID,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceRoutingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceEscalation" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "maintenanceRequestId" UUID NOT NULL,
    "level" "EscalationLevel" NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "recipientMemberId" UUID,
    "dedupeKey" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceRoutingRule_organisationId_category_archivedAt_idx" ON "MaintenanceRoutingRule"("organisationId", "category", "archivedAt");

-- CreateIndex
CREATE INDEX "MaintenanceRoutingDecision_maintenanceRequestId_createdAt_idx" ON "MaintenanceRoutingDecision"("maintenanceRequestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceEscalation_dedupeKey_key" ON "MaintenanceEscalation"("dedupeKey");

-- CreateIndex
CREATE INDEX "MaintenanceEscalation_organisationId_resolvedAt_createdAt_idx" ON "MaintenanceEscalation"("organisationId", "resolvedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceDispatchAttempt_workOrderId_attemptNumber_key" ON "MaintenanceDispatchAttempt"("workOrderId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "MaintenanceRoutingRule" ADD CONSTRAINT "MaintenanceRoutingRule_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRoutingRule" ADD CONSTRAINT "MaintenanceRoutingRule_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRoutingRule" ADD CONSTRAINT "MaintenanceRoutingRule_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRoutingRule" ADD CONSTRAINT "MaintenanceRoutingRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRoutingDecision" ADD CONSTRAINT "MaintenanceRoutingDecision_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRoutingDecision" ADD CONSTRAINT "MaintenanceRoutingDecision_routingRuleId_fkey" FOREIGN KEY ("routingRuleId") REFERENCES "MaintenanceRoutingRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceEscalation" ADD CONSTRAINT "MaintenanceEscalation_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
