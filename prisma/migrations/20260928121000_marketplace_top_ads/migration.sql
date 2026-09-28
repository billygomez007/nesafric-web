-- Additive only: admin-pinned "Top Ads" for the public property marketplace.
CREATE TABLE "MarketplaceTopAd" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceTopAd_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketplaceTopAd_schedule_check" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE UNIQUE INDEX "MarketplaceTopAd_listingId_key" ON "MarketplaceTopAd"("listingId");

CREATE INDEX "MarketplaceTopAd_isActive_sortOrder_idx" ON "MarketplaceTopAd"("isActive", "sortOrder");

ALTER TABLE "MarketplaceTopAd" ADD CONSTRAINT "MarketplaceTopAd_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketplaceTopAd" ADD CONSTRAINT "MarketplaceTopAd_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MarketplaceTopAd" ADD CONSTRAINT "MarketplaceTopAd_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
