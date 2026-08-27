-- CreateEnum
CREATE TYPE "MarketplaceProfessionalType" AS ENUM ('INDIVIDUAL_AGENT', 'BROKER', 'BROKERAGE', 'REAL_ESTATE_COMPANY', 'DEVELOPER', 'PROPERTY_MARKETING_COMPANY', 'OTHER');

-- CreateEnum
CREATE TYPE "MarketplaceProfessionalStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MarketplaceVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MarketplaceMemberRole" AS ENUM ('OWNER', 'ADMIN', 'AGENT');

-- CreateEnum
CREATE TYPE "MarketplaceMemberStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ListingAuthority" AS ENUM ('OWNER_SELF', 'PROPERTY_MANAGER', 'MANAGING_AGENT', 'BROKERAGE_AUTHORIZED', 'DEVELOPER', 'THIRD_PARTY_AUTHORIZED');

-- CreateEnum
CREATE TYPE "DevelopmentStatus" AS ENUM ('PLANNING', 'UNDER_CONSTRUCTION', 'COMPLETED', 'HANDED_OVER', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DevelopmentUnitStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'SOLD', 'RENTED', 'UNAVAILABLE');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "developmentId" UUID,
ADD COLUMN     "developmentUnitId" UUID,
ADD COLUMN     "listingAuthority" "ListingAuthority",
ADD COLUMN     "listingRepresentativeUserId" UUID,
ADD COLUMN     "marketplaceProfessionalId" UUID;

-- Keep the existing Phase 21 workspace-isolation fields represented in fresh databases. This
-- does not provision or enable AI functionality; it only makes the migration match the schema.
ALTER TABLE "AIEmployee" ALTER COLUMN "organisationId" DROP NOT NULL,
ADD COLUMN "marketplaceProfessionalId" UUID;

-- CreateTable
CREATE TABLE "MarketplaceProfessional" (
    "id" UUID NOT NULL,
    "backingOrganisationId" UUID NOT NULL,
    "type" "MarketplaceProfessionalType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "description" TEXT,
    "websiteUrl" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "countryCode" CHAR(2) NOT NULL,
    "specialities" TEXT[],
    "servicesOffered" TEXT[],
    "serviceAreas" TEXT[],
    "status" "MarketplaceProfessionalStatus" NOT NULL DEFAULT 'ACTIVE',
    "verificationStatus" "MarketplaceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verificationEvidenceReferences" TEXT[],
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "MarketplaceProfessional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceProfessionalMember" (
    "id" UUID NOT NULL,
    "marketplaceProfessionalId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MarketplaceMemberRole" NOT NULL,
    "status" "MarketplaceMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceProfessionalMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceProfessionalVerificationEvent" (
    "id" UUID NOT NULL,
    "marketplaceProfessionalId" UUID NOT NULL,
    "fromStatus" "MarketplaceVerificationStatus",
    "toStatus" "MarketplaceVerificationStatus" NOT NULL,
    "reason" TEXT,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceProfessionalVerificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Development" (
    "id" UUID NOT NULL,
    "marketplaceProfessionalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "DevelopmentStatus" NOT NULL DEFAULT 'PLANNING',
    "countryCode" CHAR(2) NOT NULL,
    "region" TEXT,
    "city" TEXT,
    "district" TEXT,
    "addressLine1" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "amenities" TEXT[],
    "mediaUrls" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Development_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevelopmentUnit" (
    "id" UUID NOT NULL,
    "developmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unitType" TEXT,
    "status" "DevelopmentUnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "bedrooms" INTEGER,
    "bathrooms" DECIMAL(4,1),
    "sizeSqm" DECIMAL(12,2),
    "priceMinor" DECIMAL(19,0),
    "currencyCode" CHAR(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "DevelopmentUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplacePlan" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplacePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplacePlanPrice" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "amountMinor" DECIMAL(19,0) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplacePlanPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplacePlanEntitlement" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "featureKey" TEXT NOT NULL,
    "kind" "EntitlementKind" NOT NULL,
    "booleanValue" BOOLEAN,
    "limitValue" BIGINT,
    "isUnlimited" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MarketplacePlanEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceSubscription" (
    "id" UUID NOT NULL,
    "marketplaceProfessionalId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "currencyCode" CHAR(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceProfessional_backingOrganisationId_key" ON "MarketplaceProfessional"("backingOrganisationId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceProfessional_slug_key" ON "MarketplaceProfessional"("slug");

-- CreateIndex
CREATE INDEX "MarketplaceProfessional_type_status_idx" ON "MarketplaceProfessional"("type", "status");

-- CreateIndex
CREATE INDEX "MarketplaceProfessional_verificationStatus_idx" ON "MarketplaceProfessional"("verificationStatus");

-- CreateIndex
CREATE INDEX "MarketplaceProfessional_countryCode_idx" ON "MarketplaceProfessional"("countryCode");

-- CreateIndex
CREATE INDEX "MarketplaceProfessionalMember_userId_status_idx" ON "MarketplaceProfessionalMember"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceProfessionalMember_marketplaceProfessionalId_use_key" ON "MarketplaceProfessionalMember"("marketplaceProfessionalId", "userId");

-- CreateIndex
CREATE INDEX "MarketplaceProfessionalVerificationEvent_marketplaceProfess_idx" ON "MarketplaceProfessionalVerificationEvent"("marketplaceProfessionalId", "createdAt");

-- CreateIndex
CREATE INDEX "Development_marketplaceProfessionalId_status_idx" ON "Development"("marketplaceProfessionalId", "status");

-- CreateIndex
CREATE INDEX "Development_countryCode_city_idx" ON "Development"("countryCode", "city");

-- CreateIndex
CREATE INDEX "DevelopmentUnit_developmentId_status_idx" ON "DevelopmentUnit"("developmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplacePlan_key_key" ON "MarketplacePlan"("key");

-- CreateIndex
CREATE INDEX "MarketplacePlan_isActive_isPublic_sortOrder_idx" ON "MarketplacePlan"("isActive", "isPublic", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplacePlanPrice_planId_currencyCode_billingCycle_key" ON "MarketplacePlanPrice"("planId", "currencyCode", "billingCycle");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplacePlanEntitlement_planId_featureKey_key" ON "MarketplacePlanEntitlement"("planId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceSubscription_marketplaceProfessionalId_key" ON "MarketplaceSubscription"("marketplaceProfessionalId");

-- CreateIndex
CREATE INDEX "MarketplaceSubscription_status_idx" ON "MarketplaceSubscription"("status");

-- CreateIndex
CREATE INDEX "MarketplaceSubscription_planId_idx" ON "MarketplaceSubscription"("planId");

-- CreateIndex
CREATE INDEX "Listing_marketplaceProfessionalId_status_idx" ON "Listing"("marketplaceProfessionalId", "status");

CREATE UNIQUE INDEX "AIEmployee_marketplaceProfessionalId_name_key" ON "AIEmployee"("marketplaceProfessionalId", "name");
CREATE INDEX "AIEmployee_marketplaceProfessionalId_status_role_idx" ON "AIEmployee"("marketplaceProfessionalId", "status", "role");

-- CreateIndex
CREATE INDEX "Listing_developmentId_idx" ON "Listing"("developmentId");

-- CreateIndex
CREATE INDEX "Listing_developmentUnitId_idx" ON "Listing"("developmentUnitId");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_marketplaceProfessionalId_fkey" FOREIGN KEY ("marketplaceProfessionalId") REFERENCES "MarketplaceProfessional"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_listingRepresentativeUserId_fkey" FOREIGN KEY ("listingRepresentativeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_developmentId_fkey" FOREIGN KEY ("developmentId") REFERENCES "Development"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_developmentUnitId_fkey" FOREIGN KEY ("developmentUnitId") REFERENCES "DevelopmentUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProfessional" ADD CONSTRAINT "MarketplaceProfessional_backingOrganisationId_fkey" FOREIGN KEY ("backingOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProfessional" ADD CONSTRAINT "MarketplaceProfessional_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProfessionalMember" ADD CONSTRAINT "MarketplaceProfessionalMember_marketplaceProfessionalId_fkey" FOREIGN KEY ("marketplaceProfessionalId") REFERENCES "MarketplaceProfessional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProfessionalMember" ADD CONSTRAINT "MarketplaceProfessionalMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProfessionalVerificationEvent" ADD CONSTRAINT "MarketplaceProfessionalVerificationEvent_marketplaceProfes_fkey" FOREIGN KEY ("marketplaceProfessionalId") REFERENCES "MarketplaceProfessional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProfessionalVerificationEvent" ADD CONSTRAINT "MarketplaceProfessionalVerificationEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Development" ADD CONSTRAINT "Development_marketplaceProfessionalId_fkey" FOREIGN KEY ("marketplaceProfessionalId") REFERENCES "MarketplaceProfessional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentUnit" ADD CONSTRAINT "DevelopmentUnit_developmentId_fkey" FOREIGN KEY ("developmentId") REFERENCES "Development"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplacePlanPrice" ADD CONSTRAINT "MarketplacePlanPrice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketplacePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplacePlanEntitlement" ADD CONSTRAINT "MarketplacePlanEntitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketplacePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceSubscription" ADD CONSTRAINT "MarketplaceSubscription_marketplaceProfessionalId_fkey" FOREIGN KEY ("marketplaceProfessionalId") REFERENCES "MarketplaceProfessional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AIEmployee" ADD CONSTRAINT "AIEmployee_marketplaceProfessionalId_fkey" FOREIGN KEY ("marketplaceProfessionalId") REFERENCES "MarketplaceProfessional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AIEmployee" ADD CONSTRAINT "AIEmployee_exactly_one_workspace_check" CHECK ((("organisationId" IS NOT NULL)::integer + ("marketplaceProfessionalId" IS NOT NULL)::integer) = 1);

-- AddForeignKey
ALTER TABLE "MarketplaceSubscription" ADD CONSTRAINT "MarketplaceSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketplacePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
