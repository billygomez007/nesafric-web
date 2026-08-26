import { Prisma, type PlatformPrincipal } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PLATFORM_PERMISSIONS } from "@/platform/platform-admin/permissions";
import { AppError } from "@/platform/errors";
import { platformRoleHasPermission } from "@/platform/platform-admin/permissions";

function requirePermission(principal: PlatformPrincipal, permission: (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS]) {
  if (!platformRoleHasPermission(principal.role, permission)) throw new AppError("FORBIDDEN", 403, "You do not have permission to perform this action.");
}

const PAYING_STATUSES = ["ACTIVE", "PAST_DUE", "GRACE_PERIOD"] as const;

/**
 * Deterministic commercial analytics (item 11): every number here is computed directly from
 * persisted `OrganisationSubscription`/`PlanPrice`/`SubscriptionStatusHistory` rows. There is no
 * invented growth curve, no simulated churn rate, no placeholder revenue figure — an instance
 * with no paying organisations reports zero, honestly, rather than a plausible-looking fake
 * number. MRR/ARR are reported per-currency rather than converted through a fabricated exchange
 * rate (item 5's "currency-neutral").
 */
export async function getCommercialAnalytics(principal: PlatformPrincipal) {
  requirePermission(principal, PLATFORM_PERMISSIONS.analyticsRead);

  const [statusGroups, totalOrganisations, recentSignups, planGroups] = await Promise.all([
    db.organisationSubscription.groupBy({ by: ["status"], _count: { _all: true } }),
    db.organisation.count({ where: { archivedAt: null } }),
    db.organisation.count({ where: { archivedAt: null, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
    db.organisationSubscription.groupBy({ by: ["planId"], _count: { _all: true } }),
  ]);

  const plans = await db.subscriptionPlan.findMany({ where: { id: { in: planGroups.map((entry) => entry.planId) } }, select: { id: true, key: true, name: true } });
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const planCounts = planGroups.map((entry) => ({ planId: entry.planId, planKey: planById.get(entry.planId)?.key ?? "unknown", planName: planById.get(entry.planId)?.name ?? "Unknown", count: entry._count._all }));

  const payingSubscriptions = await db.organisationSubscription.findMany({
    where: { status: { in: [...PAYING_STATUSES] } },
    select: { planId: true, currencyCode: true, billingCycle: true },
  });
  const prices = await db.planPrice.findMany({ where: { isActive: true } });
  const priceByKey = new Map(prices.map((price) => [`${price.planId}:${price.currencyCode}:${price.billingCycle}`, price.amountMinor]));
  const mrrByCurrency = new Map<string, Prisma.Decimal>();
  for (const subscription of payingSubscriptions) {
    const amount = priceByKey.get(`${subscription.planId}:${subscription.currencyCode}:${subscription.billingCycle}`);
    if (!amount) continue;
    const monthly = subscription.billingCycle === "ANNUAL" ? amount.dividedBy(12) : amount;
    mrrByCurrency.set(subscription.currencyCode, (mrrByCurrency.get(subscription.currencyCode) ?? new Prisma.Decimal(0)).plus(monthly));
  }
  const mrr = Object.fromEntries([...mrrByCurrency.entries()].map(([currency, amount]) => [currency, amount.toFixed(0)]));
  const arr = Object.fromEntries([...mrrByCurrency.entries()].map(([currency, amount]) => [currency, amount.times(12).toFixed(0)]));

  const [trialsStarted, trialsConverted, cancellations30d] = await Promise.all([
    db.subscriptionStatusHistory.count({ where: { toStatus: "TRIALING" } }),
    db.subscriptionStatusHistory.count({ where: { fromStatus: "TRIALING", toStatus: "ACTIVE" } }),
    db.subscriptionStatusHistory.count({ where: { toStatus: "CANCELLED", createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
  ]);

  return {
    totalOrganisations,
    recentSignups30d: recentSignups,
    statusCounts: Object.fromEntries(statusGroups.map((entry) => [entry.status, entry._count._all])),
    planCounts,
    mrrByCurrency: mrr,
    arrByCurrency: arr,
    trialsStarted,
    trialsConverted,
    cancellations30d,
  };
}
