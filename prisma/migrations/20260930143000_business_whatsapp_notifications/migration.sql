-- Business WhatsApp destination, verification, consent and notification preferences.
--
-- Exactly one business subject must own each row:
--   * organisationId for organisations, including marketplace-professional
--     backing organisations and company service providers.
--   * serviceProviderId for individual service providers.

CREATE TABLE "BusinessWhatsAppConfig" (
    "id" UUID NOT NULL,
    "organisationId" UUID,
    "serviceProviderId" UUID,
    "whatsappNumber" TEXT NOT NULL,
    "whatsappVerified" BOOLEAN NOT NULL DEFAULT false,
    "whatsappVerifiedAt" TIMESTAMP(3),
    "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
    "whatsappOptInAt" TIMESTAMP(3),
    "whatsappNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false,

    "inquiryNotifications" BOOLEAN NOT NULL DEFAULT true,
    "viewingNotifications" BOOLEAN NOT NULL DEFAULT true,
    "leadNotifications" BOOLEAN NOT NULL DEFAULT true,
    "savedPropertyNotifications" BOOLEAN NOT NULL DEFAULT true,
    "bookingNotifications" BOOLEAN NOT NULL DEFAULT true,
    "serviceRequestNotifications" BOOLEAN NOT NULL DEFAULT true,
    "messageNotifications" BOOLEAN NOT NULL DEFAULT true,
    "reviewNotifications" BOOLEAN NOT NULL DEFAULT true,
    "accountActivityNotifications" BOOLEAN NOT NULL DEFAULT true,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessWhatsAppConfig_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "BusinessWhatsAppConfig_business_subject_check"
      CHECK (
        (
          "organisationId" IS NOT NULL
          AND "serviceProviderId" IS NULL
        )
        OR
        (
          "organisationId" IS NULL
          AND "serviceProviderId" IS NOT NULL
        )
      ),

    CONSTRAINT "BusinessWhatsAppConfig_verified_state_check"
      CHECK (
        ("whatsappVerified" = false AND "whatsappVerifiedAt" IS NULL)
        OR
        ("whatsappVerified" = true AND "whatsappVerifiedAt" IS NOT NULL)
      ),

    CONSTRAINT "BusinessWhatsAppConfig_opt_in_state_check"
      CHECK (
        ("whatsappOptIn" = false AND "whatsappOptInAt" IS NULL)
        OR
        ("whatsappOptIn" = true AND "whatsappOptInAt" IS NOT NULL)
      ),

    CONSTRAINT "BusinessWhatsAppConfig_enabled_state_check"
      CHECK (
        "whatsappNotificationsEnabled" = false
        OR
        (
          "whatsappVerified" = true
          AND "whatsappVerifiedAt" IS NOT NULL
          AND "whatsappOptIn" = true
          AND "whatsappOptInAt" IS NOT NULL
        )
      )
);

CREATE UNIQUE INDEX "BusinessWhatsAppConfig_organisationId_key"
ON "BusinessWhatsAppConfig"("organisationId");

CREATE UNIQUE INDEX "BusinessWhatsAppConfig_serviceProviderId_key"
ON "BusinessWhatsAppConfig"("serviceProviderId");

CREATE INDEX "BusinessWhatsAppConfig_whatsappNumber_idx"
ON "BusinessWhatsAppConfig"("whatsappNumber");

ALTER TABLE "BusinessWhatsAppConfig"
ADD CONSTRAINT "BusinessWhatsAppConfig_organisationId_fkey"
FOREIGN KEY ("organisationId")
REFERENCES "Organisation"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "BusinessWhatsAppConfig"
ADD CONSTRAINT "BusinessWhatsAppConfig_serviceProviderId_fkey"
FOREIGN KEY ("serviceProviderId")
REFERENCES "ServiceProvider"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- WhatsApp destinations are stored only in canonical E.164 form.
ALTER TABLE "BusinessWhatsAppConfig"
ADD CONSTRAINT "business_whatsapp_number_e164"
CHECK ("whatsappNumber" ~ '^\+[1-9][0-9]{6,14}$');


-- Dedicated business WhatsApp verification challenges.
-- Separate from AuthOtpChallenge because this proves a business notification
-- destination rather than a user's authentication identifier.
CREATE TABLE "BusinessWhatsAppVerificationChallenge" (
    "id" UUID NOT NULL,
    "businessWhatsAppConfigId" UUID NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "requesterHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessWhatsAppVerificationChallenge_pkey"
      PRIMARY KEY ("id"),

    CONSTRAINT "BusinessWhatsAppVerificationChallenge_businessWhatsAppConfigId_fkey"
      FOREIGN KEY ("businessWhatsAppConfigId")
      REFERENCES "BusinessWhatsAppConfig"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE,

    CONSTRAINT "BusinessWhatsAppVerificationChallenge_whatsappNumber_e164_check"
      CHECK ("whatsappNumber" ~ '^\+[1-9][0-9]{6,14}$'),

    CONSTRAINT "BusinessWhatsAppVerificationChallenge_failedAttempts_check"
      CHECK ("failedAttempts" >= 0)
);

CREATE INDEX
  "BusinessWhatsAppVerificationChallenge_businessWhatsAppConfigId_createdAt_idx"
ON "BusinessWhatsAppVerificationChallenge"
  ("businessWhatsAppConfigId", "createdAt");

CREATE INDEX
  "BusinessWhatsAppVerificationChallenge_requesterHash_createdAt_idx"
ON "BusinessWhatsAppVerificationChallenge"
  ("requesterHash", "createdAt");

CREATE INDEX
  "BusinessWhatsAppVerificationChallenge_createdAt_idx"
ON "BusinessWhatsAppVerificationChallenge"
  ("createdAt");
