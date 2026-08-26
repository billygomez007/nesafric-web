CREATE OR REPLACE FUNCTION enforce_listing_status_history() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ListingStatusHistory"
    WHERE "listingId" = NEW."id"
      AND "fromStatus" = OLD."status"
      AND "toStatus" = NEW."status"
      AND "createdAt" >= transaction_timestamp() - INTERVAL '1 millisecond'
  ) THEN
    RAISE EXCEPTION 'listing status changes require immutable status history';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_listing_verification_history() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ListingVerificationHistory"
    WHERE "listingId" = NEW."id"
      AND "fromStatus" = OLD."verificationStatus"
      AND "toStatus" = NEW."verificationStatus"
      AND "createdAt" >= transaction_timestamp() - INTERVAL '1 millisecond'
  ) THEN
    RAISE EXCEPTION 'listing verification changes require immutable verification history';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_lead_status_history() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "MarketplaceLeadStatusHistory"
    WHERE "leadId" = NEW."id"
      AND "fromStatus" = OLD."status"
      AND "toStatus" = NEW."status"
      AND "createdAt" >= transaction_timestamp() - INTERVAL '1 millisecond'
  ) THEN
    RAISE EXCEPTION 'lead status changes require immutable status history';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_viewing_status_history() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ViewingRequestStatusHistory"
    WHERE "viewingRequestId" = NEW."id"
      AND "fromStatus" = OLD."status"
      AND "toStatus" = NEW."status"
      AND "createdAt" >= transaction_timestamp() - INTERVAL '1 millisecond'
  ) THEN
    RAISE EXCEPTION 'viewing status changes require immutable status history';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
