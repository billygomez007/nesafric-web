CREATE TABLE "HomepageCompanyLogo" (
    "id" UUID NOT NULL,
    "marketplaceProfessionalId" UUID NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageCompanyLogo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomepageCompanyLogo_marketplaceProfessionalId_key"
ON "HomepageCompanyLogo"("marketplaceProfessionalId");

CREATE INDEX "HomepageCompanyLogo_isPublished_sortOrder_idx"
ON "HomepageCompanyLogo"("isPublished", "sortOrder");

ALTER TABLE "HomepageCompanyLogo"
ADD CONSTRAINT "HomepageCompanyLogo_marketplaceProfessionalId_fkey"
FOREIGN KEY ("marketplaceProfessionalId")
REFERENCES "MarketplaceProfessional"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "HomepageCompanyLogo"
ADD CONSTRAINT "HomepageCompanyLogo_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId")
REFERENCES "User"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "HomepageCompanyLogo"
ADD CONSTRAINT "HomepageCompanyLogo_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId")
REFERENCES "User"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
