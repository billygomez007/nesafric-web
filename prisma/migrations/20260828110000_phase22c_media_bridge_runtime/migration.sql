-- CreateEnum
CREATE TYPE "MediaStreamStatus" AS ENUM ('PENDING', 'CONNECTED', 'CLOSED', 'EXPIRED', 'REJECTED');

-- AlterTable
ALTER TABLE "PhoneNumber" ADD COLUMN     "maxConcurrentCalls" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "VoiceProviderConfig" ADD COLUMN     "exhaustedMinutesBehavior" TEXT NOT NULL DEFAULT 'HANDOFF',
ADD COLUMN     "maxCallDurationSeconds" INTEGER NOT NULL DEFAULT 1800,
ADD COLUMN     "maxConcurrentCallsPerEmployee" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "maxConcurrentOutboundCalls" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "maxConsecutiveOutboundFailures" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "mediaStreamWsUrl" TEXT;

-- CreateTable
CREATE TABLE "MediaStreamSession" (
    "id" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "providerKey" TEXT NOT NULL,
    "streamToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" "MediaStreamStatus" NOT NULL DEFAULT 'PENDING',
    "connectedAt" TIMESTAMP(3),
    "lastFrameAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "disconnectReason" TEXT,
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaStreamSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaStreamSession_streamToken_key" ON "MediaStreamSession"("streamToken");

-- CreateIndex
CREATE INDEX "MediaStreamSession_callId_idx" ON "MediaStreamSession"("callId");

-- CreateIndex
CREATE INDEX "MediaStreamSession_organisationId_status_idx" ON "MediaStreamSession"("organisationId", "status");

-- CreateIndex
CREATE INDEX "MediaStreamSession_status_tokenExpiresAt_idx" ON "MediaStreamSession"("status", "tokenExpiresAt");

-- AddForeignKey
ALTER TABLE "MediaStreamSession" ADD CONSTRAINT "MediaStreamSession_callId_fkey" FOREIGN KEY ("callId") REFERENCES "VoiceCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaStreamSession" ADD CONSTRAINT "MediaStreamSession_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 22C item 2/10/11: a partial unique index, hand-added because Prisma's schema DSL cannot
-- express a WHERE-qualified unique constraint. This is the actual, database-enforced guarantee
-- behind "prevent duplicate active media sessions for one call" — even two concurrent
-- transactions racing to issue a stream token for the same call cannot both succeed, because
-- Postgres itself rejects the second INSERT the instant both rows would satisfy this index.
CREATE UNIQUE INDEX "MediaStreamSession_one_active_per_call"
  ON "MediaStreamSession" ("callId")
  WHERE "status" IN ('PENDING', 'CONNECTED');

