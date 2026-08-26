-- Phase 18: Ghana payment integration (MTN MoMo, Telecel Cash, AT Money, card/bank readiness).
-- Payment/PaymentIntent/PaymentReconciliationEvent already support provider-neutral gateways
-- from Phase 5, so this migration only extends notifications to disambiguate repeatable
-- per-transaction notifications (e.g. payment received/failed) from the lease-threshold
-- reminders the table originally modeled, and cleans up unrelated drift on `updatedAt`.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "ReminderEventType" ADD VALUE 'PAYMENT_RECEIVED';
ALTER TYPE "ReminderEventType" ADD VALUE 'PAYMENT_FAILED';

-- DropIndex
DROP INDEX "Notification_leaseId_tenantOrganisationId_eventType_thresho_key";

-- AlterTable
-- Removes stale drift: `updatedAt` was backfilled with a DEFAULT CURRENT_TIMESTAMP when it was
-- added in a prior migration; Prisma's `@updatedAt` always sets it explicitly on every write, so
-- the DB-level default is redundant and inconsistent with every other `@updatedAt` column.
ALTER TABLE "Notification" ADD COLUMN     "dedupeReference" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_leaseId_tenantOrganisationId_eventType_thresho_key" ON "Notification"("leaseId", "tenantOrganisationId", "eventType", "thresholdDays", "dedupeReference", "channel");
