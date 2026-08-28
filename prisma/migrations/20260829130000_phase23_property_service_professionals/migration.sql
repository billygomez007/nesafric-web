-- CreateEnum
CREATE TYPE "ProviderEvidenceReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProviderEvidenceType" ADD VALUE 'GHANA_CARD_FRONT';
ALTER TYPE "ProviderEvidenceType" ADD VALUE 'GHANA_CARD_BACK';
ALTER TYPE "ProviderEvidenceType" ADD VALUE 'TRADE_CERTIFICATE';
ALTER TYPE "ProviderEvidenceType" ADD VALUE 'SAFETY_CERTIFICATION';
ALTER TYPE "ProviderEvidenceType" ADD VALUE 'PORTFOLIO_EVIDENCE';
ALTER TYPE "ProviderEvidenceType" ADD VALUE 'REFERENCE_EVIDENCE';
ALTER TYPE "ProviderEvidenceType" ADD VALUE 'TRAINING_CERTIFICATE';

-- AlterEnum
ALTER TYPE "ProviderVerificationStatus" ADD VALUE 'REQUIRES_MORE_INFORMATION';

-- AlterTable
ALTER TABLE "ProviderEvidence" ADD COLUMN     "idNumberMasked" TEXT,
ADD COLUMN     "nameOnDocument" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewStatus" "ProviderEvidenceReviewStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" UUID,
ADD COLUMN     "supersededByEvidenceId" UUID;

-- AlterTable
ALTER TABLE "ProviderVerificationHistory" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "ServiceProvider" ADD COLUMN     "businessVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "identityVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "skillVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "slug" TEXT;

-- CreateTable
CREATE TABLE "ProviderVerificationConsent" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "accurate" BOOLEAN NOT NULL,
    "authorized" BOOLEAN NOT NULL,
    "reviewConsented" BOOLEAN NOT NULL,
    "termsAccepted" BOOLEAN NOT NULL,
    "acceptedByUserId" UUID NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderVerificationConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderDocumentRequirement" (
    "id" UUID NOT NULL,
    "countryCode" CHAR(2),
    "categoryId" UUID,
    "providerType" "ServiceProviderType",
    "evidenceType" "ProviderEvidenceType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderDocumentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderVerificationConsent_providerId_acceptedAt_idx" ON "ProviderVerificationConsent"("providerId", "acceptedAt");

-- CreateIndex
CREATE INDEX "ProviderDocumentRequirement_countryCode_categoryId_provider_idx" ON "ProviderDocumentRequirement"("countryCode", "categoryId", "providerType", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderDocumentRequirement_countryCode_categoryId_provider_key" ON "ProviderDocumentRequirement"("countryCode", "categoryId", "providerType", "evidenceType");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEvidence_supersededByEvidenceId_key" ON "ProviderEvidence"("supersededByEvidenceId");

-- CreateIndex
CREATE INDEX "ProviderEvidence_providerId_type_reviewStatus_idx" ON "ProviderEvidence"("providerId", "type", "reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceProvider_slug_key" ON "ServiceProvider"("slug");

-- CreateIndex
CREATE INDEX "ServiceProvider_identityVerifiedAt_idx" ON "ServiceProvider"("identityVerifiedAt");

-- AddForeignKey
ALTER TABLE "ProviderEvidence" ADD CONSTRAINT "ProviderEvidence_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEvidence" ADD CONSTRAINT "ProviderEvidence_supersededByEvidenceId_fkey" FOREIGN KEY ("supersededByEvidenceId") REFERENCES "ProviderEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderVerificationConsent" ADD CONSTRAINT "ProviderVerificationConsent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderVerificationConsent" ADD CONSTRAINT "ProviderVerificationConsent_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderDocumentRequirement" ADD CONSTRAINT "ProviderDocumentRequirement_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

