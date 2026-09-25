-- Guest write abuse protection: atomic fixed-window rate-limit counters and idempotency records
-- for unauthenticated public submissions. Additive only; no existing table is modified.

-- CreateTable
CREATE TABLE "PublicWriteCounter" (
    "bucket" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicWriteCounter_pkey" PRIMARY KEY ("bucket","keyHash","windowStart")
);

-- CreateTable
CREATE TABLE "PublicIdempotencyRecord" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicWriteCounter_expiresAt_idx" ON "PublicWriteCounter"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublicIdempotencyRecord_scope_keyHash_key" ON "PublicIdempotencyRecord"("scope", "keyHash");

-- CreateIndex
CREATE INDEX "PublicIdempotencyRecord_expiresAt_idx" ON "PublicIdempotencyRecord"("expiresAt");
