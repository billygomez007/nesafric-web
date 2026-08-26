ALTER TABLE "SecurityDeposit" ADD COLUMN "idempotencyKey" TEXT;

UPDATE "SecurityDeposit"
SET "idempotencyKey" = "internalReference"
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "SecurityDeposit" ALTER COLUMN "idempotencyKey" SET NOT NULL;
CREATE UNIQUE INDEX "SecurityDeposit_organisationId_idempotencyKey_key"
  ON "SecurityDeposit"("organisationId", "idempotencyKey");

INSERT INTO "FinancialLedgerEntry" (
  "id",
  "organisationId",
  "propertyId",
  "unitId",
  "leaseId",
  "rentObligationId",
  "type",
  "direction",
  "amountMinor",
  "currencyCode",
  "effectiveAt",
  "reference",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  obligation."organisationId",
  obligation."propertyId",
  obligation."unitId",
  obligation."leaseId",
  obligation."id",
  'RENT_CHARGE',
  'DEBIT',
  obligation."amountMinor",
  obligation."currencyCode",
  obligation."dueDate",
  'RENT-' || obligation."id",
  CURRENT_TIMESTAMP
FROM "RentObligation" obligation
WHERE obligation."status" <> 'CANCELLED'
ON CONFLICT ("rentObligationId", "type") DO NOTHING;
