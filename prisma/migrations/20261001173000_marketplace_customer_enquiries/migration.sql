-- Allow a signed-in marketplace customer to request a service provider without
-- first creating or joining a PropertyOS management organisation.
--
-- Existing organisation-scoped enquiries remain unchanged. Property and
-- maintenance links still require an organisation at the application layer.
ALTER TABLE "MarketplaceEnquiry"
ALTER COLUMN "requestingOrganisationId" DROP NOT NULL;
