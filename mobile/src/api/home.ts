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

/** A company in the homepage trusted-company rail (`GET /api/public/homepage-companies`). */
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

/**
 * The same curated rail as the website homepage: companies a NesAfric admin published in Homepage
 * Media, in their order. The server returns only active, verified companies of a company type
 * (never individual agents or brokers), so an admin unpublishing one removes it here too.
 */
export const getVerifiedCompanies = (api: ApiClient) =>
  api.request<{ items: DirectoryCompany[] }>("/api/public/homepage-companies");
