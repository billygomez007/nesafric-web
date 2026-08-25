-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'TERMINATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RentFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "LeasePartyRole" AS ENUM ('TENANT', 'GUARANTOR', 'OCCUPANT');

-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('NOT_RENEWED', 'PENDING', 'RENEWED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "MoveStatus" AS ENUM ('NOT_MOVED_IN', 'MOVED_IN', 'MOVED_OUT');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "preferredName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantOrganisation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "email" CITEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "countryCode" CHAR(2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "TenantOrganisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lease" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "unitId" UUID,
    "renewedFromLeaseId" UUID,
    "referenceNumber" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "rentAmountMinor" DECIMAL(19,0) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "rentFrequency" "RentFrequency" NOT NULL,
    "customFrequency" TEXT,
    "depositAmountMinor" DECIMAL(19,0),
    "status" "LeaseStatus" NOT NULL DEFAULT 'DRAFT',
    "renewalStatus" "RenewalStatus" NOT NULL DEFAULT 'NOT_RENEWED',
    "moveStatus" "MoveStatus" NOT NULL DEFAULT 'NOT_MOVED_IN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "buildingId" UUID,

    CONSTRAINT "Lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseParty" (
    "id" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "tenantOrganisationId" UUID NOT NULL,
    "role" "LeasePartyRole" NOT NULL DEFAULT 'TENANT',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaseParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseDocument" (
    "id" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseHistory" (
    "id" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "LeaseStatus" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "rentAmountMinor" DECIMAL(19,0) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "rentFrequency" "RentFrequency" NOT NULL,
    "depositAmountMinor" DECIMAL(19,0),
    "notes" TEXT,
    "changedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaseHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantOrganisation_organisationId_archivedAt_idx" ON "TenantOrganisation"("organisationId", "archivedAt");

-- CreateIndex
CREATE INDEX "TenantOrganisation_email_idx" ON "TenantOrganisation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TenantOrganisation_tenantId_organisationId_key" ON "TenantOrganisation"("tenantId", "organisationId");

-- CreateIndex
CREATE INDEX "Lease_organisationId_status_endDate_idx" ON "Lease"("organisationId", "status", "endDate");

-- CreateIndex
CREATE INDEX "Lease_propertyId_unitId_idx" ON "Lease"("propertyId", "unitId");

-- CreateIndex
CREATE INDEX "Lease_renewedFromLeaseId_idx" ON "Lease"("renewedFromLeaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Lease_organisationId_referenceNumber_key" ON "Lease"("organisationId", "referenceNumber");

-- CreateIndex
CREATE INDEX "LeaseParty_tenantOrganisationId_idx" ON "LeaseParty"("tenantOrganisationId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseParty_leaseId_tenantOrganisationId_role_key" ON "LeaseParty"("leaseId", "tenantOrganisationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseDocument_leaseId_fileKey_key" ON "LeaseDocument"("leaseId", "fileKey");

-- CreateIndex
CREATE INDEX "LeaseHistory_leaseId_createdAt_idx" ON "LeaseHistory"("leaseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseHistory_leaseId_version_key" ON "LeaseHistory"("leaseId", "version");

-- AddForeignKey
ALTER TABLE "TenantOrganisation" ADD CONSTRAINT "TenantOrganisation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantOrganisation" ADD CONSTRAINT "TenantOrganisation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_renewedFromLeaseId_fkey" FOREIGN KEY ("renewedFromLeaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseParty" ADD CONSTRAINT "LeaseParty_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseParty" ADD CONSTRAINT "LeaseParty_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseDocument" ADD CONSTRAINT "LeaseDocument_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseHistory" ADD CONSTRAINT "LeaseHistory_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
