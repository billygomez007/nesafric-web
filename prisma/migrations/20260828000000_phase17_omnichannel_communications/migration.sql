-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('WEB_CHAT', 'EMAIL', 'WHATSAPP', 'SMS', 'IN_APP');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'AI_ACTIVE', 'HUMAN_REQUIRED', 'HUMAN_ACTIVE', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConversationIdentityLevel" AS ENUM ('NONE', 'CLAIMED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "ConversationParticipantType" AS ENUM ('TENANT', 'PROSPECT', 'APPLICANT', 'PROVIDER', 'ORG_MEMBER', 'AI_EMPLOYEE', 'SYSTEM', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "ConversationAssigneeType" AS ENUM ('UNASSIGNED', 'AI_EMPLOYEE', 'ORG_MEMBER');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('TENANT', 'PROSPECT', 'APPLICANT', 'PROVIDER', 'AI_EMPLOYEE', 'ORG_MEMBER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT,
    "channelAddress" TEXT,
    "externalThreadKey" TEXT,
    "identityLevel" "ConversationIdentityLevel" NOT NULL DEFAULT 'NONE',
    "propertyId" UUID,
    "unitId" UUID,
    "leaseId" UUID,
    "tenantOrganisationId" UUID,
    "applicantId" UUID,
    "serviceProviderId" UUID,
    "listingId" UUID,
    "marketplaceLeadId" UUID,
    "maintenanceRequestId" UUID,
    "workOrderId" UUID,
    "assignedAIEmployeeId" UUID,
    "assignedMemberId" UUID,
    "aiSummary" TEXT,
    "webChatTokenHash" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "type" "ConversationParticipantType" NOT NULL,
    "userId" UUID,
    "tenantOrganisationId" UUID,
    "applicantId" UUID,
    "serviceProviderId" UUID,
    "organisationMemberId" UUID,
    "aiEmployeeId" UUID,
    "displayName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "senderType" "MessageSenderType" NOT NULL,
    "senderParticipantId" UUID,
    "aiEmployeeId" UUID,
    "authoredByUserId" UUID,
    "body" TEXT NOT NULL,
    "bodyFormat" TEXT NOT NULL DEFAULT 'TEXT',
    "externalMessageId" TEXT,
    "externalReferenceId" TEXT,
    "metadata" JSONB,
    "containsSensitiveData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageDelivery" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "status" "MessageDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "recipientAddress" TEXT,
    "providerReference" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationAssignment" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "assigneeType" "ConversationAssigneeType" NOT NULL,
    "aiEmployeeId" UUID,
    "organisationMemberId" UUID,
    "reason" TEXT,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationChannelConfig" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "providerKey" TEXT,
    "fromAddress" TEXT,
    "webhookVerifyToken" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationChannelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_webChatTokenHash_key" ON "Conversation"("webChatTokenHash");

-- CreateIndex
CREATE INDEX "Conversation_organisationId_status_updatedAt_idx" ON "Conversation"("organisationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Conversation_organisationId_channel_channelAddress_idx" ON "Conversation"("organisationId", "channel", "channelAddress");

-- CreateIndex
CREATE INDEX "Conversation_organisationId_tenantOrganisationId_idx" ON "Conversation"("organisationId", "tenantOrganisationId");

-- CreateIndex
CREATE INDEX "Conversation_organisationId_marketplaceLeadId_idx" ON "Conversation"("organisationId", "marketplaceLeadId");

-- CreateIndex
CREATE INDEX "Conversation_organisationId_assignedAIEmployeeId_status_idx" ON "Conversation"("organisationId", "assignedAIEmployeeId", "status");

-- CreateIndex
CREATE INDEX "Conversation_organisationId_assignedMemberId_status_idx" ON "Conversation"("organisationId", "assignedMemberId", "status");

-- CreateIndex
CREATE INDEX "Conversation_externalThreadKey_idx" ON "Conversation"("externalThreadKey");

-- CreateIndex
CREATE INDEX "ConversationParticipant_conversationId_idx" ON "ConversationParticipant"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_organisationId_type_idx" ON "ConversationParticipant"("organisationId", "type");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_organisationId_createdAt_idx" ON "Message"("organisationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_organisationId_channel_externalMessageId_key" ON "Message"("organisationId", "channel", "externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDelivery_idempotencyKey_key" ON "MessageDelivery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MessageDelivery_organisationId_status_idx" ON "MessageDelivery"("organisationId", "status");

-- CreateIndex
CREATE INDEX "MessageDelivery_messageId_idx" ON "MessageDelivery"("messageId");

-- CreateIndex
CREATE INDEX "ConversationAssignment_conversationId_createdAt_idx" ON "ConversationAssignment"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationAssignment_organisationId_createdAt_idx" ON "ConversationAssignment"("organisationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationChannelConfig_organisationId_channel_key" ON "CommunicationChannelConfig"("organisationId", "channel");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_serviceProviderId_fkey" FOREIGN KEY ("serviceProviderId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_marketplaceLeadId_fkey" FOREIGN KEY ("marketplaceLeadId") REFERENCES "MarketplaceLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedAIEmployeeId_fkey" FOREIGN KEY ("assignedAIEmployeeId") REFERENCES "AIEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedMemberId_fkey" FOREIGN KEY ("assignedMemberId") REFERENCES "OrganisationMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_authoredByUserId_fkey" FOREIGN KEY ("authoredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationAssignment" ADD CONSTRAINT "ConversationAssignment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationAssignment" ADD CONSTRAINT "ConversationAssignment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationAssignment" ADD CONSTRAINT "ConversationAssignment_organisationMemberId_fkey" FOREIGN KEY ("organisationMemberId") REFERENCES "OrganisationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationAssignment" ADD CONSTRAINT "ConversationAssignment_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationChannelConfig" ADD CONSTRAINT "CommunicationChannelConfig_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

