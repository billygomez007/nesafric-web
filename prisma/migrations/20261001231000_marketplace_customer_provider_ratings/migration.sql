CREATE TABLE "MarketplaceProviderRating" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceProviderRating_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketplaceProviderRating_score_check"
        CHECK ("score" >= 1 AND "score" <= 5)
);

CREATE UNIQUE INDEX "MarketplaceProviderRating_providerId_createdByUserId_key"
ON "MarketplaceProviderRating"("providerId", "createdByUserId");

CREATE INDEX "MarketplaceProviderRating_providerId_createdAt_idx"
ON "MarketplaceProviderRating"("providerId", "createdAt");

ALTER TABLE "MarketplaceProviderRating"
ADD CONSTRAINT "MarketplaceProviderRating_providerId_fkey"
FOREIGN KEY ("providerId")
REFERENCES "ServiceProvider"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "MarketplaceProviderRating"
ADD CONSTRAINT "MarketplaceProviderRating_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId")
REFERENCES "User"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
