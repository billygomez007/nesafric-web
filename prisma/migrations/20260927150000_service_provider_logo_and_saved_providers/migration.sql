-- Service Provider Marketplace: provider logo (controlled StorageObject) and user-scoped saved providers.
-- Additive only. Generated with `prisma migrate diff` from the HEAD schema to this schema, because a
-- fresh shadow database cannot replay the existing chain (20260829070919_phase25_service_category_admin_controls
-- references "ProviderDocumentRequirement" before 20260829130000_phase23_property_service_professionals creates it).
-- AlterTable
ALTER TABLE "ServiceProvider" ADD COLUMN     "logoStorageObjectId" UUID;

-- CreateTable
CREATE TABLE "SavedServiceProvider" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedServiceProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedServiceProvider_userId_createdAt_idx" ON "SavedServiceProvider"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SavedServiceProvider_providerId_idx" ON "SavedServiceProvider"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedServiceProvider_userId_providerId_key" ON "SavedServiceProvider"("userId", "providerId");

-- AddForeignKey
ALTER TABLE "ServiceProvider" ADD CONSTRAINT "ServiceProvider_logoStorageObjectId_fkey" FOREIGN KEY ("logoStorageObjectId") REFERENCES "StorageObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedServiceProvider" ADD CONSTRAINT "SavedServiceProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedServiceProvider" ADD CONSTRAINT "SavedServiceProvider_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
