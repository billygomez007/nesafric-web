-- CreateEnum
CREATE TYPE "MarketplaceProfessionalDocumentType" AS ENUM ('BUSINESS_REGISTRATION_CERTIFICATE', 'GHANA_CARD_FRONT', 'GHANA_CARD_BACK');

-- CreateTable
CREATE TABLE "MarketplaceProfessionalDocument" (
    "id" UUID NOT NULL,
    "marketplaceProfessionalId" UUID NOT NULL,
    "type" "MarketplaceProfessionalDocumentType" NOT NULL,
    "storageObjectId" UUID NOT NULL,
    "sourceMediaId" TEXT,
    "submittedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceProfessionalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceProfessionalDocument_storageObjectId_key" ON "MarketplaceProfessionalDocument"("storageObjectId");

-- CreateIndex
CREATE INDEX "MarketplaceProfessionalDocument_marketplaceProfessionalId_t_idx" ON "MarketplaceProfessionalDocument"("marketplaceProfessionalId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceProfessionalDocument_marketplaceProfessionalId_s_key" ON "MarketplaceProfessionalDocument"("marketplaceProfessionalId", "sourceMediaId");

-- AddForeignKey
ALTER TABLE "MarketplaceProfessionalDocument" ADD CONSTRAINT "MarketplaceProfessionalDocument_marketplaceProfessionalId_fkey" FOREIGN KEY ("marketplaceProfessionalId") REFERENCES "MarketplaceProfessional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProfessionalDocument" ADD CONSTRAINT "MarketplaceProfessionalDocument_storageObjectId_fkey" FOREIGN KEY ("storageObjectId") REFERENCES "StorageObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProfessionalDocument" ADD CONSTRAINT "MarketplaceProfessionalDocument_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

