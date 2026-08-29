-- CreateEnum
CREATE TYPE "ServiceCategoryGroup" AS ENUM ('REPAIRS_MAINTENANCE', 'BUILDING_CONSTRUCTION', 'PROPERTY_CARE', 'SECURITY_SYSTEMS', 'DESIGN_PROPERTY_SERVICES', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentRequirementLevel" AS ENUM ('REQUIRED', 'OPTIONAL', 'CONDITIONAL');

-- AlterTable
ALTER TABLE "ProviderDocumentRequirement" ADD COLUMN     "conditionNote" TEXT,
ADD COLUMN     "requirementLevel" "DocumentRequirementLevel" NOT NULL DEFAULT 'REQUIRED';

-- AlterTable
ALTER TABLE "ServiceCategory" ADD COLUMN     "group" "ServiceCategoryGroup" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "onboardingSelectable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "publiclyVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ServiceProvider" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedByUserId" UUID,
ADD COLUMN     "suspensionReason" TEXT;

-- CreateIndex
CREATE INDEX "ServiceCategory_group_sortOrder_idx" ON "ServiceCategory"("group", "sortOrder");

-- AddForeignKey
ALTER TABLE "ServiceProvider" ADD CONSTRAINT "ServiceProvider_suspendedByUserId_fkey" FOREIGN KEY ("suspendedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
