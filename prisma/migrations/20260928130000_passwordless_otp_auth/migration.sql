-- Passwordless sign-in (email / SMS one-time codes).
-- Additive and data-preserving: no column or row is dropped, and every existing password hash stays.
-- `email` and `passwordHash` only lose NOT NULL so phone-only / passwordless accounts can exist.

CREATE TYPE "AuthOtpChannel" AS ENUM ('EMAIL', 'SMS');

CREATE TYPE "AuthOtpPurpose" AS ENUM ('LOGIN', 'REGISTER', 'LINK');

CREATE TYPE "AuthOtpVerifier" AS ENUM ('NESAFRIC', 'ARKESEL');

ALTER TABLE "User" ADD COLUMN "phoneE164" TEXT,
ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3),
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- Every account keeps at least one way to be identified; phones are stored only in E.164 form.
ALTER TABLE "User" ADD CONSTRAINT "User_has_identifier_check" CHECK ("email" IS NOT NULL OR "phoneE164" IS NOT NULL);
ALTER TABLE "User" ADD CONSTRAINT "User_phoneE164_format_check" CHECK ("phoneE164" IS NULL OR "phoneE164" ~ '^\+[1-9][0-9]{6,14}$');

CREATE UNIQUE INDEX "User_phoneE164_key" ON "User"("phoneE164");

CREATE TABLE "AuthOtpChallenge" (
    "id" UUID NOT NULL,
    "purpose" "AuthOtpPurpose" NOT NULL,
    "channel" "AuthOtpChannel" NOT NULL,
    "identifierHash" TEXT NOT NULL,
    "verifier" "AuthOtpVerifier" NOT NULL DEFAULT 'NESAFRIC',
    "codeHash" TEXT,
    "userId" UUID,
    "requesterHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "providerReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthOtpChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuthOtpChallenge_identifierHash_createdAt_idx" ON "AuthOtpChallenge"("identifierHash", "createdAt");

CREATE INDEX "AuthOtpChallenge_requesterHash_createdAt_idx" ON "AuthOtpChallenge"("requesterHash", "createdAt");

CREATE INDEX "AuthOtpChallenge_channel_createdAt_idx" ON "AuthOtpChallenge"("channel", "createdAt");

CREATE INDEX "AuthOtpChallenge_expiresAt_idx" ON "AuthOtpChallenge"("expiresAt");

ALTER TABLE "AuthOtpChallenge" ADD CONSTRAINT "AuthOtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
