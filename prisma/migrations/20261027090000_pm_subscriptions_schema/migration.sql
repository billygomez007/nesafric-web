-- CreateEnum
CREATE TYPE "SubscriptionCheckoutStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_TRIAL_STARTED';
ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_TRIAL_REMINDER';
ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_EXPIRED';
ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_PLAN_SELECTED';
ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_PAYMENT_FAILED';
ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_RENEWED';
ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_CANCELLED';
ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_UNIT_LIMIT_REACHED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PAYMENT_PENDING';

-- AlterTable
ALTER TABLE "OrganisationSubscription" ADD COLUMN     "expiredAt" TIMESTAMP(3),
ADD COLUMN     "managementActivatedAt" TIMESTAMP(3),
ADD COLUMN     "selectedPlanId" UUID,
ADD COLUMN     "trialStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SubscriptionCheckout" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "amountMinor" DECIMAL(19,0) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "billingProviderKey" TEXT NOT NULL,
    "providerCheckoutRef" TEXT,
    "checkoutUrl" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "SubscriptionCheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "createdByUserId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementTrialGrant" (
    "id" UUID NOT NULL,
    "organisationId" UUID,
    "grantedToUserId" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementTrialGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementTrialIdentity" (
    "id" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "identityHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementTrialIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionCheckout_organisationId_status_idx" ON "SubscriptionCheckout"("organisationId", "status");

-- CreateIndex
CREATE INDEX "SubscriptionCheckout_status_expiresAt_idx" ON "SubscriptionCheckout"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCheckout_organisationId_idempotencyKey_key" ON "SubscriptionCheckout"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCheckout_billingProviderKey_providerCheckoutRef_key" ON "SubscriptionCheckout"("billingProviderKey", "providerCheckoutRef");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementTrialGrant_organisationId_key" ON "ManagementTrialGrant"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementTrialIdentity_identityHash_key" ON "ManagementTrialIdentity"("identityHash");

-- CreateIndex
CREATE INDEX "ManagementTrialIdentity_grantId_idx" ON "ManagementTrialIdentity"("grantId");

-- AddForeignKey
ALTER TABLE "OrganisationSubscription" ADD CONSTRAINT "OrganisationSubscription_selectedPlanId_fkey" FOREIGN KEY ("selectedPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCheckout" ADD CONSTRAINT "SubscriptionCheckout_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCheckout" ADD CONSTRAINT "SubscriptionCheckout_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "OrganisationSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCheckout" ADD CONSTRAINT "SubscriptionCheckout_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementTrialGrant" ADD CONSTRAINT "ManagementTrialGrant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementTrialIdentity" ADD CONSTRAINT "ManagementTrialIdentity_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "ManagementTrialGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

