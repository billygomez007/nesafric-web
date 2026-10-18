-- Resumable landlord onboarding over WhatsApp, and pending ownership/authority claims.
CREATE TYPE "OnboardingDraftStatus" AS ENUM ('IN_PROGRESS', 'COMMITTING', 'COMMITTED', 'ABANDONED');
CREATE TYPE "PortfolioVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "PortfolioAuthorityClaim" AS ENUM ('OWNER', 'MANAGER');

CREATE TABLE "OnboardingDraft" (
    "id" UUID NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "address" TEXT NOT NULL,
    "userId" UUID,
    "status" "OnboardingDraftStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "step" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "lastMessageId" TEXT,
    "organisationId" UUID,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OnboardingDraft_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OnboardingDraft_channel_address_status_idx" ON "OnboardingDraft"("channel", "address", "status");
CREATE INDEX "OnboardingDraft_userId_idx" ON "OnboardingDraft"("userId");
ALTER TABLE "OnboardingDraft" ADD CONSTRAINT "OnboardingDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnboardingDraft" ADD CONSTRAINT "OnboardingDraft_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PortfolioVerification" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "propertyId" UUID,
    "claimedByUserId" UUID NOT NULL,
    "claim" "PortfolioAuthorityClaim" NOT NULL,
    "status" "PortfolioVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByPrincipalId" UUID,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PortfolioVerification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PortfolioVerification_organisationId_propertyId_key" ON "PortfolioVerification"("organisationId", "propertyId");
CREATE INDEX "PortfolioVerification_status_createdAt_idx" ON "PortfolioVerification"("status", "createdAt");
ALTER TABLE "PortfolioVerification" ADD CONSTRAINT "PortfolioVerification_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PortfolioVerification" ADD CONSTRAINT "PortfolioVerification_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PortfolioVerification" ADD CONSTRAINT "PortfolioVerification_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
