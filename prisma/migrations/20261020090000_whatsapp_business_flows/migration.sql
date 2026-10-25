-- CreateEnum
CREATE TYPE "ProviderPricingModel" AS ENUM ('FIXED', 'STARTING_FROM', 'QUOTE');

-- CreateEnum
CREATE TYPE "WhatsAppFlowKind" AS ENUM ('BUSINESS_APPLICATION', 'PROPERTY_LISTING', 'SERVICE_LISTING');

-- CreateEnum
CREATE TYPE "WhatsAppFlowStatus" AS ENUM ('OPEN', 'SUBMITTED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "ProviderMarketplaceProfile" ADD COLUMN     "pricingModel" "ProviderPricingModel";

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ListingMedia" ADD COLUMN     "sourceMediaId" TEXT;

-- CreateTable
CREATE TABLE "ProviderPortfolioImage" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "storageObjectId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,
    "sourceMediaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderPortfolioImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppFlowDraft" (
    "id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "WhatsAppFlowKind" NOT NULL,
    "status" "WhatsAppFlowStatus" NOT NULL DEFAULT 'OPEN',
    "step" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "lastMessageId" TEXT,
    "marketplaceProfessionalId" UUID,
    "serviceProviderId" UUID,
    "organisationId" UUID,
    "listingId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppFlowDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPortfolioImage_storageObjectId_key" ON "ProviderPortfolioImage"("storageObjectId");

-- CreateIndex
CREATE INDEX "ProviderPortfolioImage_providerId_sortOrder_idx" ON "ProviderPortfolioImage"("providerId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPortfolioImage_providerId_sourceMediaId_key" ON "ProviderPortfolioImage"("providerId", "sourceMediaId");

-- CreateIndex
CREATE INDEX "WhatsAppFlowDraft_address_status_idx" ON "WhatsAppFlowDraft"("address", "status");

-- CreateIndex
CREATE INDEX "WhatsAppFlowDraft_userId_kind_status_idx" ON "WhatsAppFlowDraft"("userId", "kind", "status");

-- CreateIndex
CREATE INDEX "WhatsAppFlowDraft_status_expiresAt_idx" ON "WhatsAppFlowDraft"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ListingMedia_listingId_sourceMediaId_key" ON "ListingMedia"("listingId", "sourceMediaId");

-- AddForeignKey
ALTER TABLE "ProviderPortfolioImage" ADD CONSTRAINT "ProviderPortfolioImage_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppFlowDraft" ADD CONSTRAINT "WhatsAppFlowDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One open WhatsApp draft per sender, linked account and flow: a redelivered "start" cannot open a
-- second one, and a number relinked to another account never continues the previous account's draft.
CREATE UNIQUE INDEX "WhatsAppFlowDraft_one_open_per_sender_flow" ON "WhatsAppFlowDraft"("address", "userId", "kind") WHERE "status" = 'OPEN';

-- Source media references stay short (they are message ids, never file contents).
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_sourceMediaId_length_check" CHECK ("sourceMediaId" IS NULL OR char_length("sourceMediaId") <= 200);
ALTER TABLE "ProviderPortfolioImage" ADD CONSTRAINT "ProviderPortfolioImage_sourceMediaId_length_check" CHECK ("sourceMediaId" IS NULL OR char_length("sourceMediaId") <= 200);

-- Every change to a listing, its media or its amenities increments "Listing"."revision", whichever
-- path made it (website, API or WhatsApp). A confirmation that names an older revision is stale.
CREATE OR REPLACE FUNCTION "listing_bump_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."revision" := OLD."revision" + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Listing_bump_revision" BEFORE UPDATE ON "Listing"
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION "listing_bump_revision"();

CREATE OR REPLACE FUNCTION "listing_child_bump_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Listing" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = COALESCE(NEW."listingId", OLD."listingId");
  RETURN NULL;
END;
$$;
CREATE TRIGGER "ListingMedia_bump_revision" AFTER INSERT OR UPDATE OR DELETE ON "ListingMedia"
  FOR EACH ROW EXECUTE FUNCTION "listing_child_bump_revision"();
CREATE TRIGGER "ListingAmenity_bump_revision" AFTER INSERT OR UPDATE OR DELETE ON "ListingAmenity"
  FOR EACH ROW EXECUTE FUNCTION "listing_child_bump_revision"();
