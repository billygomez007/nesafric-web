/**
 * Central GA4 configuration and event-tracking surface. The tag itself is loaded exactly once, in
 * the root layout, via `@next/third-parties/google`'s `<GoogleAnalytics>` component. Nothing else
 * should call `sendGAEvent` or touch `window.dataLayer` directly — go through `trackEvent` below so
 * every future analytics change (provider swap, param shape, PII rule) has one place to happen.
 */
import { sendGAEvent } from "@next/third-parties/google";

/**
 * Unset outside the real production environment (see `.env.production.local` / the Vercel
 * dashboard) — deliberately has no hardcoded fallback, unlike `BRAND.siteUrl`. A missing value
 * disables the tag entirely (`<GoogleAnalytics>` in the root layout only renders when this is
 * set), so local dev and Preview deployments never send traffic into the production GA4 property.
 */
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export function isAnalyticsEnabled(): boolean {
  return Boolean(GA_MEASUREMENT_ID);
}

/**
 * The complete UmoAfric analytics event taxonomy. Adding a name here only makes it a valid
 * `trackEvent` argument — instrumenting a specific call site is a separate, deliberate change.
 *
 * WIRED (Phase 1 — marketing pages/components, via `trackCampaignEvent`, the pre-GA4 alias kept in
 * `@/components/marketing/campaign-tracking` for existing call sites):
 *   ghana_landing_view, for_professionals_view, for_developers_view, for_property_owners_view,
 *   join_free_click, marketplace_visit_click, manage_properties_selected, market_properties_selected,
 *   professional_registration_started, professional_registration_completed,
 *   developer_registration_completed, manage_properties_registration_completed,
 *   service_professional_registration_started, service_provider_registration_started,
 *   service_provider_registration_completed
 *
 * WIRED (Phase 2 — business/conversion instrumentation, fired only at a true success point; see
 * the Phase 2 audit report for the exact trigger and file per event):
 *   sign_up, login, onboarding_started, onboarding_completed, offer_property_services_selected,
 *   property_search, property_view, property_enquiry, professional_profile_view,
 *   service_provider_view, service_provider_enquiry
 *
 * RESERVED (typed and ready, but not called anywhere — the underlying feature either doesn't exist
 * yet or can't reliably confirm success; see the Phase 2 audit report for why each is withheld):
 *   professional_enquiry, professional_contact_click, development_view, development_enquiry,
 *   subscription_started, demo_request
 */
export type AnalyticsEvent =
  | "ghana_landing_view"
  | "for_professionals_view"
  | "for_developers_view"
  | "for_property_owners_view"
  | "join_free_click"
  | "marketplace_visit_click"
  | "manage_properties_selected"
  | "market_properties_selected"
  | "professional_registration_started"
  | "professional_registration_completed"
  | "developer_registration_completed"
  | "manage_properties_registration_completed"
  | "service_professional_registration_started"
  | "service_provider_registration_started"
  | "service_provider_registration_completed"
  | "sign_up"
  | "login"
  | "onboarding_started"
  | "onboarding_completed"
  | "offer_property_services_selected"
  | "property_search"
  | "property_view"
  | "property_enquiry"
  | "professional_profile_view"
  | "professional_enquiry"
  | "professional_contact_click"
  | "service_provider_view"
  | "service_provider_enquiry"
  | "development_view"
  | "development_enquiry"
  | "subscription_started"
  | "demo_request";

/**
 * Safe, non-identifying parameter values only. Attribute by category/type/placement (e.g.
 * `{ placement: "ghana_hero" }`, `{ propertyType: "apartment" }`), never by identity — a name,
 * email address, phone number, Ghana Card/document detail, private message, payment credential, or
 * any other tenant/personal or sensitive property-management data must never be passed here.
 */
export type AnalyticsEventParams = Record<string, string | number | boolean>;

export function trackEvent(event: AnalyticsEvent, params: AnalyticsEventParams = {}) {
  if (typeof window === "undefined" || !isAnalyticsEnabled()) return;
  sendGAEvent("event", event, params);
}

/**
 * Trims and caps a business-authored string (a listing's category, a search field, a location
 * name) for safe use as an event parameter — returns `undefined` for empty/missing input so it can
 * be dropped from the params object entirely rather than sent as `""`. Not a PII filter: only ever
 * pass values that are already known to be non-identifying (see the taxonomy comment above and the
 * Phase 2 audit report for what each event's parameters are sourced from).
 */
export function categorical(value: string | null | undefined, maxLength = 60): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

/** Drops `undefined` entries so callers can build a params object with optional fields inline. */
export function compactParams(params: Record<string, string | number | boolean | undefined>): AnalyticsEventParams {
  const result: AnalyticsEventParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}
