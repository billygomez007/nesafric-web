-- CreateEnum
CREATE TYPE "StorageClassification" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "StorageOrigin" AS ENUM ('UPLOADED', 'GENERATED');

-- CreateEnum
CREATE TYPE "MalwareScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "StorageArchiveAction" AS ENUM ('ARCHIVED', 'RESTORED');

-- CreateEnum
CREATE TYPE "GeneratedDocumentType" AS ENUM ('RECEIPT', 'TENANT_STATEMENT', 'MOVE_OUT_STATEMENT', 'LEASE_AGREEMENT');

-- CreateEnum
CREATE TYPE "SignatureEventStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'MISMATCHED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "GeocodeStatus" AS ENUM ('NOT_ATTEMPTED', 'OK', 'NOT_FOUND', 'ERROR', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('VIEWING', 'MOVE_IN', 'MOVE_OUT', 'INSPECTION', 'MAINTENANCE_APPOINTMENT');

-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('SCHEDULED', 'UPDATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CalendarSyncStatus" AS ENUM ('NOT_APPLICABLE', 'SYNCED', 'PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('STORAGE', 'ESIGNATURE', 'GEOCODING', 'CALENDAR', 'MALWARE_SCAN');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONNECTED', 'DEGRADED', 'ERROR');

-- AlterTable
ALTER TABLE "LeaseSignatureRequest" ADD COLUMN     "signingUrl" TEXT;

-- AlterTable
ALTER TABLE "ListingMedia" ADD COLUMN     "classification" "StorageClassification" NOT NULL DEFAULT 'PUBLIC',
ADD COLUMN     "isCover" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "geocodeStatus" "GeocodeStatus" NOT NULL DEFAULT 'NOT_ATTEMPTED',
ADD COLUMN     "geocodedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StorageObject" (
    "id" UUID NOT NULL,
    "organisationId" UUID,
    "storageKey" TEXT NOT NULL,
    "origin" "StorageOrigin" NOT NULL,
    "classification" "StorageClassification" NOT NULL DEFAULT 'PRIVATE',
    "targetType" TEXT NOT NULL,
    "targetId" UUID,
    "originalFileName" TEXT NOT NULL,
    "safeFileName" TEXT NOT NULL,
    "declaredContentType" TEXT,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedByUserId" UUID,
    "malwareScanStatus" "MalwareScanStatus" NOT NULL DEFAULT 'SKIPPED',
    "malwareScanDetail" TEXT,
    "malwareScannedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" UUID,
    "archiveReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageObjectHistory" (
    "id" UUID NOT NULL,
    "storageObjectId" UUID NOT NULL,
    "actorUserId" UUID,
    "action" "StorageArchiveAction" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageObjectHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "storageObjectId" UUID NOT NULL,
    "documentType" "GeneratedDocumentType" NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "dataHash" TEXT NOT NULL,
    "leaseId" UUID,
    "tenantOrganisationId" UUID,
    "propertyId" UUID,
    "generatedByUserId" UUID,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "documentType" "GeneratedDocumentType" NOT NULL,
    "name" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureProviderEvent" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "providerKey" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "signatureRequestId" UUID,
    "status" "SignatureEventStatus" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SignatureProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeocodeLookup" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "propertyId" UUID,
    "provider" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL,
    "status" "GeocodeStatus" NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "precision" TEXT,
    "providerReference" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeocodeLookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "type" "CalendarEventType" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "location" TEXT,
    "attendees" JSONB NOT NULL DEFAULT '[]',
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "providerKey" TEXT NOT NULL DEFAULT 'INTERNAL',
    "providerEventId" TEXT,
    "syncStatus" "CalendarSyncStatus" NOT NULL DEFAULT 'SYNCED',
    "lastSyncError" TEXT,
    "lastSyncAttemptAt" TIMESTAMP(3),
    "createdByUserId" UUID,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "integrationType" "IntegrationType" NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageObject_storageKey_key" ON "StorageObject"("storageKey");

-- CreateIndex
CREATE INDEX "StorageObject_organisationId_targetType_targetId_idx" ON "StorageObject"("organisationId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "StorageObject_organisationId_classification_archivedAt_idx" ON "StorageObject"("organisationId", "classification", "archivedAt");

-- CreateIndex
CREATE INDEX "StorageObject_organisationId_createdAt_idx" ON "StorageObject"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "StorageObjectHistory_storageObjectId_createdAt_idx" ON "StorageObjectHistory"("storageObjectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedDocument_storageObjectId_key" ON "GeneratedDocument"("storageObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedDocument_referenceNumber_key" ON "GeneratedDocument"("referenceNumber");

-- CreateIndex
CREATE INDEX "GeneratedDocument_organisationId_documentType_sourceType_so_idx" ON "GeneratedDocument"("organisationId", "documentType", "sourceType", "sourceId", "version");

-- CreateIndex
CREATE INDEX "GeneratedDocument_leaseId_idx" ON "GeneratedDocument"("leaseId");

-- CreateIndex
CREATE INDEX "GeneratedDocument_tenantOrganisationId_idx" ON "GeneratedDocument"("tenantOrganisationId");

-- CreateIndex
CREATE INDEX "GeneratedDocument_propertyId_idx" ON "GeneratedDocument"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedDocument_organisationId_documentType_sourceType_so_key" ON "GeneratedDocument"("organisationId", "documentType", "sourceType", "sourceId", "dataHash");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_organisationId_documentType_key" ON "DocumentTemplate"("organisationId", "documentType");

-- CreateIndex
CREATE INDEX "SignatureProviderEvent_organisationId_receivedAt_idx" ON "SignatureProviderEvent"("organisationId", "receivedAt");

-- CreateIndex
CREATE INDEX "SignatureProviderEvent_signatureRequestId_idx" ON "SignatureProviderEvent"("signatureRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureProviderEvent_providerKey_eventKey_key" ON "SignatureProviderEvent"("providerKey", "eventKey");

-- CreateIndex
CREATE INDEX "GeocodeLookup_organisationId_queryHash_idx" ON "GeocodeLookup"("organisationId", "queryHash");

-- CreateIndex
CREATE INDEX "GeocodeLookup_propertyId_createdAt_idx" ON "GeocodeLookup"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_organisationId_startAt_idx" ON "CalendarEvent"("organisationId", "startAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_organisationId_type_status_idx" ON "CalendarEvent"("organisationId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_organisationId_sourceType_sourceId_type_key" ON "CalendarEvent"("organisationId", "sourceType", "sourceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConfig_organisationId_integrationType_key" ON "IntegrationConfig"("organisationId", "integrationType");

-- AddForeignKey
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageObjectHistory" ADD CONSTRAINT "StorageObjectHistory_storageObjectId_fkey" FOREIGN KEY ("storageObjectId") REFERENCES "StorageObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageObjectHistory" ADD CONSTRAINT "StorageObjectHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_storageObjectId_fkey" FOREIGN KEY ("storageObjectId") REFERENCES "StorageObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureProviderEvent" ADD CONSTRAINT "SignatureProviderEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureProviderEvent" ADD CONSTRAINT "SignatureProviderEvent_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "LeaseSignatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeocodeLookup" ADD CONSTRAINT "GeocodeLookup_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeocodeLookup" ADD CONSTRAINT "GeocodeLookup_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConfig" ADD CONSTRAINT "IntegrationConfig_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConfig" ADD CONSTRAINT "IntegrationConfig_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
