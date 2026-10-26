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

/**
 * Property management needs an active trial or paid plan. `status` says why (never activated,
 * trial expired, payment pending, suspended, cancelled) so the UI and WhatsApp can say exactly
 * what to do next. Data stays readable; billing, settings, support, export and the marketplace are
 * never behind this error.
 */
export function managementSubscriptionRequired(status: string, feature?: string) {
  const message = status === "NOT_ACTIVATED"
    ? "Property management has not been activated for this organisation."
    : status === "PAYMENT_PENDING"
      ? "Your payment is being confirmed. Property management features will resume as soon as the payment provider confirms it."
      : status === "SUSPENDED"
        ? "Property management is suspended for this organisation. Contact NesAfric support."
        : "Your property-management plan is not active. Choose a plan to continue managing your properties — your data is safe and still available.";
  return new AppError("PM_SUBSCRIPTION_REQUIRED", 402, message, { status, ...(feature ? { feature } : {}), billingPath: "/settings/billing" });
}
