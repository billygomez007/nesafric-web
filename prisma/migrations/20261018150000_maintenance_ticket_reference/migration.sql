-- Ticket references and intake details for maintenance requests.
ALTER TABLE "MaintenanceRequest"
  ADD COLUMN "referenceNumber" TEXT,
  ADD COLUMN "intakeChannel" TEXT,
  ADD COLUMN "originalReport" TEXT,
  ADD COLUMN "classification" JSONB;

CREATE TABLE "OrganisationCounter" (
    "organisationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganisationCounter_pkey" PRIMARY KEY ("organisationId", "key")
);
ALTER TABLE "OrganisationCounter" ADD CONSTRAINT "OrganisationCounter_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Number existing requests per organisation in creation order, starting at NM-1001.
WITH numbered AS (
  SELECT "id", "organisationId", 1000 + ROW_NUMBER() OVER (PARTITION BY "organisationId" ORDER BY "createdAt", "id") AS n
  FROM "MaintenanceRequest"
)
UPDATE "MaintenanceRequest" AS request SET "referenceNumber" = 'NM-' || numbered.n
FROM numbered WHERE numbered."id" = request."id";

INSERT INTO "OrganisationCounter" ("organisationId", "key", "value", "updatedAt")
SELECT "organisationId", 'maintenance_request', 1000 + COUNT(*), CURRENT_TIMESTAMP
FROM "MaintenanceRequest" GROUP BY "organisationId";

CREATE UNIQUE INDEX "MaintenanceRequest_organisationId_referenceNumber_key" ON "MaintenanceRequest"("organisationId", "referenceNumber");
