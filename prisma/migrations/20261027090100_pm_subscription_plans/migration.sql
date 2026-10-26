-- Property-management plans (Essential / Growth / Enterprise / free trial) and the move from
-- "trial at account creation" to "trial when property management is activated".
--
-- Runs after 20261027090000_pm_subscriptions_schema, which adds the EXPIRED / PAYMENT_PENDING
-- statuses (a new enum value cannot be used in the transaction that adds it).
--
-- Nothing here deletes customer data. It only:
--   1. upserts the plan catalog (generated block below; see scripts/generators/pm-plans-migration-sql.ts),
--   2. retires the Phase 20 illustrative plans `starter` / `scale` (kept, inactive and private),
--   3. removes the automatic trial rows that were created at sign-up for organisations that never
--      used property management (no units, tenants or leases), with an audit event for each, and
--   4. gives every organisation that did use property management a fresh 30-day trial from today,
--      recorded as its one trial grant, and maps any paid legacy plan to its successor.

-- BEGIN GENERATED PLAN CATALOG
INSERT INTO "SubscriptionPlan" ("id", "key", "name", "description", "isActive", "isPublic", "sortOrder", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'essential', 'Essential', 'For individual landlords.', true, true, 10, now(), now())
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "isActive" = true, "isPublic" = EXCLUDED."isPublic", "sortOrder" = EXCLUDED."sortOrder", "updatedAt" = now();
UPDATE "PlanPrice" SET "isActive" = false, "updatedAt" = now() WHERE "planId" = (SELECT "id" FROM "SubscriptionPlan" WHERE "key" = 'essential') AND NOT ("currencyCode" = 'GHS' AND "billingCycle" = 'MONTHLY');
INSERT INTO "PlanPrice" ("id", "planId", "currencyCode", "billingCycle", "amountMinor", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'GHS', 'MONTHLY', 24900, true, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "currencyCode", "billingCycle") DO UPDATE SET "amountMinor" = EXCLUDED."amountMinor", "isActive" = true, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'properties.max', 'LIMIT', NULL, 50, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'units.max', 'LIMIT', NULL, 25, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'team.members.max', 'LIMIT', NULL, 1, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'ai.employees.max', 'LIMIT', NULL, 1, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'ai.tokens.monthly_max', 'LIMIT', NULL, 300000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'ai.cost.monthly_nano_max', 'LIMIT', NULL, 5000000000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'storage.bytes.max', 'LIMIT', NULL, 2147483648, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'listings.max', 'LIMIT', NULL, 1000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'documents.monthly_max', 'LIMIT', NULL, 50, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'messages.monthly_max', 'LIMIT', NULL, 600, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'integrations.operations.monthly_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'integrations.enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'automation.enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'reporting.advanced', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.ai_property_manager', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.ai_receptionist.text', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.ai_receptionist.voice', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.maintenance.ai_classification', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.maintenance.ai_dispatch', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.maintenance.voice_dispatch', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.predictive_maintenance', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.portfolio_intelligence', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.outbound_enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.call_volume_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.recording_enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.inbound_minutes_monthly_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.outbound_minutes_monthly_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.human_transfer_enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.concurrent_calls_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.core', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.whatsapp_ai_assistant', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.rent_reminders', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.staff_roles', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.escalation_rules', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.supervisor_notifications', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.branches.max', 'LIMIT', NULL, 1, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.ai_replies.monthly_max', 'LIMIT', NULL, 300, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'essential'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "SubscriptionPlan" ("id", "key", "name", "description", "isActive", "isPublic", "sortOrder", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'growth', 'Growth', 'For growing landlords and property managers.', true, true, 20, now(), now())
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "isActive" = true, "isPublic" = EXCLUDED."isPublic", "sortOrder" = EXCLUDED."sortOrder", "updatedAt" = now();
UPDATE "PlanPrice" SET "isActive" = false, "updatedAt" = now() WHERE "planId" = (SELECT "id" FROM "SubscriptionPlan" WHERE "key" = 'growth') AND NOT ("currencyCode" = 'GHS' AND "billingCycle" = 'MONTHLY');
INSERT INTO "PlanPrice" ("id", "planId", "currencyCode", "billingCycle", "amountMinor", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'GHS', 'MONTHLY', 69900, true, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "currencyCode", "billingCycle") DO UPDATE SET "amountMinor" = EXCLUDED."amountMinor", "isActive" = true, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'properties.max', 'LIMIT', NULL, 200, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'units.max', 'LIMIT', NULL, 100, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'team.members.max', 'LIMIT', NULL, 10, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'ai.employees.max', 'LIMIT', NULL, 3, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'ai.tokens.monthly_max', 'LIMIT', NULL, 1500000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'ai.cost.monthly_nano_max', 'LIMIT', NULL, 25000000000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'storage.bytes.max', 'LIMIT', NULL, 21474836480, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'listings.max', 'LIMIT', NULL, 1000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'documents.monthly_max', 'LIMIT', NULL, 300, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'messages.monthly_max', 'LIMIT', NULL, 3000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'integrations.operations.monthly_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'integrations.enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'automation.enabled', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'reporting.advanced', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.ai_property_manager', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.ai_receptionist.text', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.ai_receptionist.voice', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.maintenance.ai_classification', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.maintenance.ai_dispatch', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.maintenance.voice_dispatch', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.predictive_maintenance', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.portfolio_intelligence', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.outbound_enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.call_volume_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.recording_enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.inbound_minutes_monthly_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.outbound_minutes_monthly_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.human_transfer_enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.concurrent_calls_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.core', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.whatsapp_ai_assistant', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.rent_reminders', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.staff_roles', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.escalation_rules', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.supervisor_notifications', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.branches.max', 'LIMIT', NULL, 5, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.ai_replies.monthly_max', 'LIMIT', NULL, 1500, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'growth'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "SubscriptionPlan" ("id", "key", "name", "description", "isActive", "isPublic", "sortOrder", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'enterprise', 'Enterprise', 'For estates, developments and large portfolios.', true, true, 30, now(), now())
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "isActive" = true, "isPublic" = EXCLUDED."isPublic", "sortOrder" = EXCLUDED."sortOrder", "updatedAt" = now();
UPDATE "PlanPrice" SET "isActive" = false, "updatedAt" = now() WHERE "planId" = (SELECT "id" FROM "SubscriptionPlan" WHERE "key" = 'enterprise') AND NOT ("currencyCode" = 'GHS' AND "billingCycle" = 'MONTHLY');
INSERT INTO "PlanPrice" ("id", "planId", "currencyCode", "billingCycle", "amountMinor", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'GHS', 'MONTHLY', 149900, true, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "currencyCode", "billingCycle") DO UPDATE SET "amountMinor" = EXCLUDED."amountMinor", "isActive" = true, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'properties.max', 'LIMIT', NULL, 600, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'units.max', 'LIMIT', NULL, 300, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'team.members.max', 'LIMIT', NULL, 30, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'ai.employees.max', 'LIMIT', NULL, 10, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'ai.tokens.monthly_max', 'LIMIT', NULL, 5000000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'ai.cost.monthly_nano_max', 'LIMIT', NULL, 80000000000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'storage.bytes.max', 'LIMIT', NULL, 107374182400, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'listings.max', 'LIMIT', NULL, 1000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'documents.monthly_max', 'LIMIT', NULL, 1000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'messages.monthly_max', 'LIMIT', NULL, 10000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'integrations.operations.monthly_max', 'LIMIT', NULL, 2000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'integrations.enabled', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'automation.enabled', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'reporting.advanced', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.ai_property_manager', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.ai_receptionist.text', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.ai_receptionist.voice', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.maintenance.ai_classification', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.maintenance.ai_dispatch', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.maintenance.voice_dispatch', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.predictive_maintenance', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.portfolio_intelligence', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.outbound_enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.call_volume_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.recording_enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.inbound_minutes_monthly_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.outbound_minutes_monthly_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.human_transfer_enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.concurrent_calls_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.core', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.whatsapp_ai_assistant', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.rent_reminders', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.staff_roles', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.escalation_rules', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.supervisor_notifications', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.branches.max', 'LIMIT', NULL, 20, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.ai_replies.monthly_max', 'LIMIT', NULL, 5000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'enterprise'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "SubscriptionPlan" ("id", "key", "name", "description", "isActive", "isPublic", "sortOrder", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'pm_trial', 'Free trial', '30 days of property management, no card needed.', true, false, 0, now(), now())
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "isActive" = true, "isPublic" = EXCLUDED."isPublic", "sortOrder" = EXCLUDED."sortOrder", "updatedAt" = now();
UPDATE "PlanPrice" SET "isActive" = false, "updatedAt" = now() WHERE "planId" = (SELECT "id" FROM "SubscriptionPlan" WHERE "key" = 'pm_trial') AND NOT ("currencyCode" = 'GHS' AND "billingCycle" = 'MONTHLY');
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'properties.max', 'LIMIT', NULL, 50, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'units.max', 'LIMIT', NULL, 25, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'team.members.max', 'LIMIT', NULL, 3, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'ai.employees.max', 'LIMIT', NULL, 1, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'ai.tokens.monthly_max', 'LIMIT', NULL, 200000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'ai.cost.monthly_nano_max', 'LIMIT', NULL, 3000000000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'storage.bytes.max', 'LIMIT', NULL, 1073741824, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'listings.max', 'LIMIT', NULL, 1000, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'documents.monthly_max', 'LIMIT', NULL, 30, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'messages.monthly_max', 'LIMIT', NULL, 400, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'integrations.operations.monthly_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'integrations.enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'automation.enabled', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'reporting.advanced', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.ai_property_manager', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.ai_receptionist.text', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.ai_receptionist.voice', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.maintenance.ai_classification', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.maintenance.ai_dispatch', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.maintenance.voice_dispatch', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.predictive_maintenance', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.portfolio_intelligence', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.outbound_enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.call_volume_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.recording_enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.inbound_minutes_monthly_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.outbound_minutes_monthly_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.human_transfer_enabled', 'BOOLEAN', false, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'propertyos.voice.concurrent_calls_max', 'LIMIT', NULL, 0, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.core', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.whatsapp_ai_assistant', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.rent_reminders', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.staff_roles', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.escalation_rules', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.supervisor_notifications', 'BOOLEAN', true, NULL, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.branches.max', 'LIMIT', NULL, 2, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'pm.ai_replies.monthly_max', 'LIMIT', NULL, 200, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'
ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();
-- END GENERATED PLAN CATALOG

-- 2. Retire the Phase 20 illustrative plans. Existing references stay valid.
UPDATE "SubscriptionPlan" SET "isActive" = false, "isPublic" = false, "updatedAt" = now() WHERE "key" IN ('starter', 'scale');

-- 3. Organisations whose only subscription is the automatic sign-up trial and that never managed
--    a unit, tenant or lease: property management was never activated, so no trial was consumed.
DROP TABLE IF EXISTS "_pm_unactivated";
CREATE TEMP TABLE "_pm_unactivated" AS
SELECT s."id" AS "subscriptionId", s."organisationId"
FROM "OrganisationSubscription" s
WHERE s."status" = 'TRIALING'
  AND NOT EXISTS (SELECT 1 FROM "Unit" u JOIN "Property" p ON p."id" = u."propertyId" WHERE p."organisationId" = s."organisationId")
  AND NOT EXISTS (SELECT 1 FROM "TenantOrganisation" t WHERE t."organisationId" = s."organisationId")
  AND NOT EXISTS (SELECT 1 FROM "Lease" l WHERE l."organisationId" = s."organisationId")
  AND NOT EXISTS (SELECT 1 FROM "SubscriptionInvoice" i WHERE i."subscriptionId" = s."id")
  AND NOT EXISTS (SELECT 1 FROM "OrganisationEntitlementOverride" o WHERE o."organisationId" = s."organisationId");

INSERT INTO "AuditEvent" ("id", "organisationId", "action", "entityType", "entityId", "metadata", "createdAt")
SELECT gen_random_uuid(), "organisationId", 'subscription.signup_trial_removed', 'organisation_subscription', "subscriptionId",
       jsonb_build_object('reason', 'Property management was never activated; the trial now starts on activation.'), now()
FROM "_pm_unactivated";

DELETE FROM "SubscriptionStatusHistory" WHERE "subscriptionId" IN (SELECT "subscriptionId" FROM "_pm_unactivated");
DELETE FROM "OrganisationSubscription" WHERE "id" IN (SELECT "subscriptionId" FROM "_pm_unactivated");

-- 4a. Organisations already managing property: a fresh 30-day trial from today on the trial plan.
DROP TABLE IF EXISTS "_pm_trialing";
CREATE TEMP TABLE "_pm_trialing" AS
SELECT s."id" AS "subscriptionId", s."organisationId", s."status"
FROM "OrganisationSubscription" s
WHERE s."status" = 'TRIALING';

UPDATE "OrganisationSubscription" s SET
  "planId" = (SELECT "id" FROM "SubscriptionPlan" WHERE "key" = 'pm_trial'),
  "trialStartedAt" = now(),
  "trialEndsAt" = now() + interval '30 days',
  "currentPeriodStart" = now(),
  "currentPeriodEnd" = now() + interval '30 days',
  "managementActivatedAt" = COALESCE(s."managementActivatedAt", s."createdAt"),
  "updatedAt" = now()
WHERE s."id" IN (SELECT "subscriptionId" FROM "_pm_trialing");

INSERT INTO "SubscriptionStatusHistory" ("id", "subscriptionId", "organisationId", "fromStatus", "toStatus", "reason", "createdAt")
SELECT gen_random_uuid(), "subscriptionId", "organisationId", 'TRIALING', 'TRIALING', 'Property-management plans introduced: 30-day trial restarted from today.', now()
FROM "_pm_trialing";

INSERT INTO "ManagementTrialGrant" ("id", "organisationId", "grantedToUserId", "startedAt", "endsAt", "createdAt")
SELECT gen_random_uuid(), t."organisationId",
       (SELECT m."userId" FROM "OrganisationMember" m JOIN "MembershipRole" mr ON mr."memberId" = m."id" JOIN "Role" r ON r."id" = mr."roleId"
        WHERE m."organisationId" = t."organisationId" AND r."key" = 'organisation_owner' ORDER BY m."createdAt" ASC LIMIT 1),
       now(), now() + interval '30 days', now()
FROM "_pm_trialing" t
ON CONFLICT ("organisationId") DO NOTHING;

-- The owners' identities are recorded as having used a trial (hashes only, never raw values).
-- Format matches `trialIdentityHash` in src/modules/subscriptions/activation.ts.
INSERT INTO "ManagementTrialIdentity" ("id", "grantId", "kind", "identityHash", "createdAt")
SELECT gen_random_uuid(), g."id", ids."kind", encode(sha256(convert_to(ids."kind" || ':' || ids."value", 'UTF8')), 'hex'), now()
FROM "ManagementTrialGrant" g
JOIN "_pm_trialing" t ON t."organisationId" = g."organisationId"
JOIN "OrganisationMember" m ON m."organisationId" = g."organisationId" AND m."status" = 'ACTIVE'
JOIN "MembershipRole" mr ON mr."memberId" = m."id"
JOIN "Role" r ON r."id" = mr."roleId" AND r."key" = 'organisation_owner'
JOIN "User" u ON u."id" = m."userId"
CROSS JOIN LATERAL (VALUES ('user', u."id"::text), ('email', CASE WHEN u."emailVerifiedAt" IS NOT NULL THEN lower(trim(u."email"::text)) END), ('phone', u."phoneE164")) AS ids("kind", "value")
WHERE ids."value" IS NOT NULL AND ids."value" <> ''
ON CONFLICT ("identityHash") DO NOTHING;

-- 4b. Paid or lapsed subscriptions on a retired plan move to its successor.
UPDATE "OrganisationSubscription" SET "planId" = (SELECT "id" FROM "SubscriptionPlan" WHERE "key" = 'essential'), "updatedAt" = now()
WHERE "planId" = (SELECT "id" FROM "SubscriptionPlan" WHERE "key" = 'starter');
UPDATE "OrganisationSubscription" SET "planId" = (SELECT "id" FROM "SubscriptionPlan" WHERE "key" = 'enterprise'), "updatedAt" = now()
WHERE "planId" = (SELECT "id" FROM "SubscriptionPlan" WHERE "key" = 'scale');
UPDATE "OrganisationSubscription" SET "managementActivatedAt" = "createdAt" WHERE "managementActivatedAt" IS NULL;

DROP TABLE IF EXISTS "_pm_unactivated";
DROP TABLE IF EXISTS "_pm_trialing";
