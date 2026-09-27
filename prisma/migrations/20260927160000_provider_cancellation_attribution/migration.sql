-- Provider reputation semantics: record who performed an assignment cancellation, why, and which
-- party is responsible, so only provider-caused cancellations can lower a public completion rate.
-- Additive only. Generated with `prisma migrate diff` (schema to schema) because a fresh shadow
-- database cannot replay the existing chain (20260829070919_phase25_service_category_admin_controls
-- references "ProviderDocumentRequirement" before 20260829130000_phase23 creates it).
-- CreateEnum
CREATE TYPE "ProviderCancellationAttribution" AS ENUM ('PROVIDER', 'LANDLORD', 'TENANT', 'MUTUAL', 'SYSTEM', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ProviderCancellationReason" AS ENUM ('PROVIDER_FAILED_TO_ATTEND', 'PROVIDER_WITHDREW', 'WORK_NO_LONGER_REQUIRED', 'CHANGED_PLANS', 'FOUND_ANOTHER_PROVIDER', 'TENANT_WITHDREW', 'SCHEDULING_ISSUE', 'MUTUAL_AGREEMENT', 'OTHER');

-- AlterTable
ALTER TABLE "ProviderAssignment" ADD COLUMN     "cancellationAttribution" "ProviderCancellationAttribution",
ADD COLUMN     "cancellationNote" TEXT,
ADD COLUMN     "cancellationReason" "ProviderCancellationReason",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByUserId" UUID;

-- CreateIndex
CREATE INDEX "ProviderAssignment_providerId_status_cancellationAttributio_idx" ON "ProviderAssignment"("providerId", "status", "cancellationAttribution");

-- AddForeignKey
ALTER TABLE "ProviderAssignment" ADD CONSTRAINT "ProviderAssignment_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Historical data: cancellations recorded before attribution existed are marked UNKNOWN — never
-- PROVIDER — so no provider is blamed retroactively. Their actor and reason stay NULL (not known).
UPDATE "ProviderAssignment" SET "cancellationAttribution" = 'UNKNOWN' WHERE "status" = 'CANCELLED' AND "cancellationAttribution" IS NULL;
