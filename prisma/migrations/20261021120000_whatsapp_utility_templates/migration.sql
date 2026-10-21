-- WhatsApp Utility templates (Phase 1): Meta template state, per-event dispatch ledger, and an
-- explicit WhatsApp opt-in on marketplace enquiries. Additive only; existing rows are unaffected.
ALTER TABLE "MarketplaceLead" ADD COLUMN "whatsappUpdatesConsent" BOOLEAN NOT NULL DEFAULT false;

-- The utility dispatcher scans recent events by name.
CREATE INDEX "DomainEvent_name_occurredAt_idx" ON "DomainEvent"("name", "occurredAt");

CREATE TABLE "WhatsAppTemplateState" (
    "id" UUID NOT NULL,
    "templateKey" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "metaName" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
    "metaTemplateId" TEXT,
    "metaCategory" TEXT,
    "rejectedReason" TEXT,
    "qualityScore" TEXT,
    "submittedAt" TIMESTAMP(3),
    "lastStatusAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppTemplateState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppTemplateState_wabaId_metaName_language_key" ON "WhatsAppTemplateState"("wabaId", "metaName", "language");
CREATE INDEX "WhatsAppTemplateState_templateKey_idx" ON "WhatsAppTemplateState"("templateKey");

CREATE TABLE "WhatsAppUtilityDispatch" (
    "id" UUID NOT NULL,
    "domainEventId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "templateKey" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "messageId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppUtilityDispatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppUtilityDispatch_domainEventId_templateKey_recipient_key" ON "WhatsAppUtilityDispatch"("domainEventId", "templateKey", "recipientKey");
CREATE INDEX "WhatsAppUtilityDispatch_domainEventId_idx" ON "WhatsAppUtilityDispatch"("domainEventId");
CREATE INDEX "WhatsAppUtilityDispatch_organisationId_createdAt_idx" ON "WhatsAppUtilityDispatch"("organisationId", "createdAt");
