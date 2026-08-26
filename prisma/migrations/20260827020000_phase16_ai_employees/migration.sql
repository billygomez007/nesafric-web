-- CreateEnum
CREATE TYPE "AIEmployeeRole" AS ENUM ('RECEPTIONIST', 'PROPERTY_MANAGER');

-- CreateEnum
CREATE TYPE "AIEmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AIEmployeeScope" AS ENUM ('ORGANISATION', 'SELECTED');

-- CreateEnum
CREATE TYPE "AIHandoffStatus" AS ENUM ('OPEN', 'ASSIGNED', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "AIEmployee" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AIEmployeeRole" NOT NULL,
    "description" TEXT,
    "status" "AIEmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "scope" "AIEmployeeScope" NOT NULL DEFAULT 'ORGANISATION',
    "responsibilities" JSONB NOT NULL,
    "instructions" JSONB NOT NULL,
    "escalationConfiguration" JSONB NOT NULL,
    "workingHours" JSONB,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "providerKey" TEXT,
    "modelKey" TEXT,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "AIEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIEmployeePortfolio" (
    "aiEmployeeId" UUID NOT NULL,
    "portfolioId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIEmployeePortfolio_pkey" PRIMARY KEY ("aiEmployeeId","portfolioId")
);

-- CreateTable
CREATE TABLE "AIEmployeeProperty" (
    "aiEmployeeId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIEmployeeProperty_pkey" PRIMARY KEY ("aiEmployeeId","propertyId")
);

-- CreateTable
CREATE TABLE "AIEmployeeToolPermission" (
    "aiEmployeeId" UUID NOT NULL,
    "toolKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIEmployeeToolPermission_pkey" PRIMARY KEY ("aiEmployeeId","toolKey")
);

-- CreateTable
CREATE TABLE "AIEmployeeAutonomyPolicy" (
    "aiEmployeeId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIEmployeeAutonomyPolicy_pkey" PRIMARY KEY ("aiEmployeeId","policyId")
);

-- CreateTable
CREATE TABLE "AIEmployeeActivity" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "aiEmployeeId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "actionKey" TEXT,
    "policyDecision" TEXT,
    "reason" TEXT NOT NULL,
    "affectedEntities" JSONB NOT NULL,
    "result" JSONB,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "triggeringUserId" UUID,
    "humanApproverId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AIEmployeeActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIEmployeeHandoff" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "aiEmployeeId" UUID NOT NULL,
    "conversationId" TEXT,
    "operationalItemType" TEXT,
    "operationalItemId" TEXT,
    "reason" TEXT NOT NULL,
    "urgency" "AISeverity" NOT NULL,
    "assignedMemberId" UUID,
    "assignedTeamReference" TEXT,
    "status" "AIHandoffStatus" NOT NULL DEFAULT 'OPEN',
    "contextSummary" TEXT NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AIEmployeeHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIEmployee_organisationId_status_role_idx" ON "AIEmployee"("organisationId", "status", "role");

-- CreateIndex
CREATE UNIQUE INDEX "AIEmployee_organisationId_name_key" ON "AIEmployee"("organisationId", "name");

-- CreateIndex
CREATE INDEX "AIEmployeePortfolio_portfolioId_idx" ON "AIEmployeePortfolio"("portfolioId");

-- CreateIndex
CREATE INDEX "AIEmployeeProperty_propertyId_idx" ON "AIEmployeeProperty"("propertyId");

-- CreateIndex
CREATE INDEX "AIEmployeeToolPermission_toolKey_idx" ON "AIEmployeeToolPermission"("toolKey");

-- CreateIndex
CREATE INDEX "AIEmployeeAutonomyPolicy_policyId_idx" ON "AIEmployeeAutonomyPolicy"("policyId");

-- CreateIndex
CREATE INDEX "AIEmployeeActivity_aiEmployeeId_status_createdAt_idx" ON "AIEmployeeActivity"("aiEmployeeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AIEmployeeActivity_organisationId_createdAt_idx" ON "AIEmployeeActivity"("organisationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIEmployeeActivity_organisationId_idempotencyKey_key" ON "AIEmployeeActivity"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AIEmployeeHandoff_organisationId_status_urgency_idx" ON "AIEmployeeHandoff"("organisationId", "status", "urgency");

-- CreateIndex
CREATE INDEX "AIEmployeeHandoff_aiEmployeeId_createdAt_idx" ON "AIEmployeeHandoff"("aiEmployeeId", "createdAt");

-- AddForeignKey
ALTER TABLE "AIEmployee" ADD CONSTRAINT "AIEmployee_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployee" ADD CONSTRAINT "AIEmployee_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployee" ADD CONSTRAINT "AIEmployee_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeePortfolio" ADD CONSTRAINT "AIEmployeePortfolio_aiEmployeeId_fkey" FOREIGN KEY ("aiEmployeeId") REFERENCES "AIEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeePortfolio" ADD CONSTRAINT "AIEmployeePortfolio_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeeProperty" ADD CONSTRAINT "AIEmployeeProperty_aiEmployeeId_fkey" FOREIGN KEY ("aiEmployeeId") REFERENCES "AIEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeeProperty" ADD CONSTRAINT "AIEmployeeProperty_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeeToolPermission" ADD CONSTRAINT "AIEmployeeToolPermission_aiEmployeeId_fkey" FOREIGN KEY ("aiEmployeeId") REFERENCES "AIEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeeAutonomyPolicy" ADD CONSTRAINT "AIEmployeeAutonomyPolicy_aiEmployeeId_fkey" FOREIGN KEY ("aiEmployeeId") REFERENCES "AIEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeeAutonomyPolicy" ADD CONSTRAINT "AIEmployeeAutonomyPolicy_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AIAutonomyPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeeActivity" ADD CONSTRAINT "AIEmployeeActivity_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeeActivity" ADD CONSTRAINT "AIEmployeeActivity_aiEmployeeId_fkey" FOREIGN KEY ("aiEmployeeId") REFERENCES "AIEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeeHandoff" ADD CONSTRAINT "AIEmployeeHandoff_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeeHandoff" ADD CONSTRAINT "AIEmployeeHandoff_aiEmployeeId_fkey" FOREIGN KEY ("aiEmployeeId") REFERENCES "AIEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeeHandoff" ADD CONSTRAINT "AIEmployeeHandoff_assignedMemberId_fkey" FOREIGN KEY ("assignedMemberId") REFERENCES "OrganisationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEmployeeHandoff" ADD CONSTRAINT "AIEmployeeHandoff_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
