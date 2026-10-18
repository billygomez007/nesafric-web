-- One ticket per inbound message: a unique per-organisation intake reference.
ALTER TABLE "MaintenanceRequest" ADD COLUMN "intakeReference" TEXT;

-- Existing WhatsApp tickets keep their source message as their intake reference. Only the
-- earliest ticket for a message gets it, so the unique index can be created over old data.
WITH ranked AS (
  SELECT "id", "organisationId", "classification"->>'sourceMessageId' AS source,
         ROW_NUMBER() OVER (PARTITION BY "organisationId", "classification"->>'sourceMessageId' ORDER BY "createdAt", "id") AS n
  FROM "MaintenanceRequest"
  WHERE "classification" ? 'sourceMessageId'
)
UPDATE "MaintenanceRequest" AS request SET "intakeReference" = 'whatsapp:' || ranked.source
FROM ranked WHERE ranked."id" = request."id" AND ranked.n = 1;

CREATE UNIQUE INDEX "MaintenanceRequest_organisationId_intakeReference_key" ON "MaintenanceRequest"("organisationId", "intakeReference");
