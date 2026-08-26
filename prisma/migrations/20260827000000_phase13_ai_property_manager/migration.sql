-- CreateEnum
CREATE TYPE "AISessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "AIMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "AIActionLevel" AS ENUM ('READ', 'RECOMMEND', 'APPROVAL_REQUIRED', 'PROHIBITED_AUTONOMOUS');

-- CreateEnum
CREATE TYPE "AIProposalStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AISession" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT,
    "status" "AISessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "providerKey" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostNano" DECIMAL(19,0),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AISession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIMessage" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID,
    "role" "AIMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "structuredContent" JSONB,
    "providerMessageId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIToolExecution" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "toolKey" TEXT NOT NULL,
    "actionLevel" "AIActionLevel" NOT NULL,
    "requiredPermission" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "result" JSONB,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "recordsAccessed" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AIToolExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIActionProposal" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "toolKey" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actionLevel" "AIActionLevel" NOT NULL,
    "status" "AIProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "requiredPermission" TEXT NOT NULL,
    "decidedByUserId" UUID,
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "executionResult" JSONB,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "executionStartedAt" TIMESTAMP(3),
    "executionCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AISession_organisationId_userId_lastActivityAt_idx" ON "AISession"("organisationId", "userId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "AIMessage_sessionId_createdAt_idx" ON "AIMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AIToolExecution_organisationId_sessionId_startedAt_idx" ON "AIToolExecution"("organisationId", "sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "AIToolExecution_toolKey_status_idx" ON "AIToolExecution"("toolKey", "status");

-- CreateIndex
CREATE INDEX "AIActionProposal_organisationId_status_createdAt_idx" ON "AIActionProposal"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AIActionProposal_sessionId_createdAt_idx" ON "AIActionProposal"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "AISession" ADD CONSTRAINT "AISession_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AISession" ADD CONSTRAINT "AISession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIMessage" ADD CONSTRAINT "AIMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AISession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIMessage" ADD CONSTRAINT "AIMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIToolExecution" ADD CONSTRAINT "AIToolExecution_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIToolExecution" ADD CONSTRAINT "AIToolExecution_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AISession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIToolExecution" ADD CONSTRAINT "AIToolExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIActionProposal" ADD CONSTRAINT "AIActionProposal_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIActionProposal" ADD CONSTRAINT "AIActionProposal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AISession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIActionProposal" ADD CONSTRAINT "AIActionProposal_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIActionProposal" ADD CONSTRAINT "AIActionProposal_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'ai.use', 'Use the organisation-scoped PropertyOS AI workspace'),
  (gen_random_uuid(), 'ai.command_center', 'View cross-domain operational command-center metrics and signals'),
  (gen_random_uuid(), 'ai.propose', 'Create approval-gated AI action proposals'),
  (gen_random_uuid(), 'ai.approve', 'Approve or reject authorised AI action proposals')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role CROSS JOIN "Permission" permission
WHERE
  (role."key" IN ('organisation_owner', 'administrator')
    AND permission."key" IN ('ai.use', 'ai.command_center', 'ai.propose', 'ai.approve'))
  OR (role."key" = 'property_manager'
    AND permission."key" IN ('ai.use', 'ai.command_center', 'ai.propose'))
  OR (role."key" = 'viewer' AND permission."key" = 'ai.use')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
