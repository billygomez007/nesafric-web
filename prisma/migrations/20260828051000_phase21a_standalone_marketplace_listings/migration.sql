-- Marketplace-native inventory is intentionally separate from PropertyOS Property/Unit.
CREATE TABLE "MarketplaceAsset" (
  "id" UUID NOT NULL,
  "marketplaceProfessionalId" UUID NOT NULL,
  "developmentUnitId" UUID,
  "createdByUserId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "subtype" TEXT,
  "purpose" "ListingType" NOT NULL,
  "bedrooms" INTEGER,
  "bathrooms" DECIMAL(4,1),
  "sizeSqm" DECIMAL(12,2),
  "currencyCode" CHAR(3) NOT NULL,
  "priceMinor" DECIMAL(19,0) NOT NULL,
  "countryCode" CHAR(2) NOT NULL,
  "region" TEXT,
  "city" TEXT,
  "district" TEXT,
  "locality" TEXT,
  "publicLocationLabel" TEXT,
  "mapLatitude" DECIMAL(10,7),
  "mapLongitude" DECIMAL(10,7),
  "amenities" TEXT[],
  "furnishing" TEXT,
  "mediaUrls" TEXT[],
  "availabilityStatus" "DevelopmentUnitStatus" NOT NULL DEFAULT 'AVAILABLE',
  "availableFrom" TIMESTAMP(3) NOT NULL,
  "authorityEvidenceReady" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "MarketplaceAsset_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Listing" ALTER COLUMN "propertyId" DROP NOT NULL;
ALTER TABLE "Listing" ADD COLUMN "marketplaceAssetId" UUID;

CREATE TABLE "ListingAttributionHistory" (
  "id" UUID NOT NULL,
  "listingId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "fromMarketplaceProfessionalId" UUID,
  "toMarketplaceProfessionalId" UUID,
  "fromRepresentativeUserId" UUID,
  "toRepresentativeUserId" UUID,
  "fromAuthority" "ListingAuthority",
  "toAuthority" "ListingAuthority",
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingAttributionHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketplaceAsset_developmentUnitId_key" ON "MarketplaceAsset"("developmentUnitId");
CREATE INDEX "MarketplaceAsset_marketplaceProfessionalId_archivedAt_availabilityStatus_idx" ON "MarketplaceAsset"("marketplaceProfessionalId", "archivedAt", "availabilityStatus");
CREATE INDEX "MarketplaceAsset_countryCode_city_purpose_idx" ON "MarketplaceAsset"("countryCode", "city", "purpose");
CREATE INDEX "Listing_marketplaceAssetId_createdAt_idx" ON "Listing"("marketplaceAssetId", "createdAt");
CREATE INDEX "ListingAttributionHistory_listingId_createdAt_idx" ON "ListingAttributionHistory"("listingId", "createdAt");

ALTER TABLE "MarketplaceAsset" ADD CONSTRAINT "MarketplaceAsset_marketplaceProfessionalId_fkey" FOREIGN KEY ("marketplaceProfessionalId") REFERENCES "MarketplaceProfessional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceAsset" ADD CONSTRAINT "MarketplaceAsset_developmentUnitId_fkey" FOREIGN KEY ("developmentUnitId") REFERENCES "DevelopmentUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceAsset" ADD CONSTRAINT "MarketplaceAsset_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_marketplaceAssetId_fkey" FOREIGN KEY ("marketplaceAssetId") REFERENCES "MarketplaceAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListingAttributionHistory" ADD CONSTRAINT "ListingAttributionHistory_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListingAttributionHistory" ADD CONSTRAINT "ListingAttributionHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A listing has one and only one inventory source. Units remain valid only with PropertyOS.
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_exactly_one_source_check" CHECK (
  (("propertyId" IS NOT NULL)::integer + ("marketplaceAssetId" IS NOT NULL)::integer) = 1
  AND ("unitId" IS NULL OR "propertyId" IS NOT NULL)
);
