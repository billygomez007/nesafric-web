-- CreateEnum
CREATE TYPE "WhatsAppInboundStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "WhatsAppOutboundStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WhatsAppSupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "sourceChannel" TEXT;

-- AlterTable
ALTER TABLE "MarketplaceProfessional" ADD COLUMN     "sourceChannel" TEXT;

-- AlterTable
ALTER TABLE "ServiceProvider" ADD COLUMN     "sourceChannel" TEXT;

-- CreateTable
CREATE TABLE "WhatsAppContact" (
    "id" UUID NOT NULL,
    "waId" TEXT NOT NULL,
    "phoneE164" TEXT,
    "profileName" TEXT,
    "userId" UUID,
    "lastInboundAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppInboundMessage" (
    "id" UUID NOT NULL,
    "waMessageId" TEXT NOT NULL,
    "contactId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "content" JSONB NOT NULL,
    "status" "WhatsAppInboundStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "redactedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppInboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppOutboundMessage" (
    "id" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WhatsAppOutboundStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppOutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppAssistantSession" (
    "id" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "workflow" TEXT,
    "step" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedWorkflows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAssistantSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppAction" (
    "id" UUID NOT NULL,
    "actionKey" TEXT NOT NULL,
    "contactId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppSupportRequest" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "contactId" UUID NOT NULL,
    "userId" UUID,
    "topic" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "workflow" TEXT,
    "status" "WhatsAppSupportStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "resolvedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppSupportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppAssistantEvent" (
    "id" UUID NOT NULL,
    "contactId" UUID,
    "name" TEXT NOT NULL,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppAssistantEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppContact_waId_key" ON "WhatsAppContact"("waId");

-- CreateIndex
CREATE INDEX "WhatsAppContact_userId_idx" ON "WhatsAppContact"("userId");

-- CreateIndex
CREATE INDEX "WhatsAppContact_phoneE164_idx" ON "WhatsAppContact"("phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppInboundMessage_waMessageId_key" ON "WhatsAppInboundMessage"("waMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppInboundMessage_contactId_status_sentAt_idx" ON "WhatsAppInboundMessage"("contactId", "status", "sentAt");

-- CreateIndex
CREATE INDEX "WhatsAppInboundMessage_status_receivedAt_idx" ON "WhatsAppInboundMessage"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppOutboundMessage_idempotencyKey_key" ON "WhatsAppOutboundMessage"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppOutboundMessage_providerMessageId_key" ON "WhatsAppOutboundMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppOutboundMessage_contactId_createdAt_idx" ON "WhatsAppOutboundMessage"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppOutboundMessage_status_createdAt_idx" ON "WhatsAppOutboundMessage"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAssistantSession_contactId_key" ON "WhatsAppAssistantSession"("contactId");

-- CreateIndex
CREATE INDEX "WhatsAppAssistantSession_workflow_lastActivityAt_idx" ON "WhatsAppAssistantSession"("workflow", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAction_actionKey_key" ON "WhatsAppAction"("actionKey");

-- CreateIndex
CREATE INDEX "WhatsAppAction_contactId_kind_createdAt_idx" ON "WhatsAppAction"("contactId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppAction_createdAt_idx" ON "WhatsAppAction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSupportRequest_reference_key" ON "WhatsAppSupportRequest"("reference");

-- CreateIndex
CREATE INDEX "WhatsAppSupportRequest_status_createdAt_idx" ON "WhatsAppSupportRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppAssistantEvent_name_createdAt_idx" ON "WhatsAppAssistantEvent"("name", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppAssistantEvent_createdAt_idx" ON "WhatsAppAssistantEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "WhatsAppContact" ADD CONSTRAINT "WhatsAppContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppInboundMessage" ADD CONSTRAINT "WhatsAppInboundMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "WhatsAppContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppOutboundMessage" ADD CONSTRAINT "WhatsAppOutboundMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "WhatsAppContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppAssistantSession" ADD CONSTRAINT "WhatsAppAssistantSession_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "WhatsAppContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSupportRequest" ADD CONSTRAINT "WhatsAppSupportRequest_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "WhatsAppContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
