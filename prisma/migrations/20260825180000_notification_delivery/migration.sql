-- Replace the enum so the new default can be used safely in the same migration.
CREATE TYPE "NotificationStatus_new" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SCHEDULED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'SKIPPED',
  'CANCELLED'
);

ALTER TABLE "Notification" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Notification"
  ALTER COLUMN "status" TYPE "NotificationStatus_new"
  USING ("status"::text::"NotificationStatus_new");
DROP TYPE "NotificationStatus";
ALTER TYPE "NotificationStatus_new" RENAME TO "NotificationStatus";

ALTER TABLE "Notification"
  RENAME COLUMN "retryCount" TO "deliveryAttempts";

ALTER TABLE "Notification"
  ADD COLUMN "processingAt" TIMESTAMP(3),
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "failureReason" TEXT,
  ADD COLUMN "readAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Notification"
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

UPDATE "Notification"
SET "status" = 'PENDING'
WHERE "status" = 'SCHEDULED';

CREATE INDEX "Notification_organisationId_readAt_createdAt_idx"
  ON "Notification"("organisationId", "readAt", "createdAt");
