import { ENTITLEMENTS } from "@/modules/entitlements/catalog";

/**
 * The single source of truth for NesAfric property-management plans: price, managed-unit
 * capacity, staff seats, branches, features and usage allowances. The seed and the
 * `pm_subscription_plans` migration write these values into `SubscriptionPlan`/`PlanPrice`/
 * `PlanEntitlement`; from then on the database rows are what the entitlement service enforces, so a
 * platform admin can adjust a price or an allowance without a deploy. Plan pages, WhatsApp copy and
 * checkout all read prices and limits from the database through `subscriptions/plans.ts`, never
 * from literals elsewhere.
 *
 * Only landlords and property managers who activate property management need one of these plans.
 * Agents, sellers, buyers, tenants and marketplace-only accounts never do.
 *
 * Every feature listed here is implemented and enforced somewhere in the codebase. Nothing is
 * described as unlimited: every allowance is a number.
 */

export type PmPlanKey = "essential" | "growth" | "enterprise";
export const TRIAL_PLAN_KEY = "pm_trial";
export const PM_PLAN_KEYS: readonly PmPlanKey[] = ["essential", "growth", "enterprise"];
/** Retired Phase 20 illustrative plans. Kept inactive (never deleted) so history still resolves. */
export const LEGACY_PLAN_KEYS = ["starter", "scale"] as const;

export const PM_CURRENCY = "GHS";

/** Trial and dunning timings. Changing these never shortens a trial already granted. */
export const PM_BILLING_RULES = {
  trialDays: 30,
  /** Trial-ending reminders, in whole days before `trialEndsAt`. Each is sent once. */
  trialReminderDays: [7, 3, 1] as const,
  /** After a failed or missed renewal: days in PAST_DUE before the grace period starts. */
  pastDueDays: 3,
  /** Grace period after PAST_DUE. Paid features keep working; when it ends, the plan expires. */
  gracePeriodDays: 7,
  /** A hosted checkout that is not confirmed by the provider within this window expires. */
  checkoutExpiryHours: 24,
  /** Share of an allowance at which the owner is told they are approaching it. */
  usageWarningRatio: 0.8,
} as const;

type Limit = { limit: number } | { off: true };
type Allowances = {
  units: number;
  staff: number;
  branches: number;
  aiRepliesMonthly: number;
  messagesMonthly: number;
  documentsMonthly: number;
  storageBytes: number;
  aiTokensMonthly: number;
  aiCostMonthlyNano: number;
};

export type PmPlanDefinition = {
  key: PmPlanKey | typeof TRIAL_PLAN_KEY;
  name: string;
  tagline: string;
  /** Monthly price in minor units (pesewas). Enterprise is a "from" price. */
  monthlyPriceMinor: number;
  priceIsFrom?: boolean;
  recommended?: boolean;
  isPublic: boolean;
  sortOrder: number;
  allowances: Allowances;
  /** Boolean feature keys this plan switches on. Anything not listed is off. */
  features: string[];
  /** Customer-facing feature lines, in display order. Only implemented features appear. */
  highlights: string[];
  support: string;
};

const GB = 1024 * 1024 * 1024;

/** Features every management plan (and the trial) includes. */
const ESSENTIAL_FEATURES = [
  ENTITLEMENTS.pmCoreEnabled.key,
  ENTITLEMENTS.pmWhatsappAiAssistantEnabled.key,
  // The existing AI receptionist (text) is what answers tenants on WhatsApp.
  ENTITLEMENTS.aiReceptionistTextEnabled.key,
  ENTITLEMENTS.maintenanceAiClassificationEnabled.key,
  ENTITLEMENTS.maintenanceAiDispatchEnabled.key,
  ENTITLEMENTS.pmRentRemindersEnabled.key,
];

const GROWTH_FEATURES = [
  ...ESSENTIAL_FEATURES,
  ENTITLEMENTS.aiPropertyManagerEnabled.key,
  ENTITLEMENTS.automationEnabled.key,
  ENTITLEMENTS.pmStaffRolesEnabled.key,
  ENTITLEMENTS.pmEscalationRulesEnabled.key,
  ENTITLEMENTS.pmSupervisorNotificationsEnabled.key,
  ENTITLEMENTS.advancedReportingEnabled.key,
];

const ENTERPRISE_FEATURES = [
  ...GROWTH_FEATURES,
  ENTITLEMENTS.integrationsEnabled.key,
];

export const PM_PLANS: Record<PmPlanKey, PmPlanDefinition> = {
  essential: {
    key: "essential",
    name: "Essential",
    tagline: "For individual landlords.",
    monthlyPriceMinor: 24_900,
    isPublic: true,
    sortOrder: 10,
    allowances: { units: 25, staff: 1, branches: 1, aiRepliesMonthly: 300, messagesMonthly: 600, documentsMonthly: 50, storageBytes: 2 * GB, aiTokensMonthly: 300_000, aiCostMonthlyNano: 5_000_000_000 },
    features: ESSENTIAL_FEATURES,
    highlights: [
      "WhatsApp AI assistant for tenants (within your monthly allowance)",
      "Maintenance capture and automatic categorisation",
      "Service provider assignment and notifications",
      "Rent reminders and tenancy notifications",
      "Maintenance tracking and history",
      "Dashboard for your properties",
      "1 admin user",
    ],
    support: "Standard support",
  },
  growth: {
    key: "growth",
    name: "Growth",
    tagline: "For growing landlords and property managers.",
    monthlyPriceMinor: 69_900,
    recommended: true,
    isPublic: true,
    sortOrder: 20,
    allowances: { units: 100, staff: 10, branches: 5, aiRepliesMonthly: 1_500, messagesMonthly: 3_000, documentsMonthly: 300, storageBytes: 20 * GB, aiTokensMonthly: 1_500_000, aiCostMonthlyNano: 25_000_000_000 },
    features: GROWTH_FEATURES,
    highlights: [
      "Everything in Essential",
      "Multiple branches (portfolios)",
      "Multiple staff with role-based permissions",
      "Configurable maintenance routing and escalation rules",
      "Supervisor notifications and daily digests",
      "Detailed portfolio reports",
      "AI property manager and approved AI automations",
    ],
    support: "Priority support",
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    tagline: "For estates, developments and large portfolios.",
    monthlyPriceMinor: 149_900,
    priceIsFrom: true,
    isPublic: true,
    sortOrder: 30,
    allowances: { units: 300, staff: 30, branches: 20, aiRepliesMonthly: 5_000, messagesMonthly: 10_000, documentsMonthly: 1_000, storageBytes: 100 * GB, aiTokensMonthly: 5_000_000, aiCostMonthlyNano: 80_000_000_000 },
    features: ENTERPRISE_FEATURES,
    highlights: [
      "Everything in Growth",
      "Multiple estates, developments and branches",
      "Third-party integrations already supported by NesAfric",
      "Dedicated onboarding",
      "Capacity and allowances configured for your portfolio",
    ],
    support: "Dedicated onboarding and priority support",
  },
};

/**
 * What a property-management trial includes: Growth's operational features at Essential capacity,
 * with smaller usage allowances and none of the Enterprise extras. Never unlimited.
 */
export const PM_TRIAL_PLAN: PmPlanDefinition = {
  key: TRIAL_PLAN_KEY,
  name: "Free trial",
  tagline: "30 days of property management, no card needed.",
  monthlyPriceMinor: 0,
  isPublic: false,
  sortOrder: 0,
  allowances: { units: 25, staff: 3, branches: 2, aiRepliesMonthly: 200, messagesMonthly: 400, documentsMonthly: 30, storageBytes: 1 * GB, aiTokensMonthly: 200_000, aiCostMonthlyNano: 3_000_000_000 },
  features: GROWTH_FEATURES.filter((key) => key !== ENTITLEMENTS.advancedReportingEnabled.key),
  highlights: [],
  support: "Standard support",
};

/** Limit values per plan, keyed by entitlement feature key. Voice entitlements stay off. */
export function planEntitlementValues(plan: PmPlanDefinition): Record<string, Limit> {
  const a = plan.allowances;
  const values: Record<string, Limit> = {
    [ENTITLEMENTS.unitsMax.key]: { limit: a.units },
    [ENTITLEMENTS.teamMembersMax.key]: { limit: a.staff },
    [ENTITLEMENTS.pmBranchesMax.key]: { limit: a.branches },
    [ENTITLEMENTS.pmAiRepliesMonthlyMax.key]: { limit: a.aiRepliesMonthly },
    [ENTITLEMENTS.messagesMonthlyMax.key]: { limit: a.messagesMonthly },
    [ENTITLEMENTS.documentsMonthlyMax.key]: { limit: a.documentsMonthly },
    [ENTITLEMENTS.storageBytesMax.key]: { limit: a.storageBytes },
    [ENTITLEMENTS.aiTokensMonthlyMax.key]: { limit: a.aiTokensMonthly },
    [ENTITLEMENTS.aiCostMonthlyNanoMax.key]: { limit: a.aiCostMonthlyNano },
    // Properties are not a billed dimension (a property with no units is only a listing source);
    // units are. A generous numeric ceiling still guards against runaway automation.
    [ENTITLEMENTS.propertiesMax.key]: { limit: Math.max(a.units, 1) * 2 },
    [ENTITLEMENTS.aiEmployeesMax.key]: { limit: plan.key === "enterprise" ? 10 : plan.key === "growth" ? 3 : 1 },
    [ENTITLEMENTS.listingsMax.key]: { limit: 1_000 },
    [ENTITLEMENTS.integrationOperationsMonthlyMax.key]: { limit: plan.features.includes(ENTITLEMENTS.integrationsEnabled.key) ? 2_000 : 0 },
    [ENTITLEMENTS.voiceCallVolumeMax.key]: { limit: 0 },
    [ENTITLEMENTS.voiceInboundMinutesMonthlyMax.key]: { limit: 0 },
    [ENTITLEMENTS.voiceOutboundMinutesMonthlyMax.key]: { limit: 0 },
    [ENTITLEMENTS.voiceConcurrentCallsMax.key]: { limit: 0 },
  };
  return values;
}

/** Every entitlement row a plan should have: limits above plus every boolean on or off. */
export function planEntitlementRows(plan: PmPlanDefinition) {
  const limits = planEntitlementValues(plan);
  const rows: Array<{ featureKey: string; kind: "BOOLEAN" | "LIMIT"; booleanValue: boolean | null; limitValue: number | null }> = [];
  for (const definition of Object.values(ENTITLEMENTS)) {
    if (definition.key.startsWith("service_provider.")) continue;
    if (definition.kind === "BOOLEAN") {
      rows.push({ featureKey: definition.key, kind: "BOOLEAN", booleanValue: plan.features.includes(definition.key), limitValue: null });
    } else {
      const value = limits[definition.key];
      rows.push({ featureKey: definition.key, kind: "LIMIT", booleanValue: null, limitValue: value && "limit" in value ? value.limit : 0 });
    }
  }
  return rows;
}

export function isPmPlanKey(key: string): key is PmPlanKey {
  return (PM_PLAN_KEYS as readonly string[]).includes(key);
}

/** Which feature key a customer-facing "unlocks with" message should name, and the cheapest plan
 * that includes it. Used for upgrade prompts in the UI and in WhatsApp. */
export function cheapestPlanWithFeature(featureKey: string): PmPlanDefinition | null {
  return PM_PLAN_KEYS.map((key) => PM_PLANS[key]).find((plan) => plan.features.includes(featureKey)) ?? null;
}

export function formatGhs(minor: number | bigint | string) {
  const value = Number(minor) / 100;
  return `GH₵${value.toLocaleString("en-GH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
