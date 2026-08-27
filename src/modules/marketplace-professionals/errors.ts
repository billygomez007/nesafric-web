import { AppError } from "@/platform/errors";

export function marketplaceEntitlementLimitReached(featureKey: string, label: string, current: number, limit: number) {
  return new AppError(
    "MARKETPLACE_ENTITLEMENT_LIMIT_REACHED",
    402,
    `The ${label} limit (${limit}) has been reached.`,
    { feature: featureKey, current, limit },
  );
}

export function marketplaceEntitlementFeatureDisabled(featureKey: string, label: string) {
  return new AppError(
    "MARKETPLACE_ENTITLEMENT_FEATURE_DISABLED",
    402,
    `${label} is not available on this marketplace profile's current plan.`,
    { feature: featureKey },
  );
}

export function marketplaceProfessionalReadOnly(status: string) {
  return new AppError(
    "MARKETPLACE_PROFESSIONAL_READ_ONLY",
    403,
    "This marketplace profile's subscription is suspended or cancelled. Existing data remains accessible, but new changes are blocked until it is reactivated.",
    { status },
  );
}
