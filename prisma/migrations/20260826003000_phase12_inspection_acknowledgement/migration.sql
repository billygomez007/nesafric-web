CREATE OR REPLACE FUNCTION prevent_completed_move_out_inspection_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."completedAt" IS NOT NULL THEN
    IF OLD."tenantAcknowledged" = false AND NEW."tenantAcknowledged" = true
      AND NEW."tenantAcknowledgedAt" IS NOT NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'completed move-out inspections are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
