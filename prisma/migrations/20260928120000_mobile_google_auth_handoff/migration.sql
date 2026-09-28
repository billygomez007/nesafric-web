-- Additive only: one-time mobile Google sign-in handoff codes (hashed at rest).
CREATE TABLE "MobileAuthHandoff" (
    "id" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileAuthHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobileAuthHandoff_codeHash_key" ON "MobileAuthHandoff"("codeHash");

CREATE INDEX "MobileAuthHandoff_expiresAt_idx" ON "MobileAuthHandoff"("expiresAt");

ALTER TABLE "MobileAuthHandoff" ADD CONSTRAINT "MobileAuthHandoff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
