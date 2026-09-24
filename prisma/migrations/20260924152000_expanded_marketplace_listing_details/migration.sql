ALTER TABLE "Listing"
ADD COLUMN IF NOT EXISTS "landSizeSqm" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "toilets" INTEGER,
ADD COLUMN IF NOT EXISTS "parkingSpaces" INTEGER,
ADD COLUMN IF NOT EXISTS "furnishing" TEXT,
ADD COLUMN IF NOT EXISTS "propertyCondition" TEXT,
ADD COLUMN IF NOT EXISTS "negotiable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "yearBuilt" INTEGER;

ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_toilets_nonnegative"
CHECK ("toilets" IS NULL OR "toilets" >= 0);

ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_parkingSpaces_nonnegative"
CHECK ("parkingSpaces" IS NULL OR "parkingSpaces" >= 0);

ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_landSizeSqm_positive"
CHECK ("landSizeSqm" IS NULL OR "landSizeSqm" > 0);

ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_yearBuilt_valid"
CHECK ("yearBuilt" IS NULL OR ("yearBuilt" >= 1800 AND "yearBuilt" <= 2200));
