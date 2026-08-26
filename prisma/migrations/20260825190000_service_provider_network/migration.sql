CREATE TYPE "ServiceProviderType" AS ENUM ('INDIVIDUAL', 'COMPANY');
CREATE TYPE "ProviderVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "ProviderAvailabilityStatus" AS ENUM ('AVAILABLE', 'LIMITED', 'UNAVAILABLE');
CREATE TYPE "ProviderDirectoryStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'ARCHIVED');
CREATE TYPE "ProviderEvidenceType" AS ENUM ('IDENTITY', 'BUSINESS_REGISTRATION', 'PROFESSIONAL_LICENSE', 'INSURANCE', 'ADDRESS', 'OTHER');
CREATE TYPE "QuotationRequestStatus" AS ENUM ('OPEN', 'SUBMITTED', 'CLOSED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "ProviderQuotationStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');
CREATE TYPE "QuotationSource" AS ENUM ('PROVIDER', 'ADMIN_RECORDED');
CREATE TYPE "ProviderAssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'COMPLETED');

ALTER TABLE "WorkOrder"
  DROP COLUMN "externalServiceProviderRef",
  DROP COLUMN "quotationReference",
  DROP COLUMN "externalAssignmentRef",
  DROP COLUMN "ratingReference";

CREATE TABLE "ServiceProvider" (
  "id" UUID NOT NULL,
  "type" "ServiceProviderType" NOT NULL,
  "individualUserId" UUID,
  "companyOrganisationId" UUID,
  "administratorUserId" UUID NOT NULL,
  "displayName" TEXT NOT NULL,
  "legalName" TEXT,
  "contactEmail" CITEXT,
  "contactPhone" TEXT,
  "verificationStatus" "ProviderVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "availabilityStatus" "ProviderAvailabilityStatus" NOT NULL DEFAULT 'UNAVAILABLE',
  "contactReady" BOOLEAN NOT NULL DEFAULT false,
  "evidenceReady" BOOLEAN NOT NULL DEFAULT false,
  "acceptingWork" BOOLEAN NOT NULL DEFAULT false,
  "biography" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "ServiceProvider_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceProvider_identity_check" CHECK (
    ("type" = 'INDIVIDUAL' AND "individualUserId" IS NOT NULL AND "companyOrganisationId" IS NULL)
    OR
    ("type" = 'COMPANY' AND "individualUserId" IS NULL AND "companyOrganisationId" IS NOT NULL)
  )
);

CREATE TABLE "ServiceCategory" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceProviderCategory" (
  "providerId" UUID NOT NULL,
  "categoryId" UUID NOT NULL,
  CONSTRAINT "ServiceProviderCategory_pkey" PRIMARY KEY ("providerId", "categoryId")
);

CREATE TABLE "ProviderServiceArea" (
  "id" UUID NOT NULL,
  "providerId" UUID NOT NULL,
  "areaType" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "reference" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderServiceArea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderEvidence" (
  "id" UUID NOT NULL,
  "providerId" UUID NOT NULL,
  "type" "ProviderEvidenceType" NOT NULL,
  "reference" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "submittedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderVerificationHistory" (
  "id" UUID NOT NULL,
  "providerId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "fromStatus" "ProviderVerificationStatus" NOT NULL,
  "toStatus" "ProviderVerificationStatus" NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderVerificationHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderOrganisation" (
  "id" UUID NOT NULL,
  "landlordOrganisationId" UUID NOT NULL,
  "providerId" UUID NOT NULL,
  "status" "ProviderDirectoryStatus" NOT NULL DEFAULT 'ACTIVE',
  "internalNotes" TEXT,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderOrganisation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderQuotationRequest" (
  "id" UUID NOT NULL,
  "landlordOrganisationId" UUID NOT NULL,
  "providerId" UUID NOT NULL,
  "maintenanceRequestId" UUID NOT NULL,
  "requestedByUserId" UUID NOT NULL,
  "status" "QuotationRequestStatus" NOT NULL DEFAULT 'OPEN',
  "scope" TEXT NOT NULL,
  "responseDueAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderQuotationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderQuotation" (
  "id" UUID NOT NULL,
  "landlordOrganisationId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "providerId" UUID NOT NULL,
  "source" "QuotationSource" NOT NULL,
  "status" "ProviderQuotationStatus" NOT NULL DEFAULT 'SUBMITTED',
  "labourAmountMinor" DECIMAL(19,0) NOT NULL,
  "materialsAmountMinor" DECIMAL(19,0) NOT NULL,
  "totalAmountMinor" DECIMAL(19,0) NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "etaDays" INTEGER NOT NULL,
  "notes" TEXT,
  "submittedByUserId" UUID,
  "recordedByUserId" UUID,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderQuotation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderQuotation_amounts_check" CHECK (
    "labourAmountMinor" >= 0 AND "materialsAmountMinor" >= 0
    AND "totalAmountMinor" = "labourAmountMinor" + "materialsAmountMinor"
  ),
  CONSTRAINT "ProviderQuotation_eta_check" CHECK ("etaDays" > 0),
  CONSTRAINT "ProviderQuotation_source_actor_check" CHECK (
    ("source" = 'PROVIDER' AND "submittedByUserId" IS NOT NULL AND "recordedByUserId" IS NULL)
    OR
    ("source" = 'ADMIN_RECORDED' AND "recordedByUserId" IS NOT NULL)
  )
);

CREATE TABLE "ProviderQuotationReview" (
  "id" UUID NOT NULL,
  "quotationId" UUID NOT NULL,
  "reviewerUserId" UUID NOT NULL,
  "decision" "ProviderQuotationStatus" NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderQuotationReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderQuotationReview_decision_check" CHECK ("decision" IN ('APPROVED', 'REJECTED'))
);

CREATE TABLE "ProviderAssignment" (
  "id" UUID NOT NULL,
  "landlordOrganisationId" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "providerId" UUID NOT NULL,
  "quotationId" UUID,
  "status" "ProviderAssignmentStatus" NOT NULL DEFAULT 'PENDING',
  "assignedByUserId" UUID NOT NULL,
  "respondedByUserId" UUID,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  "expectedStartAt" TIMESTAMP(3),
  "expectedCompletionAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "declinedAt" TIMESTAMP(3),
  "declineReason" TEXT,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ProviderAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderAssignment_dates_check" CHECK (
    "expectedStartAt" IS NULL OR "expectedCompletionAt" IS NULL OR "expectedCompletionAt" >= "expectedStartAt"
  )
);

CREATE TABLE "ProviderRating" (
  "id" UUID NOT NULL,
  "landlordOrganisationId" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "providerId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "score" INTEGER NOT NULL,
  "qualityScore" INTEGER,
  "timelinessScore" INTEGER,
  "communicationScore" INTEGER,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderRating_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderRating_scores_check" CHECK (
    "score" BETWEEN 1 AND 5
    AND ("qualityScore" IS NULL OR "qualityScore" BETWEEN 1 AND 5)
    AND ("timelinessScore" IS NULL OR "timelinessScore" BETWEEN 1 AND 5)
    AND ("communicationScore" IS NULL OR "communicationScore" BETWEEN 1 AND 5)
  )
);

CREATE UNIQUE INDEX "ServiceProvider_individualUserId_key" ON "ServiceProvider"("individualUserId");
CREATE UNIQUE INDEX "ServiceProvider_companyOrganisationId_key" ON "ServiceProvider"("companyOrganisationId");
CREATE INDEX "ServiceProvider_verificationStatus_availabilityStatus_archi_idx" ON "ServiceProvider"("verificationStatus", "availabilityStatus", "archivedAt");
CREATE UNIQUE INDEX "ServiceCategory_key_key" ON "ServiceCategory"("key");
CREATE INDEX "ServiceCategory_active_name_idx" ON "ServiceCategory"("active", "name");
CREATE INDEX "ServiceProviderCategory_categoryId_idx" ON "ServiceProviderCategory"("categoryId");
CREATE UNIQUE INDEX "ProviderServiceArea_providerId_areaType_name_key" ON "ProviderServiceArea"("providerId", "areaType", "name");
CREATE INDEX "ProviderServiceArea_areaType_reference_idx" ON "ProviderServiceArea"("areaType", "reference");
CREATE UNIQUE INDEX "ProviderEvidence_providerId_type_reference_key" ON "ProviderEvidence"("providerId", "type", "reference");
CREATE INDEX "ProviderEvidence_providerId_expiresAt_idx" ON "ProviderEvidence"("providerId", "expiresAt");
CREATE INDEX "ProviderVerificationHistory_providerId_createdAt_idx" ON "ProviderVerificationHistory"("providerId", "createdAt");
CREATE UNIQUE INDEX "ProviderOrganisation_landlordOrganisationId_providerId_key" ON "ProviderOrganisation"("landlordOrganisationId", "providerId");
CREATE INDEX "ProviderOrganisation_landlordOrganisationId_status_idx" ON "ProviderOrganisation"("landlordOrganisationId", "status");
CREATE INDEX "ProviderOrganisation_providerId_status_idx" ON "ProviderOrganisation"("providerId", "status");
CREATE UNIQUE INDEX "ProviderQuotationRequest_landlordOrganisationId_providerId__key" ON "ProviderQuotationRequest"("landlordOrganisationId", "providerId", "maintenanceRequestId");
CREATE INDEX "ProviderQuotationRequest_landlordOrganisationId_status_crea_idx" ON "ProviderQuotationRequest"("landlordOrganisationId", "status", "createdAt");
CREATE INDEX "ProviderQuotationRequest_providerId_status_createdAt_idx" ON "ProviderQuotationRequest"("providerId", "status", "createdAt");
CREATE INDEX "ProviderQuotation_landlordOrganisationId_status_submittedAt_idx" ON "ProviderQuotation"("landlordOrganisationId", "status", "submittedAt");
CREATE INDEX "ProviderQuotation_requestId_submittedAt_idx" ON "ProviderQuotation"("requestId", "submittedAt");
CREATE INDEX "ProviderQuotation_providerId_submittedAt_idx" ON "ProviderQuotation"("providerId", "submittedAt");
CREATE INDEX "ProviderQuotationReview_quotationId_createdAt_idx" ON "ProviderQuotationReview"("quotationId", "createdAt");
CREATE INDEX "ProviderAssignment_landlordOrganisationId_status_assignedAt_idx" ON "ProviderAssignment"("landlordOrganisationId", "status", "assignedAt");
CREATE INDEX "ProviderAssignment_providerId_status_assignedAt_idx" ON "ProviderAssignment"("providerId", "status", "assignedAt");
CREATE INDEX "ProviderAssignment_workOrderId_assignedAt_idx" ON "ProviderAssignment"("workOrderId", "assignedAt");
CREATE UNIQUE INDEX "ProviderRating_workOrderId_key" ON "ProviderRating"("workOrderId");
CREATE INDEX "ProviderRating_providerId_createdAt_idx" ON "ProviderRating"("providerId", "createdAt");
CREATE INDEX "ProviderRating_landlordOrganisationId_createdAt_idx" ON "ProviderRating"("landlordOrganisationId", "createdAt");

ALTER TABLE "ServiceProvider" ADD CONSTRAINT "ServiceProvider_individualUserId_fkey" FOREIGN KEY ("individualUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceProvider" ADD CONSTRAINT "ServiceProvider_companyOrganisationId_fkey" FOREIGN KEY ("companyOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceProvider" ADD CONSTRAINT "ServiceProvider_administratorUserId_fkey" FOREIGN KEY ("administratorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceProviderCategory" ADD CONSTRAINT "ServiceProviderCategory_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceProviderCategory" ADD CONSTRAINT "ServiceProviderCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderServiceArea" ADD CONSTRAINT "ProviderServiceArea_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderEvidence" ADD CONSTRAINT "ProviderEvidence_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderEvidence" ADD CONSTRAINT "ProviderEvidence_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderVerificationHistory" ADD CONSTRAINT "ProviderVerificationHistory_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderVerificationHistory" ADD CONSTRAINT "ProviderVerificationHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderOrganisation" ADD CONSTRAINT "ProviderOrganisation_landlordOrganisationId_fkey" FOREIGN KEY ("landlordOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderOrganisation" ADD CONSTRAINT "ProviderOrganisation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderOrganisation" ADD CONSTRAINT "ProviderOrganisation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderQuotationRequest" ADD CONSTRAINT "ProviderQuotationRequest_landlordOrganisationId_fkey" FOREIGN KEY ("landlordOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderQuotationRequest" ADD CONSTRAINT "ProviderQuotationRequest_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderQuotationRequest" ADD CONSTRAINT "ProviderQuotationRequest_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderQuotationRequest" ADD CONSTRAINT "ProviderQuotationRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderQuotation" ADD CONSTRAINT "ProviderQuotation_landlordOrganisationId_fkey" FOREIGN KEY ("landlordOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderQuotation" ADD CONSTRAINT "ProviderQuotation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProviderQuotationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderQuotation" ADD CONSTRAINT "ProviderQuotation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderQuotation" ADD CONSTRAINT "ProviderQuotation_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderQuotation" ADD CONSTRAINT "ProviderQuotation_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderQuotationReview" ADD CONSTRAINT "ProviderQuotationReview_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "ProviderQuotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderQuotationReview" ADD CONSTRAINT "ProviderQuotationReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderAssignment" ADD CONSTRAINT "ProviderAssignment_landlordOrganisationId_fkey" FOREIGN KEY ("landlordOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderAssignment" ADD CONSTRAINT "ProviderAssignment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderAssignment" ADD CONSTRAINT "ProviderAssignment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderAssignment" ADD CONSTRAINT "ProviderAssignment_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "ProviderQuotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderAssignment" ADD CONSTRAINT "ProviderAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderAssignment" ADD CONSTRAINT "ProviderAssignment_respondedByUserId_fkey" FOREIGN KEY ("respondedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderRating" ADD CONSTRAINT "ProviderRating_landlordOrganisationId_fkey" FOREIGN KEY ("landlordOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderRating" ADD CONSTRAINT "ProviderRating_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderRating" ADD CONSTRAINT "ProviderRating_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderRating" ADD CONSTRAINT "ProviderRating_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ServiceCategory" ("id", "key", "name", "updatedAt")
VALUES
  (gen_random_uuid(), 'plumbing', 'Plumbing', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'electrical', 'Electrical', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'roofing', 'Roofing', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'hvac', 'Heating, ventilation and air conditioning', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'appliance', 'Appliance repair', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'carpentry', 'Carpentry', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'painting', 'Painting', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'structural', 'Structural work', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'security', 'Security systems', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'sanitation', 'Sanitation', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "active" = true, "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "Permission" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'provider.read', 'View the organisation provider directory and provider performance'),
  (gen_random_uuid(), 'provider.manage', 'Manage provider directory records and quotation requests'),
  (gen_random_uuid(), 'provider.verify', 'Review provider verification evidence and status'),
  (gen_random_uuid(), 'provider.quote_record', 'Record provider quotations received outside PropertyOS'),
  (gen_random_uuid(), 'provider.quote_review', 'Approve or reject submitted provider quotations'),
  (gen_random_uuid(), 'provider.assign', 'Assign approved providers to work orders'),
  (gen_random_uuid(), 'provider.rate', 'Rate providers after completed work orders')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
CROSS JOIN "Permission" permission
WHERE
  role."key" IN ('organisation_owner', 'administrator')
  OR (
    role."key" = 'property_manager'
    AND permission."key" IN ('provider.read', 'provider.manage', 'provider.quote_record', 'provider.quote_review', 'provider.assign', 'provider.rate')
  )
  OR (
    role."key" = 'viewer'
    AND permission."key" = 'provider.read'
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
