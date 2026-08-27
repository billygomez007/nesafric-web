/**
 * The marketplace's own entitlement engine (Phase 21A item 8), deliberately a separate, smaller
 * module from `src/modules/entitlements/service.ts` (PropertyOS management entitlements) —
 * same enforcement shape (resolve → assert), same "never delete, only block creating more"
 * discipline, but reading from `MarketplaceSubscription`/`MarketplacePlanEntitlement` instead of
 * `OrganisationSubscription`/`PlanEntitlement`. No override table exists yet for the marketplace
 * track (a reasonable Phase 21B addition); every effective entitlement today comes from the plan.
 */
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { getMarketplaceEntitlementDefinition } from "./catalog";
import { marketplaceEntitlementLimitReached, marketplaceEntitlementFeatureDisabled, marketplaceProfessionalReadOnly } from "./errors";

const WRITABLE_STATUSES = new Set(["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"]);

export type EffectiveMarketplaceEntitlement = {
  featureKey: string;
  kind: "BOOLEAN" | "LIMIT";
  booleanValue: boolean | null;
  limitValue: number | null;
  isUnlimited: boolean;
  source: "plan" | "default";
};

async function getSubscription(marketplaceProfessionalId: string) {
  const subscription = await db.marketplaceSubscription.findUnique({
    where: { marketplaceProfessionalId },
    include: { plan: { include: { entitlements: true } } },
  });
  if (!subscription) throw notFound();
  return subscription;
}

export async function resolveMarketplaceEntitlement(marketplaceProfessionalId: string, featureKey: string): Promise<EffectiveMarketplaceEntitlement> {
  const definition = getMarketplaceEntitlementDefinition(featureKey);
  if (!definition) throw new AppError("MARKETPLACE_ENTITLEMENT_UNKNOWN_FEATURE", 500, `'${featureKey}' is not a recognised marketplace entitlement feature.`);
  const subscription = await getSubscription(marketplaceProfessionalId);
  const planEntitlement = subscription.plan.entitlements.find((entry) => entry.featureKey === featureKey);
  if (planEntitlement) {
    return {
      featureKey,
      kind: definition.kind,
      booleanValue: planEntitlement.booleanValue,
      limitValue: planEntitlement.limitValue === null ? null : Number(planEntitlement.limitValue),
      isUnlimited: planEntitlement.isUnlimited,
      source: "plan",
    };
  }
  return { featureKey, kind: definition.kind, booleanValue: false, limitValue: 0, isUnlimited: false, source: "default" };
}

/** Phase 22B item 14 — `VoiceCall` is scoped by `organisationId` (this professional's hidden
 * backing organisation), not `marketplaceProfessionalId` directly, unlike every other marketplace
 * domain table — so these three cases resolve it first rather than assuming the FK shape every
 * other case here relies on. */
async function backingOrganisationId(marketplaceProfessionalId: string) {
  const professional = await db.marketplaceProfessional.findUnique({ where: { id: marketplaceProfessionalId }, select: { backingOrganisationId: true } });
  return professional?.backingOrganisationId;
}

async function sumMarketplaceVoiceMinutes(marketplaceProfessionalId: string, direction: "INBOUND" | "OUTBOUND") {
  const organisationId = await backingOrganisationId(marketplaceProfessionalId);
  if (!organisationId) return 0;
  const result = await db.voiceCall.aggregate({ where: { organisationId, direction, durationSeconds: { not: null } }, _sum: { durationSeconds: true } });
  return Math.ceil((result._sum.durationSeconds ?? 0) / 60);
}

async function getCurrentUsage(marketplaceProfessionalId: string, featureKey: string): Promise<number> {
  switch (featureKey) {
    case "marketplace.listings.active_max":
      return db.listing.count({ where: { marketplaceProfessionalId, archivedAt: null, status: { notIn: ["ARCHIVED", "REJECTED"] } } });
    case "marketplace.team.members.max":
      return db.marketplaceProfessionalMember.count({ where: { marketplaceProfessionalId, status: "ACTIVE" } });
    case "marketplace.developments.max":
      return db.development.count({ where: { marketplaceProfessionalId, archivedAt: null } });
    case "marketplace.voice.call_volume_max": {
      const organisationId = await backingOrganisationId(marketplaceProfessionalId);
      return organisationId ? db.voiceCall.count({ where: { organisationId } }) : 0;
    }
    case "marketplace.voice.inbound_minutes_monthly_max":
      return sumMarketplaceVoiceMinutes(marketplaceProfessionalId, "INBOUND");
    case "marketplace.voice.outbound_minutes_monthly_max":
      return sumMarketplaceVoiceMinutes(marketplaceProfessionalId, "OUTBOUND");
    case "marketplace.voice.concurrent_calls_max": {
      const organisationId = await backingOrganisationId(marketplaceProfessionalId);
      return organisationId ? db.voiceCall.count({ where: { organisationId, status: { in: ["QUEUED", "RINGING", "IN_PROGRESS"] } } }) : 0;
    }
    default:
      return 0;
  }
}

export async function assertWithinMarketplaceLimit(marketplaceProfessionalId: string, featureKey: string, increment = 1) {
  const effective = await resolveMarketplaceEntitlement(marketplaceProfessionalId, featureKey);
  if (effective.isUnlimited) return { current: null, limit: null, isUnlimited: true };
  const limit = effective.limitValue ?? 0;
  const current = await getCurrentUsage(marketplaceProfessionalId, featureKey);
  if (current + increment > limit) {
    throw marketplaceEntitlementLimitReached(featureKey, getMarketplaceEntitlementDefinition(featureKey)?.label ?? featureKey, current, limit);
  }
  return { current, limit, isUnlimited: false };
}

export async function assertMarketplaceFeatureEnabled(marketplaceProfessionalId: string, featureKey: string) {
  const effective = await resolveMarketplaceEntitlement(marketplaceProfessionalId, featureKey);
  if (effective.booleanValue === true) return;
  throw marketplaceEntitlementFeatureDisabled(featureKey, getMarketplaceEntitlementDefinition(featureKey)?.label ?? featureKey);
}

export async function assertWritableMarketplaceProfessional(marketplaceProfessionalId: string) {
  const subscription = await getSubscription(marketplaceProfessionalId);
  if (!WRITABLE_STATUSES.has(subscription.status)) throw marketplaceProfessionalReadOnly(subscription.status);
  return subscription;
}

export async function assertMarketplaceOperational(marketplaceProfessionalId: string, featureKey: string, increment = 1) {
  await assertWritableMarketplaceProfessional(marketplaceProfessionalId);
  const definition = getMarketplaceEntitlementDefinition(featureKey);
  if (definition?.kind === "BOOLEAN") {
    await assertMarketplaceFeatureEnabled(marketplaceProfessionalId, featureKey);
    return;
  }
  await assertWithinMarketplaceLimit(marketplaceProfessionalId, featureKey, increment);
}

export async function getMarketplaceEntitlementsSnapshot(marketplaceProfessionalId: string) {
  const subscription = await getSubscription(marketplaceProfessionalId);
  const featureKeys = subscription.plan.entitlements.map((entry) => entry.featureKey);
  const results = await Promise.all(featureKeys.map(async (featureKey) => {
    const effective = await resolveMarketplaceEntitlement(marketplaceProfessionalId, featureKey);
    const definition = getMarketplaceEntitlementDefinition(featureKey);
    const current = effective.kind === "LIMIT" ? await getCurrentUsage(marketplaceProfessionalId, featureKey) : null;
    return {
      featureKey,
      label: definition?.label ?? featureKey,
      kind: effective.kind,
      booleanValue: effective.booleanValue,
      limit: effective.limitValue,
      isUnlimited: effective.isUnlimited,
      current,
      // limit === 0 means the feature isn't included in the plan at all, not that a real
      // allowance was used up — never surface that as a misleading "limit reached".
      reached: effective.kind === "LIMIT" && !effective.isUnlimited && current !== null && (effective.limitValue ?? 0) > 0 && current >= (effective.limitValue ?? 0),
    };
  }));
  return { status: subscription.status, planKey: subscription.plan.key, planName: subscription.plan.name, features: results };
}
