# Rollback for 20261020090000_whatsapp_business_flows

Additive only: no existing column, row or constraint is changed. To roll back after reverting
the application code (data in the new tables and columns is lost):

```sql
DROP TABLE IF EXISTS "WhatsAppFlowDraft";
DROP TABLE IF EXISTS "ProviderPortfolioImage";
ALTER TABLE "ListingMedia" DROP CONSTRAINT IF EXISTS "ListingMedia_sourceMediaId_length_check";
DROP INDEX IF EXISTS "ListingMedia_listingId_sourceMediaId_key";
ALTER TABLE "ListingMedia" DROP COLUMN IF EXISTS "sourceMediaId";
ALTER TABLE "Listing" DROP COLUMN IF EXISTS "revision";
ALTER TABLE "ProviderMarketplaceProfile" DROP COLUMN IF EXISTS "pricingModel";
DROP TYPE IF EXISTS "WhatsAppFlowStatus";
DROP TYPE IF EXISTS "WhatsAppFlowKind";
DROP TYPE IF EXISTS "ProviderPricingModel";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261020090000_whatsapp_business_flows';
```

Portfolio image files remain in object storage under `public/provider-portfolio/…`; delete them
separately if the rollback is permanent.

Also drop the revision triggers before dropping the column:

```sql
DROP TRIGGER IF EXISTS "ListingAmenity_bump_revision" ON "ListingAmenity";
DROP TRIGGER IF EXISTS "ListingMedia_bump_revision" ON "ListingMedia";
DROP TRIGGER IF EXISTS "Listing_bump_revision" ON "Listing";
DROP FUNCTION IF EXISTS "listing_child_bump_revision"();
DROP FUNCTION IF EXISTS "listing_bump_revision"();
```
