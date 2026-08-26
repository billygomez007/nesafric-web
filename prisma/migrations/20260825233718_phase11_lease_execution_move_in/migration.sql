-- CreateEnum
CREATE TYPE "LeaseExecutionStatus" AS ENUM ('DRAFT', 'READY_FOR_SIGNATURE', 'PARTIALLY_SIGNED', 'FULLY_SIGNED', 'ACTIVE');

-- CreateEnum
CREATE TYPE "LeaseExecutionDocumentStatus" AS ENUM ('DRAFT', 'READY', 'SIGNING', 'EXECUTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LeaseSignatureRole" AS ENUM ('ORG_REPRESENTATIVE', 'TENANT', 'CO_TENANT', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaseSignatureStatus" AS ENUM ('PENDING', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MoveInStatus" AS ENUM ('NOT_STARTED', 'SCHEDULED', 'INSPECTION_PENDING', 'READY', 'COMPLETED');

-- AlterTable
ALTER TABLE "Lease" ADD COLUMN     "activationRequirements" JSONB,
ADD COLUMN     "executionStatus" "LeaseExecutionStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "LeaseExecutionDocument" (
    "id" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "LeaseExecutionDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "providerReference" TEXT,
    "supersedesId" UUID,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "LeaseExecutionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseSignatureRequest" (
    "id" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "leasePartyId" UUID,
    "tenantOrganisationId" UUID,
    "organisationMemberId" UUID,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT,
    "role" "LeaseSignatureRole" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "LeaseSignatureStatus" NOT NULL DEFAULT 'PENDING',
    "providerKey" TEXT NOT NULL DEFAULT 'INTERNAL',
    "providerReference" TEXT,
    "requestedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "actedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaseSignatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveIn" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "status" "MoveInStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "scheduledDate" DATE,
    "actualDate" DATE,
    "responsibleMemberId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoveIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveInChecklistItem" (
    "id" UUID NOT NULL,
    "moveInId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "MoveInChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveInHistory" (
    "id" UUID NOT NULL,
    "moveInId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "fromStatus" "MoveInStatus",
    "toStatus" "MoveInStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoveInHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveInInspection" (
    "id" UUID NOT NULL,
    "moveInId" UUID NOT NULL,
    "inspectorMemberId" UUID NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL,
    "overallCondition" TEXT,
    "notes" TEXT,
    "tenantAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "tenantAcknowledgedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoveInInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveInInspectionArea" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "notes" TEXT,
    "defects" JSONB,
    "media" JSONB,

    CONSTRAINT "MoveInInspectionArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveInMeterReading" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "identifier" TEXT,
    "value" DECIMAL(19,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "MoveInMeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveInInventoryItem" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "condition" TEXT NOT NULL,
    "notes" TEXT,
    "metadata" JSONB,

    CONSTRAINT "MoveInInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveInKeyHandover" (
    "id" UUID NOT NULL,
    "moveInId" UUID NOT NULL,
    "tenantOrganisationId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "identifier" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "MoveInKeyHandover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaseExecutionDocument_leaseId_status_createdAt_idx" ON "LeaseExecutionDocument"("leaseId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseExecutionDocument_leaseId_version_key" ON "LeaseExecutionDocument"("leaseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseExecutionDocument_leaseId_fileKey_key" ON "LeaseExecutionDocument"("leaseId", "fileKey");

-- CreateIndex
CREATE INDEX "LeaseSignatureRequest_leaseId_status_idx" ON "LeaseSignatureRequest"("leaseId", "status");

-- CreateIndex
CREATE INDEX "LeaseSignatureRequest_documentId_status_idx" ON "LeaseSignatureRequest"("documentId", "status");

-- CreateIndex
CREATE INDEX "LeaseSignatureRequest_tenantOrganisationId_idx" ON "LeaseSignatureRequest"("tenantOrganisationId");

-- CreateIndex
CREATE INDEX "LeaseSignatureRequest_organisationMemberId_idx" ON "LeaseSignatureRequest"("organisationMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "MoveIn_leaseId_key" ON "MoveIn"("leaseId");

-- CreateIndex
CREATE INDEX "MoveIn_organisationId_status_scheduledDate_idx" ON "MoveIn"("organisationId", "status", "scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "MoveInChecklistItem_moveInId_key_key" ON "MoveInChecklistItem"("moveInId", "key");

-- CreateIndex
CREATE INDEX "MoveInHistory_moveInId_createdAt_idx" ON "MoveInHistory"("moveInId", "createdAt");

-- CreateIndex
CREATE INDEX "MoveInInspection_moveInId_inspectedAt_idx" ON "MoveInInspection"("moveInId", "inspectedAt");

-- CreateIndex
CREATE INDEX "MoveInInspectionArea_inspectionId_idx" ON "MoveInInspectionArea"("inspectionId");

-- CreateIndex
CREATE INDEX "MoveInMeterReading_inspectionId_type_idx" ON "MoveInMeterReading"("inspectionId", "type");

-- CreateIndex
CREATE INDEX "MoveInInventoryItem_inspectionId_category_idx" ON "MoveInInventoryItem"("inspectionId", "category");

-- CreateIndex
CREATE INDEX "MoveInKeyHandover_moveInId_issuedAt_idx" ON "MoveInKeyHandover"("moveInId", "issuedAt");

-- CreateIndex
CREATE INDEX "MoveInKeyHandover_tenantOrganisationId_idx" ON "MoveInKeyHandover"("tenantOrganisationId");

-- AddForeignKey
ALTER TABLE "LeaseExecutionDocument" ADD CONSTRAINT "LeaseExecutionDocument_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseExecutionDocument" ADD CONSTRAINT "LeaseExecutionDocument_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseExecutionDocument" ADD CONSTRAINT "LeaseExecutionDocument_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "LeaseExecutionDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseSignatureRequest" ADD CONSTRAINT "LeaseSignatureRequest_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseSignatureRequest" ADD CONSTRAINT "LeaseSignatureRequest_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LeaseExecutionDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseSignatureRequest" ADD CONSTRAINT "LeaseSignatureRequest_leasePartyId_fkey" FOREIGN KEY ("leasePartyId") REFERENCES "LeaseParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseSignatureRequest" ADD CONSTRAINT "LeaseSignatureRequest_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseSignatureRequest" ADD CONSTRAINT "LeaseSignatureRequest_organisationMemberId_fkey" FOREIGN KEY ("organisationMemberId") REFERENCES "OrganisationMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseSignatureRequest" ADD CONSTRAINT "LeaseSignatureRequest_actedByUserId_fkey" FOREIGN KEY ("actedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveIn" ADD CONSTRAINT "MoveIn_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveIn" ADD CONSTRAINT "MoveIn_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveIn" ADD CONSTRAINT "MoveIn_responsibleMemberId_fkey" FOREIGN KEY ("responsibleMemberId") REFERENCES "OrganisationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveInChecklistItem" ADD CONSTRAINT "MoveInChecklistItem_moveInId_fkey" FOREIGN KEY ("moveInId") REFERENCES "MoveIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveInHistory" ADD CONSTRAINT "MoveInHistory_moveInId_fkey" FOREIGN KEY ("moveInId") REFERENCES "MoveIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveInHistory" ADD CONSTRAINT "MoveInHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveInInspection" ADD CONSTRAINT "MoveInInspection_moveInId_fkey" FOREIGN KEY ("moveInId") REFERENCES "MoveIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveInInspection" ADD CONSTRAINT "MoveInInspection_inspectorMemberId_fkey" FOREIGN KEY ("inspectorMemberId") REFERENCES "OrganisationMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveInInspectionArea" ADD CONSTRAINT "MoveInInspectionArea_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "MoveInInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveInMeterReading" ADD CONSTRAINT "MoveInMeterReading_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "MoveInInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveInInventoryItem" ADD CONSTRAINT "MoveInInventoryItem_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "MoveInInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveInKeyHandover" ADD CONSTRAINT "MoveInKeyHandover_moveInId_fkey" FOREIGN KEY ("moveInId") REFERENCES "MoveIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveInKeyHandover" ADD CONSTRAINT "MoveInKeyHandover_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LeaseExecutionDocument" ADD CONSTRAINT "LeaseExecutionDocument_size_check" CHECK ("sizeBytes" IS NULL OR "sizeBytes" > 0);
ALTER TABLE "LeaseSignatureRequest" ADD CONSTRAINT "LeaseSignatureRequest_signer_check" CHECK (
  ("role" = 'ORG_REPRESENTATIVE' AND "organisationMemberId" IS NOT NULL)
  OR ("role" IN ('TENANT', 'CO_TENANT') AND "leasePartyId" IS NOT NULL AND "tenantOrganisationId" IS NOT NULL)
  OR ("role" = 'OTHER')
);
ALTER TABLE "MoveInInventoryItem" ADD CONSTRAINT "MoveInInventoryItem_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "MoveInKeyHandover" ADD CONSTRAINT "MoveInKeyHandover_quantity_check" CHECK ("quantity" > 0);

CREATE FUNCTION prevent_executed_document_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'EXECUTED' THEN
    RAISE EXCEPTION 'executed lease documents are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeaseExecutionDocument_executed_immutable"
  BEFORE UPDATE OR DELETE ON "LeaseExecutionDocument"
  FOR EACH ROW EXECUTE FUNCTION prevent_executed_document_mutation();

CREATE FUNCTION prevent_move_in_inspection_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'move-in inspections are permanent';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MoveInInspection_permanent"
  BEFORE DELETE ON "MoveInInspection"
  FOR EACH ROW EXECUTE FUNCTION prevent_move_in_inspection_delete();

INSERT INTO "Permission" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'lease.execution.read', 'View lease execution, signature, and onboarding records'),
  (gen_random_uuid(), 'lease.execution.manage', 'Manage lease documents, signature requests, and activation'),
  (gen_random_uuid(), 'lease.execution.sign', 'Perform authorised internal lease signature actions'),
  (gen_random_uuid(), 'move_in.read', 'View move-in workflows and inspections'),
  (gen_random_uuid(), 'move_in.manage', 'Manage move-in workflows, inspections, inventory, meters, and keys')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role CROSS JOIN "Permission" permission
WHERE
  (role."key" IN ('organisation_owner', 'administrator', 'property_manager')
    AND permission."key" IN ('lease.execution.read', 'lease.execution.manage', 'lease.execution.sign', 'move_in.read', 'move_in.manage'))
  OR (role."key" = 'viewer' AND permission."key" IN ('lease.execution.read', 'move_in.read'))
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- RenameIndex
ALTER INDEX "MarketplaceEnquiry_requestingOrganisationId_status_createdAt_id" RENAME TO "MarketplaceEnquiry_requestingOrganisationId_status_createdA_idx";

-- RenameIndex
ALTER INDEX "ProviderMarketplaceServiceArea_providerId_countryCode_reg_key" RENAME TO "ProviderMarketplaceServiceArea_providerId_countryCode_regio_key";
