-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('PROPERTY', 'DEVELOPMENT', 'REAL_ESTATE_PROFESSIONAL', 'REAL_ESTATE_COMPANY', 'PROPERTY_SERVICE_PROFESSIONAL', 'PROPERTY_SERVICE_COMPANY', 'UMOAFRIC_PROMOTION', 'ANNOUNCEMENT', 'GENERAL');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "advertiserServiceProviderId" UUID,
ADD COLUMN     "type" "CampaignType";

-- CreateIndex
CREATE INDEX "Campaign_advertiserServiceProviderId_idx" ON "Campaign"("advertiserServiceProviderId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_advertiserServiceProviderId_fkey" FOREIGN KEY ("advertiserServiceProviderId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

