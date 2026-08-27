/**
 * Conversion-tracking readiness for the Ghana launch campaign. No analytics provider is wired up
 * yet, so this only pushes onto the standard `window.dataLayer` array (the GTM/GA4 convention) —
 * a no-op until a real container is installed, and safe to call from anywhere without pulling in
 * a vendor SDK. Swap the implementation, not every call site, once a provider is chosen.
 */
declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

export type CampaignEventName =
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
  | "manage_properties_registration_completed";

export function trackCampaignEvent(event: CampaignEventName, params: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  window.dataLayer ??= [];
  window.dataLayer.push({ event, ...params });
}
