-- Rename-only alignment with prisma/schema.prisma. No data or column types change.
-- Postgres truncated these generated names to 63 characters when they were created, so the
-- names Prisma expects never matched and a freshly built database failed the drift check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BusinessWhatsAppVerificationChallenge_businessWhatsAppConfigId_') THEN
    ALTER TABLE "BusinessWhatsAppVerificationChallenge" RENAME CONSTRAINT "BusinessWhatsAppVerificationChallenge_businessWhatsAppConfigId_" TO "BusinessWhatsAppVerificationChallenge_businessWhatsAppConf_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'BusinessWhatsAppVerificationChallenge_businessWhatsAppConfigId_' AND relkind = 'i') THEN
    ALTER INDEX "BusinessWhatsAppVerificationChallenge_businessWhatsAppConfigId_" RENAME TO "BusinessWhatsAppVerificationChallenge_businessWhatsAppConfi_idx";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'BusinessWhatsAppVerificationChallenge_requesterHash_createdAt_i' AND relkind = 'i') THEN
    ALTER INDEX "BusinessWhatsAppVerificationChallenge_requesterHash_createdAt_i" RENAME TO "BusinessWhatsAppVerificationChallenge_requesterHash_created_idx";
  END IF;
END $$;
