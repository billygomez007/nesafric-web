CREATE TYPE "MarketplaceEnquiryStatus" AS ENUM ('NEW', 'VIEWED', 'RESPONDED', 'CLOSED', 'CANCELLED');

CREATE TABLE "ProviderMarketplaceProfile" (
  "providerId" UUID NOT NULL,
  "listed" BOOLEAN NOT NULL DEFAULT false,
  "publicDescription" TEXT,
  "showContactEmail" BOOLEAN NOT NULL DEFAULT false,
  "showContactPhone" BOOLEAN NOT NULL DEFAULT false,
  "startingRateMinor" DECIMAL(19,0),
  "currencyCode" CHAR(3),
  "responseTimeHours" INTEGER,
  "listedAt" TIMESTAMP(3),
  "unlistedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderMarketplaceProfile_pkey" PRIMARY KEY ("providerId"),
  CONSTRAINT "ProviderMarketplaceProfile_rate_check" CHECK ("startingRateMinor" IS NULL OR "startingRateMinor" >= 0),
  CONSTRAINT "ProviderMarketplaceProfile_response_check" CHECK ("responseTimeHours" IS NULL OR "responseTimeHours" BETWEEN 1 AND 8760),
  CONSTRAINT "ProviderMarketplaceProfile_rate_currency_check" CHECK ("startingRateMinor" IS NULL OR "currencyCode" IS NOT NULL)
);

CREATE TABLE "ProviderMarketplaceCategory" (
  "providerId" UUID NOT NULL,
  "categoryId" UUID NOT NULL,
  CONSTRAINT "ProviderMarketplaceCategory_pkey" PRIMARY KEY ("providerId", "categoryId")
);

CREATE TABLE "ProviderMarketplaceServiceArea" (
  "id" UUID NOT NULL,
  "providerId" UUID NOT NULL,
  "countryCode" CHAR(2) NOT NULL,
  "region" TEXT,
  "city" TEXT,
  "district" TEXT,
  "label" TEXT,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "radiusKm" DECIMAL(10,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderMarketplaceServiceArea_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderMarketplaceServiceArea_coordinates_check" CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL)
    OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
  ),
  CONSTRAINT "ProviderMarketplaceServiceArea_radius_check" CHECK ("radiusKm" IS NULL OR "radiusKm" > 0)
);

CREATE TABLE "ProviderMarketplaceProfileHistory" (
  "id" UUID NOT NULL,
  "providerId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "changedFields" TEXT[] NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderMarketplaceProfileHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceEnquiry" (
  "id" UUID NOT NULL,
  "requestingOrganisationId" UUID NOT NULL,
  "providerId" UUID NOT NULL,
  "categoryId" UUID NOT NULL,
  "propertyId" UUID,
  "maintenanceRequestId" UUID,
  "requestedByUserId" UUID NOT NULL,
  "quotationRequestId" UUID,
  "message" TEXT NOT NULL,
  "status" "MarketplaceEnquiryStatus" NOT NULL DEFAULT 'NEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "viewedAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "MarketplaceEnquiry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceEnquiryStatusHistory" (
  "id" UUID NOT NULL,
  "enquiryId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "fromStatus" "MarketplaceEnquiryStatus",
  "toStatus" "MarketplaceEnquiryStatus" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceEnquiryStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderMarketplaceProfile_listed_updatedAt_idx" ON "ProviderMarketplaceProfile"("listed", "updatedAt");
CREATE INDEX "ProviderMarketplaceCategory_categoryId_providerId_idx" ON "ProviderMarketplaceCategory"("categoryId", "providerId");
CREATE UNIQUE INDEX "ProviderMarketplaceServiceArea_providerId_countryCode_reg_key"
  ON "ProviderMarketplaceServiceArea"("providerId", "countryCode", "region", "city", "district");
CREATE INDEX "ProviderMarketplaceServiceArea_countryCode_region_city_dist_idx"
  ON "ProviderMarketplaceServiceArea"("countryCode", "region", "city", "district");
CREATE INDEX "ProviderMarketplaceServiceArea_providerId_idx" ON "ProviderMarketplaceServiceArea"("providerId");
CREATE INDEX "ProviderMarketplaceProfileHistory_providerId_createdAt_idx" ON "ProviderMarketplaceProfileHistory"("providerId", "createdAt");
CREATE UNIQUE INDEX "MarketplaceEnquiry_quotationRequestId_key" ON "MarketplaceEnquiry"("quotationRequestId");
CREATE INDEX "MarketplaceEnquiry_requestingOrganisationId_status_createdAt_idx"
  ON "MarketplaceEnquiry"("requestingOrganisationId", "status", "createdAt");
CREATE INDEX "MarketplaceEnquiry_providerId_status_createdAt_idx" ON "MarketplaceEnquiry"("providerId", "status", "createdAt");
CREATE INDEX "MarketplaceEnquiryStatusHistory_enquiryId_createdAt_idx" ON "MarketplaceEnquiryStatusHistory"("enquiryId", "createdAt");

ALTER TABLE "ProviderMarketplaceProfile" ADD CONSTRAINT "ProviderMarketplaceProfile_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderMarketplaceCategory" ADD CONSTRAINT "ProviderMarketplaceCategory_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ProviderMarketplaceProfile"("providerId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderMarketplaceCategory" ADD CONSTRAINT "ProviderMarketplaceCategory_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderMarketplaceServiceArea" ADD CONSTRAINT "ProviderMarketplaceServiceArea_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ProviderMarketplaceProfile"("providerId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderMarketplaceProfileHistory" ADD CONSTRAINT "ProviderMarketplaceProfileHistory_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ProviderMarketplaceProfile"("providerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderMarketplaceProfileHistory" ADD CONSTRAINT "ProviderMarketplaceProfileHistory_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceEnquiry" ADD CONSTRAINT "MarketplaceEnquiry_requestingOrganisationId_fkey"
  FOREIGN KEY ("requestingOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceEnquiry" ADD CONSTRAINT "MarketplaceEnquiry_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceEnquiry" ADD CONSTRAINT "MarketplaceEnquiry_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceEnquiry" ADD CONSTRAINT "MarketplaceEnquiry_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceEnquiry" ADD CONSTRAINT "MarketplaceEnquiry_maintenanceRequestId_fkey"
  FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceEnquiry" ADD CONSTRAINT "MarketplaceEnquiry_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceEnquiry" ADD CONSTRAINT "MarketplaceEnquiry_quotationRequestId_fkey"
  FOREIGN KEY ("quotationRequestId") REFERENCES "ProviderQuotationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceEnquiryStatusHistory" ADD CONSTRAINT "MarketplaceEnquiryStatusHistory_enquiryId_fkey"
  FOREIGN KEY ("enquiryId") REFERENCES "MarketplaceEnquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceEnquiryStatusHistory" ADD CONSTRAINT "MarketplaceEnquiryStatusHistory_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_marketplace_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'marketplace history rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProviderMarketplaceProfileHistory_immutable"
  BEFORE UPDATE OR DELETE ON "ProviderMarketplaceProfileHistory"
  FOR EACH ROW EXECUTE FUNCTION prevent_marketplace_history_mutation();
CREATE TRIGGER "MarketplaceEnquiryStatusHistory_immutable"
  BEFORE UPDATE OR DELETE ON "MarketplaceEnquiryStatusHistory"
  FOR EACH ROW EXECUTE FUNCTION prevent_marketplace_history_mutation();

INSERT INTO "Permission" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'marketplace.enquiry.create', 'Create marketplace enquiries for the organisation'),
  (gen_random_uuid(), 'marketplace.enquiry.read', 'View the organisation marketplace enquiry history'),
  (gen_random_uuid(), 'marketplace.enquiry.manage', 'Close or cancel organisation marketplace enquiries'),
  (gen_random_uuid(), 'marketplace.quote_request', 'Request provider quotations from marketplace enquiries')
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
      'marketplace.enquiry.create',
      'marketplace.enquiry.read',
      'marketplace.enquiry.manage',
      'marketplace.quote_request'
    )
  )
  OR (
    role."key" = 'viewer'
    AND permission."key" = 'marketplace.enquiry.read'
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
