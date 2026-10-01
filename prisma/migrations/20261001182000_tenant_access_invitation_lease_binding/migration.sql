ALTER TABLE "TenantAccessInvitation"
ADD COLUMN "leaseId" UUID;

CREATE INDEX "TenantAccessInvitation_leaseId_idx"
ON "TenantAccessInvitation"("leaseId");

ALTER TABLE "TenantAccessInvitation"
ADD CONSTRAINT "TenantAccessInvitation_leaseId_fkey"
FOREIGN KEY ("leaseId") REFERENCES "Lease"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
