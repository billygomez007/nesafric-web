/**
 * Prints the plan/price/entitlement upserts for the `pm_subscription_plans` migration from
 * `src/modules/subscriptions/plan-catalog.ts`, so the SQL can never drift from the catalog by hand.
 * Usage: npx tsx scripts/generators/pm-plans-migration-sql.ts
 * `tests/pm-plan-catalog.unit.test.ts` fails if the committed migration differs from this output.
 */
import { PM_CURRENCY, PM_PLANS, PM_PLAN_KEYS, PM_TRIAL_PLAN, planEntitlementRows, type PmPlanDefinition } from "../../src/modules/subscriptions/plan-catalog";

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

export function planUpsertSql() {
  const plans: PmPlanDefinition[] = [...PM_PLAN_KEYS.map((key) => PM_PLANS[key]), PM_TRIAL_PLAN];
  const lines: string[] = [];
  for (const plan of plans) {
    lines.push(
      `INSERT INTO "SubscriptionPlan" ("id", "key", "name", "description", "isActive", "isPublic", "sortOrder", "createdAt", "updatedAt")`,
      `VALUES (gen_random_uuid(), ${quote(plan.key)}, ${quote(plan.name)}, ${quote(plan.tagline)}, true, ${plan.isPublic}, ${plan.sortOrder}, now(), now())`,
      `ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "isActive" = true, "isPublic" = EXCLUDED."isPublic", "sortOrder" = EXCLUDED."sortOrder", "updatedAt" = now();`,
    );
    lines.push(
      `UPDATE "PlanPrice" SET "isActive" = false, "updatedAt" = now() WHERE "planId" = (SELECT "id" FROM "SubscriptionPlan" WHERE "key" = ${quote(plan.key)}) AND NOT ("currencyCode" = ${quote(PM_CURRENCY)} AND "billingCycle" = 'MONTHLY');`,
    );
    if (plan.monthlyPriceMinor > 0) {
      lines.push(
        `INSERT INTO "PlanPrice" ("id", "planId", "currencyCode", "billingCycle", "amountMinor", "isActive", "createdAt", "updatedAt")`,
        `SELECT gen_random_uuid(), "id", ${quote(PM_CURRENCY)}, 'MONTHLY', ${plan.monthlyPriceMinor}, true, now(), now() FROM "SubscriptionPlan" WHERE "key" = ${quote(plan.key)}`,
        `ON CONFLICT ("planId", "currencyCode", "billingCycle") DO UPDATE SET "amountMinor" = EXCLUDED."amountMinor", "isActive" = true, "updatedAt" = now();`,
      );
    }
    for (const row of planEntitlementRows(plan)) {
      lines.push(
        `INSERT INTO "PlanEntitlement" ("id", "planId", "featureKey", "kind", "booleanValue", "limitValue", "isUnlimited", "createdAt", "updatedAt")`,
        `SELECT gen_random_uuid(), "id", ${quote(row.featureKey)}, '${row.kind}', ${row.booleanValue === null ? "NULL" : row.booleanValue}, ${row.limitValue === null ? "NULL" : row.limitValue}, false, now(), now() FROM "SubscriptionPlan" WHERE "key" = ${quote(plan.key)}`,
        `ON CONFLICT ("planId", "featureKey") DO UPDATE SET "kind" = EXCLUDED."kind", "booleanValue" = EXCLUDED."booleanValue", "limitValue" = EXCLUDED."limitValue", "isUnlimited" = false, "updatedAt" = now();`,
      );
    }
  }
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("pm-plans-migration-sql.ts")) console.log(planUpsertSql());
