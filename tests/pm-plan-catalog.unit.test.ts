import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import { cheapestPlanWithFeature, PM_BILLING_RULES, PM_PLANS, PM_TRIAL_PLAN, planEntitlementRows } from "@/modules/subscriptions/plan-catalog";
import { planUpsertSql } from "../scripts/generators/pm-plans-migration-sql";

const MIGRATION = path.resolve(__dirname, "../prisma/migrations/20261027090100_pm_subscription_plans/migration.sql");

describe("property-management plan catalog", () => {
  it("is exactly what the plan migration writes (the SQL is generated from the catalog)", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const generated = sql.slice(sql.indexOf("-- BEGIN GENERATED PLAN CATALOG\n") + "-- BEGIN GENERATED PLAN CATALOG\n".length, sql.indexOf("-- END GENERATED PLAN CATALOG"));
    expect(generated.trim()).toBe(planUpsertSql().trim());
  });

  it("has three paid plans in ascending price and capacity, and never anything unlimited", () => {
    const plans = [PM_PLANS.essential, PM_PLANS.growth, PM_PLANS.enterprise];
    expect(plans.map((plan) => plan.monthlyPriceMinor)).toEqual([...plans.map((plan) => plan.monthlyPriceMinor)].sort((a, b) => a - b));
    expect(plans.map((plan) => plan.allowances.units)).toEqual([...plans.map((plan) => plan.allowances.units)].sort((a, b) => a - b));
    expect(PM_PLANS.growth.recommended).toBe(true);
    expect(PM_PLANS.essential.allowances.staff).toBe(1);
    expect(PM_PLANS.essential.allowances.branches).toBe(1);
    for (const plan of [...plans, PM_TRIAL_PLAN]) {
      for (const row of planEntitlementRows(plan)) {
        if (row.kind === "LIMIT") expect(Number.isFinite(row.limitValue)).toBe(true);
      }
      expect(plan.highlights.join(" ").toLowerCase()).not.toContain("unlimited");
    }
  });

  it("gives the trial no Enterprise extras, and keeps voice off in every plan", () => {
    expect(PM_TRIAL_PLAN.features).not.toContain(ENTITLEMENTS.integrationsEnabled.key);
    expect(PM_TRIAL_PLAN.allowances.units).toBeLessThanOrEqual(PM_PLANS.essential.allowances.units);
    expect(PM_BILLING_RULES.trialDays).toBe(30);
    expect(PM_BILLING_RULES.trialReminderDays).toEqual([7, 3, 1]);
    for (const plan of [PM_PLANS.essential, PM_PLANS.growth, PM_PLANS.enterprise, PM_TRIAL_PLAN]) {
      expect(plan.features.some((key) => key.includes("voice"))).toBe(false);
      const voiceLimits = planEntitlementRows(plan).filter((row) => row.featureKey.includes("voice") && row.kind === "LIMIT");
      expect(voiceLimits.every((row) => row.limitValue === 0)).toBe(true);
    }
  });

  it("names the plan that unlocks a feature", () => {
    expect(cheapestPlanWithFeature(ENTITLEMENTS.pmEscalationRulesEnabled.key)?.key).toBe("growth");
    expect(cheapestPlanWithFeature(ENTITLEMENTS.integrationsEnabled.key)?.key).toBe("enterprise");
    expect(cheapestPlanWithFeature(ENTITLEMENTS.pmWhatsappAiAssistantEnabled.key)?.key).toBe("essential");
  });
});
