import { AppError } from "@/platform/errors";

/**
 * Typed limit/feature errors (item 7): every caller gets the feature key, the exact current
 * usage and limit, and whether upgrading to a different plan would actually resolve it — no
 * generic "forbidden" is ever returned for a commercial ceiling.
 */
export function entitlementLimitReached(featureKey: string, label: string, current: number, limit: number, upgradeReady: boolean) {
  return new AppError(
    "ENTITLEMENT_LIMIT_REACHED",
    402,
    `The ${label} limit (${limit}) has been reached.`,
    { feature: featureKey, current, limit, upgradeReady },
  );
}

export function entitlementFeatureDisabled(featureKey: string, label: string, upgradeReady: boolean) {
  return new AppError(
    "ENTITLEMENT_FEATURE_DISABLED",
    402,
    `${label} is not available on the organisation's current plan.`,
    { feature: featureKey, upgradeReady },
  );
}

export function organisationReadOnly(status: string) {
  return new AppError(
    "ORGANISATION_READ_ONLY",
    403,
    "This organisation's subscription is suspended or cancelled. Existing data remains accessible, but new changes are blocked until the subscription is reactivated.",
    { status },
  );
}
