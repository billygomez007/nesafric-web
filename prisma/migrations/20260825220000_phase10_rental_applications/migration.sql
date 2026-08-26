-- CreateEnum
CREATE TYPE "RentalApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApplicationDocumentType" AS ENUM ('ID', 'INCOME', 'EMPLOYMENT', 'REFERENCE', 'OTHER');

-- Preserve all lead and history rows while replacing the legacy terminal SPAM value.
ALTER TYPE "MarketplaceLeadStatus" RENAME VALUE 'SPAM' TO 'LOST';
ALTER TYPE "MarketplaceLeadStatus" ADD VALUE IF NOT EXISTS 'VIEWING_COMPLETED' AFTER 'VIEWING_SCHEDULED';
ALTER TYPE "MarketplaceLeadStatus" ADD VALUE IF NOT EXISTS 'APPLICATION_STARTED' AFTER 'VIEWING_COMPLETED';
ALTER TYPE "MarketplaceLeadStatus" ADD VALUE IF NOT EXISTS 'APPLICATION_SUBMITTED' AFTER 'APPLICATION_STARTED';

-- AlterTable
ALTER TABLE "MarketplaceLead" ADD COLUMN     "applicationStartedAt" TIMESTAMP(3),
ADD COLUMN     "applicationSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "assigneeMemberId" UUID,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lostAt" TIMESTAMP(3),
ADD COLUMN     "viewingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "viewingScheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ViewingRequest" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "noShowAt" TIMESTAMP(3),
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "rescheduledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MarketplaceLeadActivity" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "actorUserId" UUID,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceLeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Applicant" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "preferredName" TEXT,
    "email" CITEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "countryCode" CHAR(2),
    "applicantNotes" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Applicant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalApplication" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "applicantId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "assigneeMemberId" UUID,
    "tenantOrganisationId" UUID,
    "leaseId" UUID,
    "status" "RentalApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "employmentDetails" JSONB,
    "incomeAmountMinor" DECIMAL(19,0),
    "incomeCurrencyCode" CHAR(3),
    "incomeFrequency" TEXT,
    "previousTenancy" JSONB,
    "references" JSONB,
    "emergencyContact" JSONB,
    "household" JSONB,
    "coApplicants" JSONB,
    "applicantNotes" TEXT,
    "staffReviewNotes" TEXT,
    "decisionCategory" TEXT,
    "decisionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "decisionAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalApplicationStatusHistory" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "fromStatus" "RentalApplicationStatus",
    "toStatus" "RentalApplicationStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalApplicationStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalApplicationActivity" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "actorUserId" UUID,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalApplicationActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalApplicationDocument" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "uploadedByUserId" UUID NOT NULL,
    "type" "ApplicationDocumentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "checksum" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalApplicationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationConsent" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "recordedByUserId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "textVersion" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceLeadActivity_leadId_createdAt_idx" ON "MarketplaceLeadActivity"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "Applicant_organisationId_archivedAt_createdAt_idx" ON "Applicant"("organisationId", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Applicant_organisationId_email_idx" ON "Applicant"("organisationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "RentalApplication_leaseId_key" ON "RentalApplication"("leaseId");

-- CreateIndex
CREATE INDEX "RentalApplication_organisationId_status_createdAt_idx" ON "RentalApplication"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RentalApplication_listingId_createdAt_idx" ON "RentalApplication"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "RentalApplication_leadId_createdAt_idx" ON "RentalApplication"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "RentalApplication_applicantId_createdAt_idx" ON "RentalApplication"("applicantId", "createdAt");

-- CreateIndex
CREATE INDEX "RentalApplication_assigneeMemberId_status_idx" ON "RentalApplication"("assigneeMemberId", "status");

-- CreateIndex
CREATE INDEX "RentalApplication_tenantOrganisationId_idx" ON "RentalApplication"("tenantOrganisationId");

-- CreateIndex
CREATE INDEX "RentalApplicationStatusHistory_applicationId_createdAt_idx" ON "RentalApplicationStatusHistory"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "RentalApplicationActivity_applicationId_createdAt_idx" ON "RentalApplicationActivity"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "RentalApplicationDocument_applicationId_type_createdAt_idx" ON "RentalApplicationDocument"("applicationId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RentalApplicationDocument_applicationId_storageKey_key" ON "RentalApplicationDocument"("applicationId", "storageKey");

-- CreateIndex
CREATE INDEX "ApplicationConsent_applicationId_type_createdAt_idx" ON "ApplicationConsent"("applicationId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "MarketplaceLead_assigneeMemberId_status_idx" ON "MarketplaceLead"("assigneeMemberId", "status");

-- AddForeignKey
ALTER TABLE "MarketplaceLeadActivity" ADD CONSTRAINT "MarketplaceLeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MarketplaceLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceLeadActivity" ADD CONSTRAINT "MarketplaceLeadActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MarketplaceLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_assigneeMemberId_fkey" FOREIGN KEY ("assigneeMemberId") REFERENCES "OrganisationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplicationStatusHistory" ADD CONSTRAINT "RentalApplicationStatusHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RentalApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplicationStatusHistory" ADD CONSTRAINT "RentalApplicationStatusHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplicationActivity" ADD CONSTRAINT "RentalApplicationActivity_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RentalApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplicationActivity" ADD CONSTRAINT "RentalApplicationActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplicationDocument" ADD CONSTRAINT "RentalApplicationDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RentalApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplicationDocument" ADD CONSTRAINT "RentalApplicationDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationConsent" ADD CONSTRAINT "ApplicationConsent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RentalApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationConsent" ADD CONSTRAINT "ApplicationConsent_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceLead" ADD CONSTRAINT "MarketplaceLead_assigneeMemberId_fkey" FOREIGN KEY ("assigneeMemberId") REFERENCES "OrganisationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_contact_check" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_income_check" CHECK (
  "incomeAmountMinor" IS NULL OR "incomeAmountMinor" >= 0
);
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_income_group_check" CHECK (
  ("incomeAmountMinor" IS NULL AND "incomeCurrencyCode" IS NULL AND "incomeFrequency" IS NULL)
  OR ("incomeAmountMinor" IS NOT NULL AND "incomeCurrencyCode" IS NOT NULL AND "incomeFrequency" IS NOT NULL)
);
ALTER TABLE "RentalApplicationDocument" ADD CONSTRAINT "RentalApplicationDocument_size_check" CHECK ("sizeBytes" IS NULL OR "sizeBytes" > 0);
ALTER TABLE "ApplicationConsent" ADD CONSTRAINT "ApplicationConsent_state_check" CHECK (NOT ("granted" AND "revokedAt" IS NOT NULL));

CREATE INDEX "TenantOrganisation_organisationId_normalizedPhone_idx"
  ON "TenantOrganisation" ("organisationId", regexp_replace("phone", '[^0-9]', '', 'g'))
  WHERE "phone" IS NOT NULL;

CREATE FUNCTION prevent_application_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'application status history rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RentalApplicationStatusHistory_immutable"
  BEFORE UPDATE OR DELETE ON "RentalApplicationStatusHistory"
  FOR EACH ROW EXECUTE FUNCTION prevent_application_history_mutation();

CREATE FUNCTION enforce_application_status_history() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "RentalApplicationStatusHistory"
    WHERE "applicationId" = NEW."id"
      AND "fromStatus" = OLD."status"
      AND "toStatus" = NEW."status"
      AND "createdAt" >= transaction_timestamp()
  ) THEN
    RAISE EXCEPTION 'application status changes require immutable status history';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "RentalApplication_status_requires_history"
  AFTER UPDATE OF "status" ON "RentalApplication"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION enforce_application_status_history();

INSERT INTO "Permission" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'application.create', 'Create applicants and rental applications'),
  (gen_random_uuid(), 'application.read', 'View private organisation applicants and rental applications'),
  (gen_random_uuid(), 'application.review', 'Review and decide rental applications'),
  (gen_random_uuid(), 'application.convert', 'Convert approved applications to tenants and draft leases')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
CROSS JOIN "Permission" permission
WHERE
  (role."key" IN ('organisation_owner', 'administrator', 'property_manager')
    AND permission."key" IN ('application.create', 'application.read', 'application.review', 'application.convert'))
  OR (role."key" = 'viewer' AND permission."key" = 'application.read')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
