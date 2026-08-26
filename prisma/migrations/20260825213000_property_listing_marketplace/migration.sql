CREATE TYPE "ListingType" AS ENUM ('RENT', 'SALE');
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'PAUSED', 'RESERVED', 'RENTED', 'ARCHIVED', 'REJECTED');
CREATE TYPE "ListingVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "ListingMediaType" AS ENUM ('PHOTO', 'VIDEO', 'FLOOR_PLAN');
CREATE TYPE "ListingLocationPrecision" AS ENUM ('APPROXIMATE', 'DISTRICT', 'CITY', 'REGION');
CREATE TYPE "MarketplaceLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING_SCHEDULED', 'CLOSED', 'SPAM');
CREATE TYPE "ViewingRequestStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

CREATE TABLE "Listing" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "unitId" UUID,
  "createdByUserId" UUID NOT NULL,
  "listingType" "ListingType" NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "publicDescription" TEXT NOT NULL,
  "askingAmountMinor" DECIMAL(19,0),
  "rentAmountMinor" DECIMAL(19,0),
  "currencyCode" CHAR(3) NOT NULL,
  "frequency" "RentFrequency",
  "availableFrom" TIMESTAMP(3) NOT NULL,
  "bedrooms" INTEGER,
  "bathrooms" DECIMAL(4,1),
  "sizeSqm" DECIMAL(12,2),
  "countryCode" CHAR(2) NOT NULL,
  "region" TEXT,
  "city" TEXT,
  "district" TEXT,
  "locality" TEXT,
  "publicLocationLabel" TEXT,
  "mapLatitude" DECIMAL(10,7),
  "mapLongitude" DECIMAL(10,7),
  "mapPrecision" "ListingLocationPrecision",
  "contactName" TEXT,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "showContactEmail" BOOLEAN NOT NULL DEFAULT false,
  "showContactPhone" BOOLEAN NOT NULL DEFAULT false,
  "enquiryEnabled" BOOLEAN NOT NULL DEFAULT true,
  "privateNotes" TEXT,
  "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
  "verificationStatus" "ListingVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "evidenceReady" BOOLEAN NOT NULL DEFAULT false,
  "submittedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "reservedAt" TIMESTAMP(3),
  "rentedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Listing_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Listing_price_nonnegative_check" CHECK (
    ("askingAmountMinor" IS NULL OR "askingAmountMinor" >= 0)
    AND ("rentAmountMinor" IS NULL OR "rentAmountMinor" >= 0)
  ),
  CONSTRAINT "Listing_type_price_check" CHECK (
    ("listingType" = 'RENT' AND "rentAmountMinor" IS NOT NULL AND "askingAmountMinor" IS NULL AND "frequency" IS NOT NULL)
    OR
    ("listingType" = 'SALE' AND "askingAmountMinor" IS NOT NULL AND "rentAmountMinor" IS NULL AND "frequency" IS NULL)
  ),
  CONSTRAINT "Listing_attributes_check" CHECK (
    ("bedrooms" IS NULL OR "bedrooms" >= 0)
    AND ("bathrooms" IS NULL OR "bathrooms" >= 0)
    AND ("sizeSqm" IS NULL OR "sizeSqm" > 0)
  ),
  CONSTRAINT "Listing_coordinates_check" CHECK (
    ("mapLatitude" IS NULL AND "mapLongitude" IS NULL AND "mapPrecision" IS NULL)
    OR
    ("mapLatitude" BETWEEN -90 AND 90 AND "mapLongitude" BETWEEN -180 AND 180 AND "mapPrecision" IS NOT NULL)
  ),
  CONSTRAINT "Listing_contact_check" CHECK (
    (NOT "showContactEmail" OR "contactEmail" IS NOT NULL)
    AND (NOT "showContactPhone" OR "contactPhone" IS NOT NULL)
  )
);

CREATE TABLE "ListingAmenity" (
  "id" UUID NOT NULL,
  "listingId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "category" TEXT,
  "metadata" JSONB,
  CONSTRAINT "ListingAmenity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListingMedia" (
  "id" UUID NOT NULL,
  "listingId" UUID NOT NULL,
  "type" "ListingMediaType" NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "storageKey" TEXT,
  "mimeType" TEXT,
  "title" TEXT,
  "altText" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "width" INTEGER,
  "height" INTEGER,
  "durationSeconds" INTEGER,
  "fileSizeBytes" DECIMAL(19,0),
  "checksum" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingMedia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ListingMedia_metadata_check" CHECK (
    "sortOrder" >= 0
    AND ("width" IS NULL OR "width" > 0)
    AND ("height" IS NULL OR "height" > 0)
    AND ("durationSeconds" IS NULL OR "durationSeconds" > 0)
    AND ("fileSizeBytes" IS NULL OR "fileSizeBytes" >= 0)
    AND ("type" <> 'PHOTO' OR "durationSeconds" IS NULL)
  )
);

CREATE TABLE "ListingVerificationEvidence" (
  "id" UUID NOT NULL,
  "listingId" UUID NOT NULL,
  "submittedByUserId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "privateReference" TEXT NOT NULL,
  "metadata" JSONB,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingVerificationEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListingStatusHistory" (
  "id" UUID NOT NULL,
  "listingId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "fromStatus" "ListingStatus",
  "toStatus" "ListingStatus" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListingVerificationHistory" (
  "id" UUID NOT NULL,
  "listingId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "fromStatus" "ListingVerificationStatus",
  "toStatus" "ListingVerificationStatus" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingVerificationHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceLead" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "listingId" UUID NOT NULL,
  "userId" UUID,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "message" TEXT,
  "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT,
  "status" "MarketplaceLeadStatus" NOT NULL DEFAULT 'NEW',
  "privateNotes" TEXT,
  "contactedAt" TIMESTAMP(3),
  "qualifiedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketplaceLead_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MarketplaceLead_contact_check" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL)
);

CREATE TABLE "MarketplaceLeadStatusHistory" (
  "id" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "actorUserId" UUID,
  "fromStatus" "MarketplaceLeadStatus",
  "toStatus" "MarketplaceLeadStatus" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceLeadStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ViewingRequest" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "listingId" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "createdByUserId" UUID,
  "assigneeMemberId" UUID,
  "status" "ViewingRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "requesterNote" TEXT,
  "privateNotes" TEXT,
  "confirmedStartsAt" TIMESTAMP(3),
  "confirmedEndsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ViewingRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ViewingRequest_confirmed_time_check" CHECK (
    ("confirmedStartsAt" IS NULL AND "confirmedEndsAt" IS NULL)
    OR ("confirmedStartsAt" IS NOT NULL AND "confirmedEndsAt" > "confirmedStartsAt")
  )
);

CREATE TABLE "ViewingPreferredTime" (
  "id" UUID NOT NULL,
  "viewingRequestId" UUID NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ViewingPreferredTime_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ViewingPreferredTime_range_check" CHECK ("endsAt" > "startsAt")
);

CREATE TABLE "ViewingRequestStatusHistory" (
  "id" UUID NOT NULL,
  "viewingRequestId" UUID NOT NULL,
  "actorUserId" UUID,
  "fromStatus" "ViewingRequestStatus",
  "toStatus" "ViewingRequestStatus" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ViewingRequestStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Listing_organisationId_status_createdAt_idx" ON "Listing"("organisationId", "status", "createdAt");
CREATE INDEX "Listing_propertyId_createdAt_idx" ON "Listing"("propertyId", "createdAt");
CREATE INDEX "Listing_unitId_createdAt_idx" ON "Listing"("unitId", "createdAt");
CREATE INDEX "Listing_status_listingType_countryCode_availableFrom_idx" ON "Listing"("status", "listingType", "countryCode", "availableFrom");
CREATE INDEX "Listing_currencyCode_rentAmountMinor_idx" ON "Listing"("currencyCode", "rentAmountMinor");
CREATE INDEX "Listing_currencyCode_askingAmountMinor_idx" ON "Listing"("currencyCode", "askingAmountMinor");
CREATE UNIQUE INDEX "ListingAmenity_listingId_key_key" ON "ListingAmenity"("listingId", "key");
CREATE INDEX "ListingAmenity_key_listingId_idx" ON "ListingAmenity"("key", "listingId");
CREATE INDEX "ListingMedia_listingId_sortOrder_createdAt_idx" ON "ListingMedia"("listingId", "sortOrder", "createdAt");
CREATE INDEX "ListingMedia_type_listingId_idx" ON "ListingMedia"("type", "listingId");
CREATE INDEX "ListingVerificationEvidence_listingId_createdAt_idx" ON "ListingVerificationEvidence"("listingId", "createdAt");
CREATE INDEX "ListingStatusHistory_listingId_createdAt_idx" ON "ListingStatusHistory"("listingId", "createdAt");
CREATE INDEX "ListingVerificationHistory_listingId_createdAt_idx" ON "ListingVerificationHistory"("listingId", "createdAt");
CREATE INDEX "MarketplaceLead_organisationId_status_createdAt_idx" ON "MarketplaceLead"("organisationId", "status", "createdAt");
CREATE INDEX "MarketplaceLead_listingId_createdAt_idx" ON "MarketplaceLead"("listingId", "createdAt");
CREATE INDEX "MarketplaceLead_userId_createdAt_idx" ON "MarketplaceLead"("userId", "createdAt");
CREATE INDEX "MarketplaceLeadStatusHistory_leadId_createdAt_idx" ON "MarketplaceLeadStatusHistory"("leadId", "createdAt");
CREATE INDEX "ViewingRequest_organisationId_status_createdAt_idx" ON "ViewingRequest"("organisationId", "status", "createdAt");
CREATE INDEX "ViewingRequest_listingId_createdAt_idx" ON "ViewingRequest"("listingId", "createdAt");
CREATE INDEX "ViewingRequest_leadId_createdAt_idx" ON "ViewingRequest"("leadId", "createdAt");
CREATE INDEX "ViewingRequest_assigneeMemberId_status_idx" ON "ViewingRequest"("assigneeMemberId", "status");
CREATE INDEX "ViewingPreferredTime_viewingRequestId_startsAt_idx" ON "ViewingPreferredTime"("viewingRequestId", "startsAt");
CREATE INDEX "ViewingRequestStatusHistory_viewingRequestId_createdAt_idx" ON "ViewingRequestStatusHistory"("viewingRequestId", "createdAt");

ALTER TABLE "Listing" ADD CONSTRAINT "Listing_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListingAmenity" ADD CONSTRAINT "ListingAmenity_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingVerificationEvidence" ADD CONSTRAINT "ListingVerificationEvidence_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListingVerificationEvidence" ADD CONSTRAINT "ListingVerificationEvidence_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListingStatusHistory" ADD CONSTRAINT "ListingStatusHistory_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListingStatusHistory" ADD CONSTRAINT "ListingStatusHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListingVerificationHistory" ADD CONSTRAINT "ListingVerificationHistory_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListingVerificationHistory" ADD CONSTRAINT "ListingVerificationHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceLead" ADD CONSTRAINT "MarketplaceLead_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceLead" ADD CONSTRAINT "MarketplaceLead_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceLead" ADD CONSTRAINT "MarketplaceLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketplaceLeadStatusHistory" ADD CONSTRAINT "MarketplaceLeadStatusHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MarketplaceLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceLeadStatusHistory" ADD CONSTRAINT "MarketplaceLeadStatusHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ViewingRequest" ADD CONSTRAINT "ViewingRequest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ViewingRequest" ADD CONSTRAINT "ViewingRequest_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ViewingRequest" ADD CONSTRAINT "ViewingRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MarketplaceLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ViewingRequest" ADD CONSTRAINT "ViewingRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ViewingRequest" ADD CONSTRAINT "ViewingRequest_assigneeMemberId_fkey" FOREIGN KEY ("assigneeMemberId") REFERENCES "OrganisationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ViewingPreferredTime" ADD CONSTRAINT "ViewingPreferredTime_viewingRequestId_fkey" FOREIGN KEY ("viewingRequestId") REFERENCES "ViewingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ViewingRequestStatusHistory" ADD CONSTRAINT "ViewingRequestStatusHistory_viewingRequestId_fkey" FOREIGN KEY ("viewingRequestId") REFERENCES "ViewingRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ViewingRequestStatusHistory" ADD CONSTRAINT "ViewingRequestStatusHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION prevent_listing_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'listing history and evidence rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ListingStatusHistory_immutable" BEFORE UPDATE OR DELETE ON "ListingStatusHistory" FOR EACH ROW EXECUTE FUNCTION prevent_listing_history_mutation();
CREATE TRIGGER "ListingVerificationHistory_immutable" BEFORE UPDATE OR DELETE ON "ListingVerificationHistory" FOR EACH ROW EXECUTE FUNCTION prevent_listing_history_mutation();
CREATE TRIGGER "ListingVerificationEvidence_immutable" BEFORE UPDATE OR DELETE ON "ListingVerificationEvidence" FOR EACH ROW EXECUTE FUNCTION prevent_listing_history_mutation();
CREATE TRIGGER "MarketplaceLeadStatusHistory_immutable" BEFORE UPDATE OR DELETE ON "MarketplaceLeadStatusHistory" FOR EACH ROW EXECUTE FUNCTION prevent_listing_history_mutation();
CREATE TRIGGER "ViewingRequestStatusHistory_immutable" BEFORE UPDATE OR DELETE ON "ViewingRequestStatusHistory" FOR EACH ROW EXECUTE FUNCTION prevent_listing_history_mutation();

CREATE FUNCTION enforce_listing_status_history() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ListingStatusHistory"
    WHERE "listingId" = NEW."id"
      AND "fromStatus" = OLD."status"
      AND "toStatus" = NEW."status"
      AND "createdAt" >= transaction_timestamp()
  ) THEN
    RAISE EXCEPTION 'listing status changes require immutable status history';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Listing_status_requires_history"
  AFTER UPDATE OF "status" ON "Listing"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION enforce_listing_status_history();

CREATE FUNCTION enforce_listing_verification_history() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ListingVerificationHistory"
    WHERE "listingId" = NEW."id"
      AND "fromStatus" = OLD."verificationStatus"
      AND "toStatus" = NEW."verificationStatus"
      AND "createdAt" >= transaction_timestamp()
  ) THEN
    RAISE EXCEPTION 'listing verification changes require immutable verification history';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Listing_verification_requires_history"
  AFTER UPDATE OF "verificationStatus" ON "Listing"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD."verificationStatus" IS DISTINCT FROM NEW."verificationStatus")
  EXECUTE FUNCTION enforce_listing_verification_history();

CREATE FUNCTION enforce_lead_status_history() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "MarketplaceLeadStatusHistory"
    WHERE "leadId" = NEW."id"
      AND "fromStatus" = OLD."status"
      AND "toStatus" = NEW."status"
      AND "createdAt" >= transaction_timestamp()
  ) THEN
    RAISE EXCEPTION 'lead status changes require immutable status history';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "MarketplaceLead_status_requires_history"
  AFTER UPDATE OF "status" ON "MarketplaceLead"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION enforce_lead_status_history();

CREATE FUNCTION enforce_viewing_status_history() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ViewingRequestStatusHistory"
    WHERE "viewingRequestId" = NEW."id"
      AND "fromStatus" = OLD."status"
      AND "toStatus" = NEW."status"
      AND "createdAt" >= transaction_timestamp()
  ) THEN
    RAISE EXCEPTION 'viewing status changes require immutable status history';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ViewingRequest_status_requires_history"
  AFTER UPDATE OF "status" ON "ViewingRequest"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION enforce_viewing_status_history();

INSERT INTO "Permission" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'listing.create', 'Create managed property and unit listings'),
  (gen_random_uuid(), 'listing.read', 'View organisation listing history'),
  (gen_random_uuid(), 'listing.manage', 'Edit listings and manage listing lifecycle'),
  (gen_random_uuid(), 'listing.publish', 'Approve and publish organisation listings'),
  (gen_random_uuid(), 'listing.verify', 'Review listing verification evidence metadata'),
  (gen_random_uuid(), 'listing.lead.read', 'View organisation listing leads'),
  (gen_random_uuid(), 'listing.lead.manage', 'Manage organisation listing leads'),
  (gen_random_uuid(), 'listing.viewing.read', 'View organisation viewing requests'),
  (gen_random_uuid(), 'listing.viewing.manage', 'Assign and manage viewing requests')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
CROSS JOIN "Permission" permission
WHERE
  role."key" IN ('organisation_owner', 'administrator')
  OR (
    role."key" = 'property_manager'
    AND permission."key" IN (
      'listing.create', 'listing.read', 'listing.manage', 'listing.publish',
      'listing.lead.read', 'listing.lead.manage',
      'listing.viewing.read', 'listing.viewing.manage'
    )
  )
  OR (
    role."key" = 'viewer'
    AND permission."key" IN ('listing.read', 'listing.lead.read', 'listing.viewing.read')
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
