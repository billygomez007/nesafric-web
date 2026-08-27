-- CreateEnum
CREATE TYPE "CampaignPlacement" AS ENUM ('HOMEPAGE_ANNOUNCEMENT', 'MARKETPLACE_PRIMARY', 'MARKETPLACE_INLINE', 'DEVELOPMENT_FEATURED', 'PROFESSIONAL_FEATURED', 'SEARCH_FEATURED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'REJECTED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "placement" "CampaignPlacement" NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "headline" TEXT NOT NULL,
    "supportingText" TEXT,
    "ctaLabel" TEXT,
    "destinationUrl" TEXT NOT NULL,
    "desktopMediaUrl" TEXT,
    "mobileMediaUrl" TEXT,
    "countryCode" CHAR(2),
    "region" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "impressionCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "isPlatformOwned" BOOLEAN NOT NULL DEFAULT false,
    "advertiserMarketplaceProfessionalId" UUID,
    "createdByUserId" UUID NOT NULL,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_placement_status_priority_idx" ON "Campaign"("placement", "status", "priority");

-- CreateIndex
CREATE INDEX "Campaign_advertiserMarketplaceProfessionalId_idx" ON "Campaign"("advertiserMarketplaceProfessionalId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_advertiserMarketplaceProfessionalId_fkey" FOREIGN KEY ("advertiserMarketplaceProfessionalId") REFERENCES "MarketplaceProfessional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

