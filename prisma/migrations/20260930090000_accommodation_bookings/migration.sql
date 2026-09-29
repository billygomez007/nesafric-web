-- Hotels and short stays (bookable accommodation) + booking requests.
-- Additive only: a new enum value (PER_NIGHT), five nullable Listing columns, a new enum and a new
-- table. Existing listings and every existing query are unaffected. Safe to deploy before the app.

-- CreateEnum
CREATE TYPE "AccommodationBookingStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'DECLINED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ListingPriceUnit" ADD VALUE 'PER_NIGHT';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "checkInTime" TEXT,
ADD COLUMN     "checkOutTime" TEXT,
ADD COLUMN     "houseRules" TEXT,
ADD COLUMN     "maxGuests" INTEGER,
ADD COLUMN     "minimumNights" INTEGER;

-- CreateTable
CREATE TABLE "AccommodationBooking" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "organisationId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "userId" UUID,
    "accommodationType" TEXT NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "nights" INTEGER NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL DEFAULT 0,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "guestPhone" TEXT,
    "specialRequest" TEXT,
    "nightlyPriceMinor" DECIMAL(19,0),
    "currencyCode" CHAR(3) NOT NULL,
    "status" "AccommodationBookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "respondedAt" TIMESTAMP(3),
    "respondedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKeyHash" TEXT,
    "idempotencyFingerprint" TEXT,

    CONSTRAINT "AccommodationBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccommodationBooking_reference_key" ON "AccommodationBooking"("reference");

-- CreateIndex
CREATE INDEX "AccommodationBooking_organisationId_status_createdAt_idx" ON "AccommodationBooking"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AccommodationBooking_listingId_createdAt_idx" ON "AccommodationBooking"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "AccommodationBooking_userId_createdAt_idx" ON "AccommodationBooking"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccommodationBooking_listingId_idempotencyKeyHash_key" ON "AccommodationBooking"("listingId", "idempotencyKeyHash");

-- AddForeignKey
ALTER TABLE "AccommodationBooking" ADD CONSTRAINT "AccommodationBooking_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccommodationBooking" ADD CONSTRAINT "AccommodationBooking_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccommodationBooking" ADD CONSTRAINT "AccommodationBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

