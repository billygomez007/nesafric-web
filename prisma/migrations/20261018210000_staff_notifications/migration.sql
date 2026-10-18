-- Staff notification preferences and delivery records (alerts and daily digests).
-- CreateTable
CREATE TABLE "NotificationPreference" (
    "memberId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "digestEnabled" BOOLEAN NOT NULL DEFAULT true,
    "digestHour" INTEGER NOT NULL DEFAULT 18,
    "noActivitySummary" BOOLEAN NOT NULL DEFAULT false,
    "attentionInDigest" BOOLEAN NOT NULL DEFAULT false,
    "immediateReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("memberId")
);

-- CreateTable
CREATE TABLE "StaffNotification" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "level" TEXT,
    "escalationId" UUID,
    "digestDate" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "messageId" UUID,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffNotification_dedupeKey_key" ON "StaffNotification"("dedupeKey");

-- CreateIndex
CREATE INDEX "StaffNotification_organisationId_createdAt_idx" ON "StaffNotification"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffNotification_memberId_kind_createdAt_idx" ON "StaffNotification"("memberId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrganisationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
