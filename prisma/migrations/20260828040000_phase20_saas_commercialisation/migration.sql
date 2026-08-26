-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "EntitlementKind" AS ENUM ('BOOLEAN', 'LIMIT');

-- CreateEnum
CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'FAILED', 'VOID');

-- CreateEnum
CREATE TYPE "BillingWebhookStatus" AS ENUM ('PROCESSED', 'UNMATCHED', 'MISMATCHED', 'DUPLICATE', 'FAILED');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'BILLING_ADMIN', 'SUPPORT_AGENT', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "PlatformPrincipalStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PlatformPrincipalOrigin" AS ENUM ('ENV_BOOTSTRAP', 'MANUAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_TRIAL_ENDING';
ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_BILLING_ISSUE';
ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_ACTIVATED';
ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_CHANGED';
ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_GRACE_PERIOD';
ALTER TYPE "ReminderEventType" ADD VALUE 'SUBSCRIPTION_SUSPENDED';
ALTER TYPE "ReminderEventType" ADD VALUE 'ENTITLEMENT_LIMIT_APPROACHING';
ALTER TYPE "ReminderEventType" ADD VALUE 'ENTITLEMENT_LIMIT_REACHED';

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanPrice" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "amountMinor" DECIMAL(19,0) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanEntitlement" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "featureKey" TEXT NOT NULL,
    "kind" "EntitlementKind" NOT NULL,
    "booleanValue" BOOLEAN,
    "limitValue" BIGINT,
    "isUnlimited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationSubscription" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "currencyCode" CHAR(3) NOT NULL,
    "billingProviderKey" TEXT NOT NULL DEFAULT 'test',
    "billingCustomerRef" TEXT,
    "billingSubscriptionRef" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "gracePeriodEndsAt" TIMESTAMP(3),
    "pastDueSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amountMinor" DECIMAL(19,0) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "billingProviderKey" TEXT NOT NULL,
    "providerInvoiceRef" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionStatusHistory" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "fromStatus" "SubscriptionStatus",
    "toStatus" "SubscriptionStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "actorUserId" UUID,
    "actorPlatformPrincipalId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationEntitlementOverride" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "featureKey" TEXT NOT NULL,
    "kind" "EntitlementKind" NOT NULL,
    "booleanValue" BOOLEAN,
    "limitValue" BIGINT,
    "isUnlimited" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdByPlatformPrincipalId" UUID NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByPlatformPrincipalId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganisationEntitlementOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingWebhookEvent" (
    "id" UUID NOT NULL,
    "organisationId" UUID,
    "providerKey" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" "BillingWebhookStatus" NOT NULL,
    "failureReason" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPrincipal" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "status" "PlatformPrincipalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdVia" "PlatformPrincipalOrigin" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "PlatformPrincipal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSupportSession" (
    "id" UUID NOT NULL,
    "platformPrincipalId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditEvent" (
    "id" UUID NOT NULL,
    "platformPrincipalId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "organisationId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPercentage" INTEGER NOT NULL DEFAULT 100,
    "emergencyDisabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByPlatformPrincipalId" UUID,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationFeatureFlagOverride" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "flagKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByPlatformPrincipalId" UUID,

    CONSTRAINT "OrganisationFeatureFlagOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_key_key" ON "SubscriptionPlan"("key");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_isActive_isPublic_sortOrder_idx" ON "SubscriptionPlan"("isActive", "isPublic", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PlanPrice_planId_currencyCode_billingCycle_key" ON "PlanPrice"("planId", "currencyCode", "billingCycle");

-- CreateIndex
CREATE UNIQUE INDEX "PlanEntitlement_planId_featureKey_key" ON "PlanEntitlement"("planId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationSubscription_organisationId_key" ON "OrganisationSubscription"("organisationId");

-- CreateIndex
CREATE INDEX "OrganisationSubscription_status_idx" ON "OrganisationSubscription"("status");

-- CreateIndex
CREATE INDEX "OrganisationSubscription_planId_idx" ON "OrganisationSubscription"("planId");

-- CreateIndex
CREATE INDEX "OrganisationSubscription_currentPeriodEnd_idx" ON "OrganisationSubscription"("currentPeriodEnd");

-- CreateIndex
CREATE INDEX "OrganisationSubscription_billingProviderKey_billingSubscrip_idx" ON "OrganisationSubscription"("billingProviderKey", "billingSubscriptionRef");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_organisationId_status_idx" ON "SubscriptionInvoice"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_subscriptionId_periodStart_key" ON "SubscriptionInvoice"("subscriptionId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_billingProviderKey_providerInvoiceRef_key" ON "SubscriptionInvoice"("billingProviderKey", "providerInvoiceRef");

-- CreateIndex
CREATE INDEX "SubscriptionStatusHistory_organisationId_createdAt_idx" ON "SubscriptionStatusHistory"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionStatusHistory_subscriptionId_createdAt_idx" ON "SubscriptionStatusHistory"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "OrganisationEntitlementOverride_organisationId_featureKey_r_idx" ON "OrganisationEntitlementOverride"("organisationId", "featureKey", "revokedAt");

-- CreateIndex
CREATE INDEX "BillingWebhookEvent_organisationId_receivedAt_idx" ON "BillingWebhookEvent"("organisationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingWebhookEvent_providerKey_eventKey_key" ON "BillingWebhookEvent"("providerKey", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPrincipal_userId_key" ON "PlatformPrincipal"("userId");

-- CreateIndex
CREATE INDEX "PlatformPrincipal_role_status_idx" ON "PlatformPrincipal"("role", "status");

-- CreateIndex
CREATE INDEX "PlatformSupportSession_organisationId_expiresAt_idx" ON "PlatformSupportSession"("organisationId", "expiresAt");

-- CreateIndex
CREATE INDEX "PlatformSupportSession_platformPrincipalId_expiresAt_idx" ON "PlatformSupportSession"("platformPrincipalId", "expiresAt");

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_organisationId_createdAt_idx" ON "PlatformAuditEvent"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_action_createdAt_idx" ON "PlatformAuditEvent"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationFeatureFlagOverride_organisationId_flagKey_key" ON "OrganisationFeatureFlagOverride"("organisationId", "flagKey");

-- AddForeignKey
ALTER TABLE "PlanPrice" ADD CONSTRAINT "PlanPrice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanEntitlement" ADD CONSTRAINT "PlanEntitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationSubscription" ADD CONSTRAINT "OrganisationSubscription_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationSubscription" ADD CONSTRAINT "OrganisationSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "OrganisationSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionStatusHistory" ADD CONSTRAINT "SubscriptionStatusHistory_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "OrganisationSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionStatusHistory" ADD CONSTRAINT "SubscriptionStatusHistory_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionStatusHistory" ADD CONSTRAINT "SubscriptionStatusHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionStatusHistory" ADD CONSTRAINT "SubscriptionStatusHistory_actorPlatformPrincipalId_fkey" FOREIGN KEY ("actorPlatformPrincipalId") REFERENCES "PlatformPrincipal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationEntitlementOverride" ADD CONSTRAINT "OrganisationEntitlementOverride_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationEntitlementOverride" ADD CONSTRAINT "OrganisationEntitlementOverride_createdByPlatformPrincipal_fkey" FOREIGN KEY ("createdByPlatformPrincipalId") REFERENCES "PlatformPrincipal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationEntitlementOverride" ADD CONSTRAINT "OrganisationEntitlementOverride_revokedByPlatformPrincipal_fkey" FOREIGN KEY ("revokedByPlatformPrincipalId") REFERENCES "PlatformPrincipal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingWebhookEvent" ADD CONSTRAINT "BillingWebhookEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPrincipal" ADD CONSTRAINT "PlatformPrincipal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSupportSession" ADD CONSTRAINT "PlatformSupportSession_platformPrincipalId_fkey" FOREIGN KEY ("platformPrincipalId") REFERENCES "PlatformPrincipal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSupportSession" ADD CONSTRAINT "PlatformSupportSession_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAuditEvent" ADD CONSTRAINT "PlatformAuditEvent_platformPrincipalId_fkey" FOREIGN KEY ("platformPrincipalId") REFERENCES "PlatformPrincipal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAuditEvent" ADD CONSTRAINT "PlatformAuditEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_updatedByPlatformPrincipalId_fkey" FOREIGN KEY ("updatedByPlatformPrincipalId") REFERENCES "PlatformPrincipal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationFeatureFlagOverride" ADD CONSTRAINT "OrganisationFeatureFlagOverride_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationFeatureFlagOverride" ADD CONSTRAINT "OrganisationFeatureFlagOverride_flagKey_fkey" FOREIGN KEY ("flagKey") REFERENCES "FeatureFlag"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationFeatureFlagOverride" ADD CONSTRAINT "OrganisationFeatureFlagOverride_createdByPlatformPrincipal_fkey" FOREIGN KEY ("createdByPlatformPrincipalId") REFERENCES "PlatformPrincipal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
