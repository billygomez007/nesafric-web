import type { ApiClient } from "./client";

/** Public campaign projection (`GET /api/public/campaigns?limit=…`), mirrored from the web API. */
export type CampaignBanner = {
  id: string;
  placement: string;
  headline: string;
  supportingText: string | null;
  ctaLabel: string | null;
  destinationUrl: string;
  desktopMediaUrl: string | null;
  mobileMediaUrl: string | null;
  /** Native-app artwork (1200 x 480; older uploads may be 1200 x 792). Older API responses may omit it. */
  nativeAppMediaUrl?: string | null;
};

/** A company in the homepage trusted-company rail (`GET /api/public/homepage-companies`). */
export type DirectoryCompany = {
  slug: string;
  displayName: string;
  type: string;
  logoUrl: string | null;
  verificationStatus: string;
};

/**
 * Marketplace advertising carousels use independent placements.
 * Property Marketplace uses `MARKETPLACE_INLINE`; Service Provider Marketplace uses
 * `SERVICE_MARKETPLACE_PRIMARY`. Campaign eligibility remains server-controlled.
 */
export const getFeaturedCampaigns = (
  api: ApiClient,
  placement: "MARKETPLACE_PRIMARY" | "MARKETPLACE_INLINE" | "SERVICE_MARKETPLACE_PRIMARY",
  limit = 6,
) =>
  api.request<{ banners: CampaignBanner[]; /** Placement-wide Super Admin setting: 5, 8 or 10. Older APIs omit it. */ rotationSeconds?: number }>("/api/public/campaigns", { query: { placement, countryCode: "GH", limit } });

export const recordCampaignImpression = (api: ApiClient, campaignId: string) =>
  api.request<unknown>(`/api/public/campaigns/${encodeURIComponent(campaignId)}/impression`, { method: "POST" });

export const recordCampaignClick = (api: ApiClient, campaignId: string) =>
  api.request<unknown>(`/api/public/campaigns/${encodeURIComponent(campaignId)}/click`, { method: "POST" });

/**
 * The same curated rail as the website homepage: companies a NesAfric admin published in Homepage
 * Media, in their order. The server returns only active, verified companies of a company type
 * (never individual agents or brokers), so an admin unpublishing one removes it here too.
 */
export const getVerifiedCompanies = (api: ApiClient) =>
  api.request<{ items: DirectoryCompany[] }>("/api/public/homepage-companies");
