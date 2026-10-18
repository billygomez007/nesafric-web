-- Schema/database drift fix for BusinessWhatsAppVerificationChallenge (pre-existing on main).
-- Postgres truncated this foreign key's name to 63 characters, to the same string as an index on
-- the same table, which Prisma's schema cannot express. Renaming the constraint to Prisma's
-- default name is a catalog-only change: no table rewrite, no data change, no lock beyond a brief
-- ACCESS EXCLUSIVE on the table for the rename itself.
ALTER TABLE "BusinessWhatsAppVerificationChallenge"
  RENAME CONSTRAINT "BusinessWhatsAppVerificationChallenge_businessWhatsAppConfigId_"
  TO "BusinessWhatsAppVerificationChallenge_businessWhatsAppConf_fkey";
