-- One ticket per inbound message: a unique, bounded, per-organisation intake reference.
ALTER TABLE "MaintenanceRequest" ADD COLUMN "intakeReference" TEXT;

-- The application never writes more than 200 characters (`whatsapp:<message id>`); the
-- database guarantees it, so the unique B-tree index can never meet an oversized entry.
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_intakeReference_length_check"
  CHECK ("intakeReference" IS NULL OR char_length("intakeReference") <= 200);

-- Backfill from legacy `classification.sourceMessageId`, which the old schema did not bound:
-- - only JSON strings count; missing, null, numbers and objects get no reference;
-- - a short id in a safe identifier alphabet keeps the exact form new reports use;
-- - any other string maps to a SHA-256 of its full value: deterministic, bounded and
--   collision-safe, so two different legacy values never merge;
-- - when several requests share one value, only the earliest gets the reference and the others
--   keep NULL (they stay intact and visible; they simply carry no idempotency key).
WITH sources AS (
  SELECT "id", "organisationId", "createdAt", "classification"->>'sourceMessageId' AS source
  FROM "MaintenanceRequest"
  WHERE jsonb_typeof("classification"->'sourceMessageId') = 'string'
    AND "classification"->>'sourceMessageId' <> ''
),
mapped AS (
  SELECT "id", "organisationId", "createdAt",
         CASE WHEN char_length(source) <= 180 AND source ~ '^[A-Za-z0-9._:=+/-]+$'
              THEN 'whatsapp:' || source
              ELSE 'whatsapp-sha256:' || encode(sha256(convert_to(source, 'UTF8')), 'hex')
         END AS reference
  FROM sources
),
ranked AS (
  SELECT "id", reference, ROW_NUMBER() OVER (PARTITION BY "organisationId", reference ORDER BY "createdAt", "id") AS n
  FROM mapped
)
UPDATE "MaintenanceRequest" AS request SET "intakeReference" = ranked.reference
FROM ranked WHERE ranked."id" = request."id" AND ranked.n = 1;

CREATE UNIQUE INDEX "MaintenanceRequest_organisationId_intakeReference_key" ON "MaintenanceRequest"("organisationId", "intakeReference");
