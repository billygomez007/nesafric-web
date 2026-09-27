CREATE TABLE "TenantAccessInvitation" (
    "id" UUID NOT NULL,
    "tenantOrganisationId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "redeemedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "TenantAccessInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantAccessInvitation_tokenHash_key"
ON "TenantAccessInvitation"("tokenHash");

CREATE INDEX "TenantAccessInvitation_tenantOrganisationId_createdAt_idx"
ON "TenantAccessInvitation"("tenantOrganisationId", "createdAt");

CREATE INDEX "TenantAccessInvitation_tenantOrg_status_expiry_idx"
ON "TenantAccessInvitation"(
    "tenantOrganisationId",
    "revokedAt",
    "redeemedAt",
    "expiresAt"
);

CREATE INDEX "TenantAccessInvitation_createdByUserId_idx"
ON "TenantAccessInvitation"("createdByUserId");

CREATE INDEX "TenantAccessInvitation_redeemedByUserId_idx"
ON "TenantAccessInvitation"("redeemedByUserId");

ALTER TABLE "TenantAccessInvitation"
ADD CONSTRAINT "TenantAccessInvitation_tenantOrganisationId_fkey"
FOREIGN KEY ("tenantOrganisationId")
REFERENCES "TenantOrganisation"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "TenantAccessInvitation"
ADD CONSTRAINT "TenantAccessInvitation_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId")
REFERENCES "User"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "TenantAccessInvitation"
ADD CONSTRAINT "TenantAccessInvitation_redeemedByUserId_fkey"
FOREIGN KEY ("redeemedByUserId")
REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
