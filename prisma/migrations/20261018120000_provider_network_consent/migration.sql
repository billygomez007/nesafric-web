-- Private provider network: explicit provider consent, scope and spending settings.
ALTER TYPE "ChannelIdentityVerification" ADD VALUE 'WHATSAPP_REPLY';

-- Existing directory entries keep working as before, but have no recorded consent
-- (consentedAt NULL), so they are never used for automatic dispatch.
ALTER TABLE "ProviderOrganisation"
  ADD COLUMN "consentedAt" TIMESTAMP(3),
  ADD COLUMN "consentMethod" TEXT,
  ADD COLUMN "scopeCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "allPropertiesScope" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "autoDispatchAllowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "spendingLimitMinor" BIGINT,
  ADD COLUMN "emergencyCallouts" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "workingHours" TEXT,
  ADD COLUMN "paymentTerms" TEXT;

CREATE TABLE "ProviderPropertyScope" (
    "id" UUID NOT NULL,
    "providerOrganisationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderPropertyScope_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderPropertyScope_providerOrganisationId_propertyId_key" ON "ProviderPropertyScope"("providerOrganisationId", "propertyId");
CREATE INDEX "ProviderPropertyScope_propertyId_idx" ON "ProviderPropertyScope"("propertyId");
ALTER TABLE "ProviderPropertyScope" ADD CONSTRAINT "ProviderPropertyScope_providerOrganisationId_fkey" FOREIGN KEY ("providerOrganisationId") REFERENCES "ProviderOrganisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderPropertyScope" ADD CONSTRAINT "ProviderPropertyScope_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "ProviderInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

CREATE TABLE "ProviderNetworkInvitation" (
    "id" UUID NOT NULL,
    "landlordOrganisationId" UUID NOT NULL,
    "invitedByUserId" UUID NOT NULL,
    "existingProviderId" UUID,
    "displayName" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "scopeCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "propertyIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "autoDispatchAllowed" BOOLEAN NOT NULL DEFAULT false,
    "spendingLimitMinor" BIGINT,
    "emergencyCallouts" BOOLEAN NOT NULL DEFAULT false,
    "workingHours" TEXT,
    "paymentTerms" TEXT,
    "status" "ProviderInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "sourceReference" TEXT,
    "messageId" UUID,
    "deliveryFailureReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "providerOrganisationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderNetworkInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderNetworkInvitation_sourceReference_key" ON "ProviderNetworkInvitation"("sourceReference");
CREATE INDEX "ProviderNetworkInvitation_phoneE164_status_idx" ON "ProviderNetworkInvitation"("phoneE164", "status");
CREATE INDEX "ProviderNetworkInvitation_landlordOrganisationId_status_idx" ON "ProviderNetworkInvitation"("landlordOrganisationId", "status");
ALTER TABLE "ProviderNetworkInvitation" ADD CONSTRAINT "ProviderNetworkInvitation_landlordOrganisationId_fkey" FOREIGN KEY ("landlordOrganisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderNetworkInvitation" ADD CONSTRAINT "ProviderNetworkInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderNetworkInvitation" ADD CONSTRAINT "ProviderNetworkInvitation_existingProviderId_fkey" FOREIGN KEY ("existingProviderId") REFERENCES "ServiceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderNetworkInvitation" ADD CONSTRAINT "ProviderNetworkInvitation_providerOrganisationId_fkey" FOREIGN KEY ("providerOrganisationId") REFERENCES "ProviderOrganisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
