-- Property Services taxonomy hierarchy.
--
-- This migration is intentionally additive.
-- Existing ServiceCategory rows keep their IDs and keys.
-- Existing ServiceProviderCategory and ProviderDocumentRequirement
-- relationships therefore remain intact.

ALTER TABLE "ServiceCategory"
ADD COLUMN "parentId" UUID;

CREATE INDEX "ServiceCategory_parentId_sortOrder_idx"
ON "ServiceCategory"("parentId", "sortOrder");

ALTER TABLE "ServiceCategory"
ADD CONSTRAINT "ServiceCategory_parentId_fkey"
FOREIGN KEY ("parentId")
REFERENCES "ServiceCategory"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
