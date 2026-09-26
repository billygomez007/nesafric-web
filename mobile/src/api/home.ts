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
};

/** Verified professional as returned by the public directory (only the fields the app shows). */
export type DirectoryCompany = {
  slug: string;
  displayName: string;
  type: string;
  logoUrl: string | null;
  verificationStatus: string;
};

/** Marketplace hero placement — the same campaigns the website's homepage carousel shows. */
export const getFeaturedCampaigns = (api: ApiClient, limit = 6) =>
  api.request<{ banners: CampaignBanner[] }>("/api/public/campaigns", { query: { placement: "MARKETPLACE_PRIMARY", countryCode: "GH", limit } });

export const recordCampaignImpression = (api: ApiClient, campaignId: string) =>
  api.request<unknown>(`/api/public/campaigns/${encodeURIComponent(campaignId)}/impression`, { method: "POST" });

export const recordCampaignClick = (api: ApiClient, campaignId: string) =>
  api.request<unknown>(`/api/public/campaigns/${encodeURIComponent(campaignId)}/click`, { method: "POST" });

/** Verified companies only — the directory never lists unverified profiles here. */
export const getVerifiedCompanies = (api: ApiClient, pageSize = 12) =>
  api.request<{ items: DirectoryCompany[]; total: number }>("/api/public/marketplace-directory", { query: { verifiedOnly: "true", page: 1, pageSize } });
