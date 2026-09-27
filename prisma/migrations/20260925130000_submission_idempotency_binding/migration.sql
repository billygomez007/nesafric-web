-- Durable link between a public-form submission (Idempotency-Key) and the lead / viewing request it
-- created, written in the same transaction as the row. Lets a retry be reconciled with the original
-- row even after the idempotency record's claim went stale or expired, so a submission can never
-- create a second lead or notification. Nullable columns: existing rows and internal callers
-- (voice, AI, conversations, seed) are unaffected; Postgres unique indexes ignore NULLs.

-- AlterTable
ALTER TABLE "MarketplaceLead" ADD COLUMN "idempotencyFingerprint" TEXT,
ADD COLUMN "idempotencyKeyHash" TEXT;

-- AlterTable
ALTER TABLE "ViewingRequest" ADD COLUMN "idempotencyFingerprint" TEXT,
ADD COLUMN "idempotencyKeyHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceLead_listingId_idempotencyKeyHash_key" ON "MarketplaceLead"("listingId", "idempotencyKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ViewingRequest_listingId_idempotencyKeyHash_key" ON "ViewingRequest"("listingId", "idempotencyKeyHash");
