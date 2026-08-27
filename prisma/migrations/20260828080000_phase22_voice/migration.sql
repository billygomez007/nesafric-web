-- CreateEnum
CREATE TYPE "VoiceCallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "VoiceCallStatus" AS ENUM ('QUEUED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'NO_ANSWER', 'BUSY', 'CANCELED');

-- CreateEnum
CREATE TYPE "VoiceCallOutcome" AS ENUM ('NONE', 'INFORMATION_PROVIDED', 'LEAD_CAPTURED', 'VIEWING_SCHEDULED', 'MAINTENANCE_REQUEST_CREATED', 'ARTISAN_ACCEPTED', 'ARTISAN_DECLINED', 'ARTISAN_NO_RESPONSE', 'HANDED_OFF_TO_HUMAN', 'NO_ACTION', 'FAILED');

-- CreateEnum
CREATE TYPE "VoiceConsentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'GRANTED', 'DECLINED');

-- AlterEnum
ALTER TYPE "ConversationChannel" ADD VALUE 'VOICE';

-- CreateTable
CREATE TABLE "VoiceProviderConfig" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "providerKey" TEXT NOT NULL DEFAULT 'MOCK',
    "phoneNumber" TEXT,
    "inboundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "outboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "businessHoursStart" TEXT NOT NULL DEFAULT '08:00',
    "businessHoursEnd" TEXT NOT NULL DEFAULT '18:00',
    "maxRetryAttempts" INTEGER NOT NULL DEFAULT 2,
    "retryDelaySeconds" INTEGER NOT NULL DEFAULT 900,
    "maxOutboundCallsPerDay" INTEGER NOT NULL DEFAULT 50,
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "consentRequired" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceCall" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "aiEmployeeId" UUID,
    "direction" "VoiceCallDirection" NOT NULL,
    "status" "VoiceCallStatus" NOT NULL DEFAULT 'QUEUED',
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "providerCallId" TEXT NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ringingAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "recordingUrl" TEXT,
    "recordingConsentStatus" "VoiceConsentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "transcriptText" TEXT,
    "aiSummary" TEXT,
    "outcome" "VoiceCallOutcome" NOT NULL DEFAULT 'NONE',
    "handoffId" UUID,
    "callerIdentityLevel" "ConversationIdentityLevel" NOT NULL DEFAULT 'NONE',
    "initiatedByUserId" UUID,
    "dispatchAttemptId" UUID,
    "retryOfCallId" UUID,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceCallEvent" (
    "id" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "providerKey" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceCallEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceContactPreference" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "doNotCall" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceContactPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceProviderConfig_organisationId_key" ON "VoiceProviderConfig"("organisationId");

-- CreateIndex
CREATE INDEX "VoiceCall_organisationId_status_createdAt_idx" ON "VoiceCall"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VoiceCall_organisationId_direction_createdAt_idx" ON "VoiceCall"("organisationId", "direction", "createdAt");

-- CreateIndex
CREATE INDEX "VoiceCall_conversationId_idx" ON "VoiceCall"("conversationId");

-- CreateIndex
CREATE INDEX "VoiceCall_dispatchAttemptId_idx" ON "VoiceCall"("dispatchAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceCall_providerKey_providerCallId_key" ON "VoiceCall"("providerKey", "providerCallId");

-- CreateIndex
CREATE INDEX "VoiceCallEvent_callId_occurredAt_idx" ON "VoiceCallEvent"("callId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceCallEvent_providerKey_externalEventId_key" ON "VoiceCallEvent"("providerKey", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceContactPreference_organisationId_phoneNumber_key" ON "VoiceContactPreference"("organisationId", "phoneNumber");

-- AddForeignKey
ALTER TABLE "VoiceProviderConfig" ADD CONSTRAINT "VoiceProviderConfig_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_aiEmployeeId_fkey" FOREIGN KEY ("aiEmployeeId") REFERENCES "AIEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_handoffId_fkey" FOREIGN KEY ("handoffId") REFERENCES "AIEmployeeHandoff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_dispatchAttemptId_fkey" FOREIGN KEY ("dispatchAttemptId") REFERENCES "MaintenanceDispatchAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_retryOfCallId_fkey" FOREIGN KEY ("retryOfCallId") REFERENCES "VoiceCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCallEvent" ADD CONSTRAINT "VoiceCallEvent_callId_fkey" FOREIGN KEY ("callId") REFERENCES "VoiceCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceContactPreference" ADD CONSTRAINT "VoiceContactPreference_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

