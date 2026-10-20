-- CreateEnum
CREATE TYPE "GeoAreaType" AS ENUM ('REGION', 'DISTRICT', 'CONSTITUENCY');

-- CreateEnum
CREATE TYPE "GeoAssemblyKind" AS ENUM ('METROPOLITAN', 'MUNICIPAL', 'DISTRICT');

-- CreateEnum
CREATE TYPE "GeoVerificationStatus" AS ENUM ('OFFICIAL', 'SOURCE_ASSERTED', 'UNVERIFIED', 'TEST_FIXTURE');

-- CreateEnum
CREATE TYPE "GeoLocalityKind" AS ENUM ('CITY', 'TOWN', 'NEIGHBOURHOOD', 'ESTATE', 'VILLAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "GeoLinkRelation" AS ENUM ('WITHIN', 'PARTLY_WITHIN');

-- CreateEnum
CREATE TYPE "GeoAliasKind" AS ENUM ('ALTERNATE_NAME', 'FORMER_NAME', 'SPELLING', 'ABBREVIATION');

-- CreateEnum
CREATE TYPE "GeoImportMode" AS ENUM ('DRY_RUN', 'APPLY');

-- CreateEnum
CREATE TYPE "GeoImportRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "GeoImportChangeAction" AS ENUM ('CREATE_AREA', 'CREATE_LOCALITY', 'ADD_ALIAS', 'ADD_LINK', 'RENAME', 'REPARENT', 'RECODE', 'DEACTIVATE');

-- CreateEnum
CREATE TYPE "GeoImportChangeStatus" AS ENUM ('APPLIED', 'PENDING_REVIEW', 'REJECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "GeoLocationPurpose" AS ENUM ('PROPERTY', 'LISTING', 'BUSINESS_OFFICE', 'PROVIDER_BASE');

-- CreateEnum
CREATE TYPE "GeoResolutionStatus" AS ENUM ('RESOLVED', 'PARTIAL', 'AMBIGUOUS', 'UNRESOLVED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "GeoResolutionSource" AS ENUM ('USER_SELECTED', 'WHATSAPP', 'BACKFILL', 'ADMIN');

-- CreateEnum
CREATE TYPE "GeoCoordinateSource" AS ENUM ('USER_PIN', 'WHATSAPP_PIN', 'GEOCODER', 'LEGACY');

-- CreateEnum
CREATE TYPE "GeoCoverageSource" AS ENUM ('USER', 'WHATSAPP', 'BACKFILL', 'ADMIN');

-- AlterTable
ALTER TABLE "Country" ADD COLUMN     "geographyEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GeoDataSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "version" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "licence" TEXT NOT NULL,
    "licenceUrl" TEXT,
    "coverage" TEXT NOT NULL,
    "verificationStatus" "GeoVerificationStatus" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoDataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoArea" (
    "id" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "type" "GeoAreaType" NOT NULL,
    "assemblyKind" "GeoAssemblyKind",
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "code" TEXT,
    "parentId" TEXT,
    "centroidLatitude" DECIMAL(10,7),
    "centroidLongitude" DECIMAL(10,7),
    "verificationStatus" "GeoVerificationStatus" NOT NULL,
    "sourceId" TEXT,
    "sourceRecordRef" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoLocality" (
    "id" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "kind" "GeoLocalityKind" NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "centroidLatitude" DECIMAL(10,7),
    "centroidLongitude" DECIMAL(10,7),
    "centroidSource" TEXT,
    "verificationStatus" "GeoVerificationStatus" NOT NULL,
    "sourceId" TEXT,
    "sourceRecordRef" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoLocality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoLocalityArea" (
    "id" UUID NOT NULL,
    "localityId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "relation" "GeoLinkRelation" NOT NULL DEFAULT 'WITHIN',
    "verificationStatus" "GeoVerificationStatus" NOT NULL,
    "sourceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoLocalityArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoAlias" (
    "id" UUID NOT NULL,
    "areaId" TEXT,
    "localityId" TEXT,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "kind" "GeoAliasKind" NOT NULL DEFAULT 'ALTERNATE_NAME',
    "sourceId" TEXT,
    "createdByUserId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoImportRun" (
    "id" UUID NOT NULL,
    "sourceId" TEXT NOT NULL,
    "mode" "GeoImportMode" NOT NULL,
    "status" "GeoImportRunStatus" NOT NULL DEFAULT 'RUNNING',
    "inputChecksum" TEXT NOT NULL,
    "actorUserId" UUID,
    "summary" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GeoImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoImportChange" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "action" "GeoImportChangeAction" NOT NULL,
    "status" "GeoImportChangeStatus" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "payload" JSONB NOT NULL,
    "reason" TEXT,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoImportChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoLocation" (
    "id" UUID NOT NULL,
    "purpose" "GeoLocationPurpose" NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "regionId" TEXT,
    "districtId" TEXT,
    "localityId" TEXT,
    "originalText" JSONB,
    "streetOrEstate" TEXT,
    "landmark" TEXT,
    "accessNotes" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "coordinateSource" "GeoCoordinateSource",
    "coordinateAccuracyM" INTEGER,
    "coordinateCapturedAt" TIMESTAMP(3),
    "geocoderProvider" TEXT,
    "geocoderPrecision" TEXT,
    "resolutionStatus" "GeoResolutionStatus" NOT NULL,
    "resolutionSource" "GeoResolutionSource" NOT NULL,
    "resolutionNote" TEXT,
    "candidates" JSONB,
    "userConfirmedAt" TIMESTAMP(3),
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "publicPrecision" "ListingLocationPrecision",
    "listingId" UUID,
    "propertyId" UUID,
    "marketplaceProfessionalId" UUID,
    "serviceProviderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoCoverageArea" (
    "id" UUID NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "serviceProviderId" UUID,
    "marketplaceProfessionalId" UUID,
    "areaId" TEXT,
    "localityId" TEXT,
    "nationwide" BOOLEAN NOT NULL DEFAULT false,
    "categoryId" UUID,
    "originalText" TEXT,
    "source" "GeoCoverageSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoCoverageArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeoArea_countryCode_type_active_normalizedName_idx" ON "GeoArea"("countryCode", "type", "active", "normalizedName");

-- CreateIndex
CREATE INDEX "GeoArea_parentId_active_idx" ON "GeoArea"("parentId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "GeoArea_countryCode_type_code_key" ON "GeoArea"("countryCode", "type", "code");

-- CreateIndex
CREATE INDEX "GeoLocality_countryCode_active_normalizedName_idx" ON "GeoLocality"("countryCode", "active", "normalizedName");

-- CreateIndex
CREATE INDEX "GeoLocalityArea_areaId_idx" ON "GeoLocalityArea"("areaId");

-- CreateIndex
CREATE UNIQUE INDEX "GeoLocalityArea_localityId_areaId_key" ON "GeoLocalityArea"("localityId", "areaId");

-- CreateIndex
CREATE INDEX "GeoAlias_normalizedAlias_idx" ON "GeoAlias"("normalizedAlias");

-- CreateIndex
CREATE UNIQUE INDEX "GeoAlias_areaId_normalizedAlias_key" ON "GeoAlias"("areaId", "normalizedAlias");

-- CreateIndex
CREATE UNIQUE INDEX "GeoAlias_localityId_normalizedAlias_key" ON "GeoAlias"("localityId", "normalizedAlias");

-- CreateIndex
CREATE INDEX "GeoImportRun_sourceId_startedAt_idx" ON "GeoImportRun"("sourceId", "startedAt");

-- CreateIndex
CREATE INDEX "GeoImportChange_status_createdAt_idx" ON "GeoImportChange"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GeoImportChange_runId_idx" ON "GeoImportChange"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "GeoLocation_listingId_key" ON "GeoLocation"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "GeoLocation_propertyId_key" ON "GeoLocation"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "GeoLocation_marketplaceProfessionalId_key" ON "GeoLocation"("marketplaceProfessionalId");

-- CreateIndex
CREATE UNIQUE INDEX "GeoLocation_serviceProviderId_key" ON "GeoLocation"("serviceProviderId");

-- CreateIndex
CREATE INDEX "GeoLocation_countryCode_regionId_idx" ON "GeoLocation"("countryCode", "regionId");

-- CreateIndex
CREATE INDEX "GeoLocation_districtId_idx" ON "GeoLocation"("districtId");

-- CreateIndex
CREATE INDEX "GeoLocation_localityId_idx" ON "GeoLocation"("localityId");

-- CreateIndex
CREATE INDEX "GeoLocation_resolutionStatus_updatedAt_idx" ON "GeoLocation"("resolutionStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "GeoCoverageArea_serviceProviderId_idx" ON "GeoCoverageArea"("serviceProviderId");

-- CreateIndex
CREATE INDEX "GeoCoverageArea_marketplaceProfessionalId_idx" ON "GeoCoverageArea"("marketplaceProfessionalId");

-- CreateIndex
CREATE INDEX "GeoCoverageArea_areaId_idx" ON "GeoCoverageArea"("areaId");

-- CreateIndex
CREATE INDEX "GeoCoverageArea_localityId_idx" ON "GeoCoverageArea"("localityId");

-- AddForeignKey
ALTER TABLE "GeoArea" ADD CONSTRAINT "GeoArea_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoArea" ADD CONSTRAINT "GeoArea_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "GeoArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoArea" ADD CONSTRAINT "GeoArea_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GeoDataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoLocality" ADD CONSTRAINT "GeoLocality_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoLocality" ADD CONSTRAINT "GeoLocality_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GeoDataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoLocalityArea" ADD CONSTRAINT "GeoLocalityArea_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "GeoLocality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoLocalityArea" ADD CONSTRAINT "GeoLocalityArea_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "GeoArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoLocalityArea" ADD CONSTRAINT "GeoLocalityArea_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GeoDataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoAlias" ADD CONSTRAINT "GeoAlias_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "GeoArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoAlias" ADD CONSTRAINT "GeoAlias_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "GeoLocality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoAlias" ADD CONSTRAINT "GeoAlias_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GeoDataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoImportRun" ADD CONSTRAINT "GeoImportRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GeoDataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoImportChange" ADD CONSTRAINT "GeoImportChange_runId_fkey" FOREIGN KEY ("runId") REFERENCES "GeoImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoLocation" ADD CONSTRAINT "GeoLocation_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "GeoArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoLocation" ADD CONSTRAINT "GeoLocation_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "GeoArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoLocation" ADD CONSTRAINT "GeoLocation_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "GeoLocality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoLocation" ADD CONSTRAINT "GeoLocation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoLocation" ADD CONSTRAINT "GeoLocation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoLocation" ADD CONSTRAINT "GeoLocation_marketplaceProfessionalId_fkey" FOREIGN KEY ("marketplaceProfessionalId") REFERENCES "MarketplaceProfessional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoLocation" ADD CONSTRAINT "GeoLocation_serviceProviderId_fkey" FOREIGN KEY ("serviceProviderId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoCoverageArea" ADD CONSTRAINT "GeoCoverageArea_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "GeoArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoCoverageArea" ADD CONSTRAINT "GeoCoverageArea_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "GeoLocality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoCoverageArea" ADD CONSTRAINT "GeoCoverageArea_serviceProviderId_fkey" FOREIGN KEY ("serviceProviderId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoCoverageArea" ADD CONSTRAINT "GeoCoverageArea_marketplaceProfessionalId_fkey" FOREIGN KEY ("marketplaceProfessionalId") REFERENCES "MarketplaceProfessional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoCoverageArea" ADD CONSTRAINT "GeoCoverageArea_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- Integrity rules Prisma cannot express.
-- ---------------------------------------------------------------------------------------------

-- A structured location has exactly one owner, matching its purpose.
ALTER TABLE "GeoLocation" ADD CONSTRAINT "GeoLocation_one_owner_check" CHECK (
  ("purpose" = 'LISTING' AND "listingId" IS NOT NULL AND "propertyId" IS NULL AND "marketplaceProfessionalId" IS NULL AND "serviceProviderId" IS NULL)
  OR ("purpose" = 'PROPERTY' AND "propertyId" IS NOT NULL AND "listingId" IS NULL AND "marketplaceProfessionalId" IS NULL AND "serviceProviderId" IS NULL)
  OR ("purpose" = 'BUSINESS_OFFICE' AND "marketplaceProfessionalId" IS NOT NULL AND "listingId" IS NULL AND "propertyId" IS NULL AND "serviceProviderId" IS NULL)
  OR ("purpose" = 'PROVIDER_BASE' AND "serviceProviderId" IS NOT NULL AND "listingId" IS NULL AND "propertyId" IS NULL AND "marketplaceProfessionalId" IS NULL)
);
ALTER TABLE "GeoLocation" ADD CONSTRAINT "GeoLocation_coordinates_check" CHECK (
  ("latitude" IS NULL) = ("longitude" IS NULL)
  AND ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180 AND "coordinateSource" IS NOT NULL))
);
ALTER TABLE "GeoLocation" ADD CONSTRAINT "GeoLocation_text_length_check" CHECK (
  ("landmark" IS NULL OR char_length("landmark") <= 200)
  AND ("accessNotes" IS NULL OR char_length("accessNotes") <= 500)
  AND ("streetOrEstate" IS NULL OR char_length("streetOrEstate") <= 150)
);

-- Coverage: exactly one holder, and exactly one of area, locality or explicit nationwide.
ALTER TABLE "GeoCoverageArea" ADD CONSTRAINT "GeoCoverageArea_one_holder_check" CHECK (
  ("serviceProviderId" IS NULL) <> ("marketplaceProfessionalId" IS NULL)
);
ALTER TABLE "GeoCoverageArea" ADD CONSTRAINT "GeoCoverageArea_one_target_check" CHECK (
  (("areaId" IS NOT NULL)::int + ("localityId" IS NOT NULL)::int + ("nationwide")::int) = 1
);
CREATE UNIQUE INDEX "GeoCoverageArea_unique_target" ON "GeoCoverageArea" (
  COALESCE("serviceProviderId"::text, "marketplaceProfessionalId"::text),
  COALESCE("areaId", "localityId", 'NATIONWIDE:' || "countryCode"),
  COALESCE("categoryId"::text, '')
);

-- An alias names exactly one area or locality.
ALTER TABLE "GeoAlias" ADD CONSTRAINT "GeoAlias_one_target_check" CHECK (("areaId" IS NULL) <> ("localityId" IS NULL));

-- Hierarchy rules: a region has no parent; a district's parent is a region of the same country;
-- a constituency's parent is a region or nothing. Nothing may have a constituency (or a
-- district) as its parent, so electoral geography never becomes the parent of anything.
CREATE OR REPLACE FUNCTION "geo_area_check_parent"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_type "GeoAreaType"; parent_country CHAR(2);
BEGIN
  IF NEW."parentId" IS NULL THEN
    IF NEW."type" = 'DISTRICT' THEN RAISE EXCEPTION 'A district must have a region as its parent.'; END IF;
    RETURN NEW;
  END IF;
  IF NEW."type" = 'REGION' THEN RAISE EXCEPTION 'A region cannot have a parent.'; END IF;
  SELECT "type", "countryCode" INTO parent_type, parent_country FROM "GeoArea" WHERE "id" = NEW."parentId";
  IF parent_type IS DISTINCT FROM 'REGION' THEN RAISE EXCEPTION 'Only a region can be the parent of a district or constituency.'; END IF;
  IF parent_country <> NEW."countryCode" THEN RAISE EXCEPTION 'A parent area must be in the same country.'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "GeoArea_check_parent" BEFORE INSERT OR UPDATE OF "parentId", "type", "countryCode" ON "GeoArea"
  FOR EACH ROW EXECUTE FUNCTION "geo_area_check_parent"();

-- A structured location's region and district ids point at the right levels, in its country,
-- and the district sits in the region.
CREATE OR REPLACE FUNCTION "geo_location_check_levels"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  IF NEW."regionId" IS NOT NULL THEN
    SELECT "type", "countryCode" INTO r FROM "GeoArea" WHERE "id" = NEW."regionId";
    IF r."type" IS DISTINCT FROM 'REGION' OR r."countryCode" <> NEW."countryCode" THEN RAISE EXCEPTION 'regionId must be a region in the location''s country.'; END IF;
  END IF;
  IF NEW."districtId" IS NOT NULL THEN
    SELECT "type", "countryCode", "parentId" INTO r FROM "GeoArea" WHERE "id" = NEW."districtId";
    IF r."type" IS DISTINCT FROM 'DISTRICT' OR r."countryCode" <> NEW."countryCode" THEN RAISE EXCEPTION 'districtId must be a district in the location''s country.'; END IF;
    IF NEW."regionId" IS NOT NULL AND r."parentId" IS DISTINCT FROM NEW."regionId" THEN RAISE EXCEPTION 'districtId is not in regionId.'; END IF;
  END IF;
  IF NEW."localityId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "GeoLocality" WHERE "id" = NEW."localityId" AND "countryCode" = NEW."countryCode") THEN
    RAISE EXCEPTION 'localityId must be a locality in the location''s country.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "GeoLocation_check_levels" BEFORE INSERT OR UPDATE OF "regionId", "districtId", "localityId", "countryCode" ON "GeoLocation"
  FOR EACH ROW EXECUTE FUNCTION "geo_location_check_levels"();

-- A listing's structured location is part of the listing: changing it increments
-- "Listing"."revision" (through the existing Listing trigger), so a WhatsApp confirmation made
-- before a location change is stale. The one exception is the geographic backfill, which only
-- links existing listings to reference ids without changing what anyone entered or reviewed: it
-- sets the transaction-local flag "nesafric.geo_backfill" so reviews in progress stay valid.
CREATE OR REPLACE FUNCTION "geo_location_bump_listing"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('nesafric.geo_backfill', true) = 'on' THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NOT (OLD.* IS DISTINCT FROM NEW.*) THEN RETURN NULL; END IF;
  UPDATE "Listing" SET "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" IN (COALESCE(NEW."listingId", OLD."listingId"), OLD."listingId");
  RETURN NULL;
END;
$$;
CREATE TRIGGER "GeoLocation_bump_listing_revision" AFTER INSERT OR UPDATE OR DELETE ON "GeoLocation"
  FOR EACH ROW EXECUTE FUNCTION "geo_location_bump_listing"();

-- Configured countries: Ghana's geography is enabled; its reference data is loaded by the import.
UPDATE "Country" SET "geographyEnabled" = true WHERE "code" = 'GH';
