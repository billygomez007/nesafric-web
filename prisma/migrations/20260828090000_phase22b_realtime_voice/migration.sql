-- CreateEnum
CREATE TYPE "VoiceTransferStatus" AS ENUM ('NONE', 'REQUESTED', 'CONNECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "VoiceCallTurnSpeaker" AS ENUM ('CALLER', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "VoiceStreamingSessionStatus" AS ENUM ('ACTIVE', 'CLOSED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "VoiceConversationState" AS ENUM ('LISTENING', 'AI_SPEAKING', 'PROCESSING', 'SILENCE_WARNING');

-- CreateEnum
CREATE TYPE "PhoneNumberPurpose" AS ENUM ('TENANT_SUPPORT', 'SALES', 'DEVELOPMENT', 'GENERAL_OFFICE');

-- CreateEnum
CREATE TYPE "PhoneNumberStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'RELEASED');

-- AlterTable
ALTER TABLE "VoiceCall" ADD COLUMN     "aiModelTokensUsed" INTEGER,
ADD COLUMN     "providerCostAmount" DECIMAL(10,4),
ADD COLUMN     "providerCostCurrency" TEXT,
ADD COLUMN     "sttSecondsUsed" DOUBLE PRECISION,
ADD COLUMN     "transferStatus" "VoiceTransferStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "transferTargetNumber" TEXT,
ADD COLUMN     "transferredAt" TIMESTAMP(3),
ADD COLUMN     "ttsCharactersUsed" INTEGER;

-- AlterTable
ALTER TABLE "VoiceProviderConfig" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "disclosureRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "openingDisclosureText" TEXT,
ADD COLUMN     "recordingDisclosureText" TEXT,
ADD COLUMN     "sttProviderKey" TEXT NOT NULL DEFAULT 'MOCK',
ADD COLUMN     "ttsProviderKey" TEXT NOT NULL DEFAULT 'MOCK';

-- CreateTable
CREATE TABLE "PhoneNumber" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "developmentId" UUID,
    "e164Number" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL DEFAULT 'MOCK',
    "purpose" "PhoneNumberPurpose" NOT NULL DEFAULT 'GENERAL_OFFICE',
    "label" TEXT,
    "inboundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "outboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "assignedAIEmployeeId" UUID,
    "status" "PhoneNumberStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoicePersonaConfig" (
    "id" UUID NOT NULL,
    "aiEmployeeId" UUID NOT NULL,
    "employeeDisplayName" TEXT,
    "greetingScript" TEXT,
    "businessName" TEXT,
    "voiceProfileId" TEXT,
    "speakingStyle" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "supportedLanguages" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "escalationPhrase" TEXT,
    "officeHoursOverrideStart" TEXT,
    "officeHoursOverrideEnd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoicePersonaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceCallTurn" (
    "id" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "speaker" "VoiceCallTurnSpeaker" NOT NULL,
    "text" TEXT NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT true,
    "interrupted" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceCallTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceStreamingSession" (
    "id" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "status" "VoiceStreamingSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "state" "VoiceConversationState" NOT NULL DEFAULT 'LISTENING',
    "pendingTranscriptBuffer" TEXT,
    "turnSequence" INTEGER NOT NULL DEFAULT 0,
    "silenceTimeoutSeconds" INTEGER NOT NULL DEFAULT 8,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "disconnectReason" TEXT,

    CONSTRAINT "VoiceStreamingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhoneNumber_organisationId_status_idx" ON "PhoneNumber"("organisationId", "status");

-- CreateIndex
CREATE INDEX "PhoneNumber_developmentId_idx" ON "PhoneNumber"("developmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneNumber_providerKey_e164Number_key" ON "PhoneNumber"("providerKey", "e164Number");

-- CreateIndex
CREATE UNIQUE INDEX "VoicePersonaConfig_aiEmployeeId_key" ON "VoicePersonaConfig"("aiEmployeeId");

-- CreateIndex
CREATE INDEX "VoiceCallTurn_callId_sequence_idx" ON "VoiceCallTurn"("callId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceStreamingSession_callId_key" ON "VoiceStreamingSession"("callId");

-- AddForeignKey
ALTER TABLE "PhoneNumber" ADD CONSTRAINT "PhoneNumber_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneNumber" ADD CONSTRAINT "PhoneNumber_developmentId_fkey" FOREIGN KEY ("developmentId") REFERENCES "Development"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneNumber" ADD CONSTRAINT "PhoneNumber_assignedAIEmployeeId_fkey" FOREIGN KEY ("assignedAIEmployeeId") REFERENCES "AIEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoicePersonaConfig" ADD CONSTRAINT "VoicePersonaConfig_aiEmployeeId_fkey" FOREIGN KEY ("aiEmployeeId") REFERENCES "AIEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCallTurn" ADD CONSTRAINT "VoiceCallTurn_callId_fkey" FOREIGN KEY ("callId") REFERENCES "VoiceCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceStreamingSession" ADD CONSTRAINT "VoiceStreamingSession_callId_fkey" FOREIGN KEY ("callId") REFERENCES "VoiceCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

