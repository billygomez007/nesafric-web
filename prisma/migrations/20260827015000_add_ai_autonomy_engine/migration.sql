-- CreateEnum
CREATE TYPE "AIAutonomyLevel" AS ENUM ('DISABLED', 'RECOMMEND_ONLY', 'APPROVAL_REQUIRED', 'AUTO_EXECUTE');

-- CreateEnum
CREATE TYPE "AIActivityType" AS ENUM ('DETECTION', 'RECOMMENDATION', 'PROPOSAL', 'AUTO_EXECUTION', 'ESCALATION', 'POLICY_BLOCKED', 'FAILURE');

-- CreateEnum
CREATE TYPE "AIActivityStatus" AS ENUM ('RECORDED', 'PENDING', 'COMPLETED', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AISeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AIEscalationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "AIAutonomyConfiguration" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "automationPaused" BOOLEAN NOT NULL DEFAULT false,
    "defaultLevel" "AIAutonomyLevel" NOT NULL DEFAULT 'RECOMMEND_ONLY',
    "communicationAllowed" BOOLEAN NOT NULL DEFAULT true,
    "automationActorUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "pausedAt" TIMESTAMP(3),
    "reactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIAutonomyConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAutonomyPolicy" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "actionKey" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "level" "AIAutonomyLevel" NOT NULL,
    "propertyId" UUID,
    "eventType" TEXT,
    "channel" "NotificationChannel",
    "recipientType" TEXT,
    "executionWindowStartMinute" INTEGER,
    "executionWindowEndMinute" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "maxExecutions" INTEGER,
    "frequencyWindowMinutes" INTEGER,
    "escalationAfterMinutes" INTEGER,
    "minSeverity" "AISeverity",
    "maxSeverity" "AISeverity",
    "monetaryThresholdMinor" DECIMAL(19,0),
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIAutonomyPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIActivity" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "policyId" UUID,
    "proposalId" UUID,
    "parentActivityId" UUID,
    "actorUserId" UUID,
    "type" "AIActivityType" NOT NULL,
    "status" "AIActivityStatus" NOT NULL,
    "severity" "AISeverity" NOT NULL,
    "conditionKey" TEXT NOT NULL,
    "actionKey" TEXT,
    "autonomyLevel" "AIAutonomyLevel",
    "policyDecision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "triggeringCondition" JSONB NOT NULL,
    "affectedEntities" JSONB NOT NULL,
    "result" JSONB,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "aiProviderKey" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIEscalation" (
    "id" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "status" "AIEscalationStatus" NOT NULL DEFAULT 'OPEN',
    "level" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AIEscalation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AIAutonomyPolicy"
  ADD CONSTRAINT "AIAutonomyPolicy_execution_window_check"
    CHECK (
      ("executionWindowStartMinute" IS NULL AND "executionWindowEndMinute" IS NULL)
      OR (
        "executionWindowStartMinute" BETWEEN 0 AND 1439
        AND "executionWindowEndMinute" BETWEEN 0 AND 1439
      )
    ),
  ADD CONSTRAINT "AIAutonomyPolicy_frequency_check"
    CHECK (
      ("maxExecutions" IS NULL OR "maxExecutions" > 0)
      AND ("frequencyWindowMinutes" IS NULL OR "frequencyWindowMinutes" > 0)
      AND ("escalationAfterMinutes" IS NULL OR "escalationAfterMinutes" > 0)
    ),
  ADD CONSTRAINT "AIAutonomyPolicy_monetary_threshold_check"
    CHECK ("monetaryThresholdMinor" IS NULL OR "monetaryThresholdMinor" >= 0);

ALTER TABLE "AIEscalation"
  ADD CONSTRAINT "AIEscalation_level_check" CHECK ("level" > 0);

-- CreateIndex
CREATE UNIQUE INDEX "AIAutonomyConfiguration_organisationId_key" ON "AIAutonomyConfiguration"("organisationId");

-- CreateIndex
CREATE INDEX "AIAutonomyConfiguration_enabled_automationPaused_idx" ON "AIAutonomyConfiguration"("enabled", "automationPaused");

-- CreateIndex
CREATE INDEX "AIAutonomyPolicy_organisationId_enabled_actionKey_idx" ON "AIAutonomyPolicy"("organisationId", "enabled", "actionKey");

-- CreateIndex
CREATE INDEX "AIAutonomyPolicy_propertyId_idx" ON "AIAutonomyPolicy"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "AIAutonomyPolicy_organisationId_actionKey_scopeKey_key" ON "AIAutonomyPolicy"("organisationId", "actionKey", "scopeKey");

-- CreateIndex
CREATE INDEX "AIActivity_organisationId_createdAt_idx" ON "AIActivity"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIActivity_organisationId_status_type_idx" ON "AIActivity"("organisationId", "status", "type");

-- CreateIndex
CREATE INDEX "AIActivity_conditionKey_createdAt_idx" ON "AIActivity"("conditionKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIActivity_organisationId_idempotencyKey_key" ON "AIActivity"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AIEscalation_activityId_key" ON "AIEscalation"("activityId");

-- AddForeignKey
ALTER TABLE "AIAutonomyConfiguration" ADD CONSTRAINT "AIAutonomyConfiguration_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAutonomyConfiguration" ADD CONSTRAINT "AIAutonomyConfiguration_automationActorUserId_fkey" FOREIGN KEY ("automationActorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAutonomyConfiguration" ADD CONSTRAINT "AIAutonomyConfiguration_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAutonomyPolicy" ADD CONSTRAINT "AIAutonomyPolicy_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAutonomyPolicy" ADD CONSTRAINT "AIAutonomyPolicy_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAutonomyPolicy" ADD CONSTRAINT "AIAutonomyPolicy_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAutonomyPolicy" ADD CONSTRAINT "AIAutonomyPolicy_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIActivity" ADD CONSTRAINT "AIActivity_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIActivity" ADD CONSTRAINT "AIActivity_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AIAutonomyPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIActivity" ADD CONSTRAINT "AIActivity_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "AIActionProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIActivity" ADD CONSTRAINT "AIActivity_parentActivityId_fkey" FOREIGN KEY ("parentActivityId") REFERENCES "AIActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIActivity" ADD CONSTRAINT "AIActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEscalation" ADD CONSTRAINT "AIEscalation_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "AIActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
