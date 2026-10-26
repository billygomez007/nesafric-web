-- AlterTable
ALTER TABLE "PlatformPrincipal" ADD COLUMN     "whatsappPinFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whatsappPinHash" TEXT,
ADD COLUMN     "whatsappPinLockedUntil" TIMESTAMP(3),
ADD COLUMN     "whatsappUnlockedUntil" TIMESTAMP(3);
