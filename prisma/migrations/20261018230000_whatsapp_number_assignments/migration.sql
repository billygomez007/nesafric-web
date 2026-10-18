-- AlterTable
ALTER TABLE "MessageDelivery" ADD COLUMN     "whatsappAssignmentId" UUID;

-- CreateTable
CREATE TABLE "WhatsAppNumberAssignment" (
    "id" UUID NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "businessAccountId" TEXT,
    "organisationId" UUID NOT NULL,
    "activePhoneNumberId" TEXT,
    "activeOrganisationId" UUID,
    "official" BOOLEAN NOT NULL DEFAULT false,
    "assignedByPrincipalId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "protectionReleasedAt" TIMESTAMP(3),
    "protectionReleasedByPrincipalId" UUID,

    CONSTRAINT "WhatsAppNumberAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppNumberAssignment_activePhoneNumberId_key" ON "WhatsAppNumberAssignment"("activePhoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppNumberAssignment_activeOrganisationId_key" ON "WhatsAppNumberAssignment"("activeOrganisationId");

-- CreateIndex
CREATE INDEX "WhatsAppNumberAssignment_phoneNumberId_idx" ON "WhatsAppNumberAssignment"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsAppNumberAssignment_organisationId_idx" ON "WhatsAppNumberAssignment"("organisationId");

-- AddForeignKey
ALTER TABLE "WhatsAppNumberAssignment" ADD CONSTRAINT "WhatsAppNumberAssignment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- An assignment is in force exactly while its active columns are set, and they always name the
-- row's own number and organisation. Together with the unique indexes above this gives a number
-- one holder and an organisation one number.
ALTER TABLE "WhatsAppNumberAssignment" ADD CONSTRAINT "WhatsAppNumberAssignment_active_check" CHECK (
  ("activePhoneNumberId" IS NULL OR "activePhoneNumberId" = "phoneNumberId")
  AND ("activeOrganisationId" IS NULL OR "activeOrganisationId" = "organisationId")
  AND (("activePhoneNumberId" IS NULL) = ("activeOrganisationId" IS NULL))
  AND (("activePhoneNumberId" IS NULL) = ("endedAt" IS NOT NULL))
);

-- Only an official number has a protection to release.
ALTER TABLE "WhatsAppNumberAssignment" ADD CONSTRAINT "WhatsAppNumberAssignment_protection_check" CHECK (
  "official" OR "protectionReleasedAt" IS NULL
);
