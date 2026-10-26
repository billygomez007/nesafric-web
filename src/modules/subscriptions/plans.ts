import { db } from "@/platform/database/client";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import { formatGhs, isPmPlanKey, PM_BILLING_RULES, PM_CURRENCY, PM_PLANS, type PmPlanKey } from "./plan-catalog";

export type PlanSummary = {
  key: PmPlanKey;
  name: string;
  tagline: string;
  recommended: boolean;
  monthlyPriceMinor: string;
  priceLabel: string;
  currencyCode: string;
  units: number;
  staff: number;
  branches: number;
  aiRepliesMonthly: number;
  messagesMonthly: number;
  highlights: string[];
  support: string;
};

/**
 * Public property-management plans as customers see them: price and every limit come from the
 * database rows (which a platform admin can adjust), and the descriptive copy from the catalog.
 * The billing page, the pricing page and WhatsApp messages all use this, so they always agree with
 * what the entitlement service enforces.
 */
export async function getPublicPlanSummaries(currencyCode: string = PM_CURRENCY): Promise<PlanSummary[]> {
  const plans = await db.subscriptionPlan.findMany({
    where: { isActive: true, isPublic: true },
    include: { prices: { where: { isActive: true, currencyCode, billingCycle: "MONTHLY" } }, entitlements: true },
    orderBy: { sortOrder: "asc" },
  });
  const limit = (plan: (typeof plans)[number], key: string) => Number(plan.entitlements.find((entry) => entry.featureKey === key)?.limitValue ?? 0);
  return plans.filter((plan) => isPmPlanKey(plan.key) && plan.prices.length).map((plan) => {
    const catalog = PM_PLANS[plan.key as PmPlanKey];
    const amount = plan.prices[0].amountMinor.toString();
    return {
      key: plan.key as PmPlanKey,
      name: plan.name,
      tagline: catalog.tagline,
      recommended: Boolean(catalog.recommended),
      monthlyPriceMinor: amount,
      priceLabel: `${catalog.priceIsFrom ? "From " : ""}${formatGhs(amount)}/month`,
      currencyCode,
      units: limit(plan, ENTITLEMENTS.unitsMax.key),
      staff: limit(plan, ENTITLEMENTS.teamMembersMax.key),
      branches: limit(plan, ENTITLEMENTS.pmBranchesMax.key),
      aiRepliesMonthly: limit(plan, ENTITLEMENTS.pmAiRepliesMonthlyMax.key),
      messagesMonthly: limit(plan, ENTITLEMENTS.messagesMonthlyMax.key),
      highlights: catalog.highlights,
      support: catalog.support,
    };
  });
}

/** One-message plan overview for WhatsApp, e.g. after onboarding or when a limit is reached. */
export async function planOverviewText(): Promise<string> {
  const plans = await getPublicPlanSummaries();
  return plans.map((plan) => `• ${plan.name}${plan.recommended ? " (recommended)" : ""}: ${plan.priceLabel}, up to ${plan.units} units`).join("\n");
}

export function formatDate(date: Date) {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Accra" });
}

/** The trial notice landlords see in WhatsApp and in the dashboard banner. */
export function trialNoticeText(trialEndsAt: Date) {
  return `Your ${PM_BILLING_RULES.trialDays}-day free property-management trial runs until ${formatDate(trialEndsAt)}. No payment is taken automatically — choose a plan any time from Billing.`;
}
