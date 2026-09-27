-- Listing price units: per day, per square metre and per kilometre, alongside the existing rent
-- periods. Listings get their own enum so leases and rent schedules keep `RentFrequency` unchanged.

CREATE TYPE "ListingPriceUnit" AS ENUM ('DAILY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM', 'PER_SQM', 'PER_KM');

-- Every existing value (MONTHLY, QUARTERLY, ANNUAL, CUSTOM) exists in the new enum, so existing
-- listings keep their exact price unit.
ALTER TABLE "Listing"
  ALTER COLUMN "frequency" TYPE "ListingPriceUnit" USING ("frequency"::text::"ListingPriceUnit");

-- A rental still requires a unit. A sale is either a total price (no unit) or priced per square
-- metre or per kilometre (land, frontage); a sale can never carry a rent period.
ALTER TABLE "Listing" DROP CONSTRAINT "Listing_type_price_check";
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_type_price_check" CHECK (
  ("listingType" = 'RENT' AND "rentAmountMinor" IS NOT NULL AND "askingAmountMinor" IS NULL AND "frequency" IS NOT NULL)
  OR
  ("listingType" = 'SALE' AND "askingAmountMinor" IS NOT NULL AND "rentAmountMinor" IS NULL AND ("frequency" IS NULL OR "frequency" IN ('PER_SQM', 'PER_KM')))
);
