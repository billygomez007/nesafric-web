/**
 * Backward-compatible alias for the existing marketing call sites (`PageViewTracker`, onboarding
 * forms, hero CTAs) — the real implementation, event taxonomy, and GA4 wiring now live in
 * `@/platform/analytics`. Import from there directly in new code; this file exists only so the
 * pre-GA4 call sites didn't need to change.
 */
export { trackEvent as trackCampaignEvent, type AnalyticsEvent as CampaignEventName } from "@/platform/analytics";
