import type { CampaignBanner } from "@/api/home";
import { filtersFromParams, type SearchFilters } from "@/marketplace/filters";
import { resolveMediaUrl } from "@/marketplace/format";

/** Where a featured slide's call to action goes. Every slide resolves to a real destination. */
export type SlideTarget =
  | { type: "listing"; id: string }
  | { type: "search"; filters: SearchFilters }
  | { type: "web"; url: string };

export type FeaturedSlide = {
  key: string;
  /** Every slide is a campaign; impressions and clicks are reported against it. */
  campaignId: string;
  /** Campaign headline is retained for accessibility only and is never painted over artwork. */
  title: string;
  /** Uploaded finished creative. Carousel slides are created only when artwork exists. */
  imageUrl: string;
  target: SlideTarget;
};

/** Aspect ratio of the native-app creative canvas (1200 × 792, see Super Admin → Campaigns). */
export const NATIVE_CREATIVE_RATIO = 792 / 1200;

const LISTING_PATH = /^\/marketplace\/properties\/([0-9a-f-]{36})\/?$/i;

/**
 * Maps a campaign destination onto the app: NesAfric listing and search pages open in the app,
 * anything else in the in-app browser. Only https (or the configured API origin) is followed.
 */
export function resolveDestination(destinationUrl: string, apiUrl: string): SlideTarget | null {
  let url: URL;
  try {
    url = new URL(destinationUrl, apiUrl);
  } catch {
    return null;
  }
  const api = new URL(apiUrl);
  const isNesAfric = url.origin === api.origin || url.hostname === "nesafric.com" || url.hostname.endsWith(".nesafric.com");
  if (isNesAfric) {
    const listing = LISTING_PATH.exec(url.pathname);
    if (listing) return { type: "listing", id: listing[1].toLowerCase() };
    if (url.pathname.replace(/\/$/, "") === "/marketplace/properties") {
      return { type: "search", filters: filtersFromParams(Object.fromEntries(url.searchParams)) };
    }
  }
  if (url.protocol !== "https:" && url.origin !== api.origin) return null;
  return { type: "web", url: url.toString() };
}

/**
 * Native-app artwork for a campaign, per the creative specification shown in Super Admin: the
 * native creative, else mobile web, else desktop. Mirrors `selectCampaignCreative(…, "nativeApp")`
 * in the web repo (`src/modules/campaigns/eligibility.ts`). A campaign without artwork is not rendered.
 */
export function nativeCampaignCreative(banner: Pick<CampaignBanner, "desktopMediaUrl" | "mobileMediaUrl" | "nativeAppMediaUrl">) {
  return banner.nativeAppMediaUrl ?? banner.mobileMediaUrl ?? banner.desktopMediaUrl ?? null;
}

/**
 * Advertising carousel slides: eligible campaigns only, in the server's priority order. Property
 * listings are never turned into advertising slides, and there is no substitute slide — with no
 * campaigns the result is empty and the carousel is hidden.
 */
export function buildFeaturedSlides(campaigns: CampaignBanner[], apiUrl: string, max = 5): FeaturedSlide[] {
  return campaigns.flatMap((banner): FeaturedSlide[] => {
    const target = resolveDestination(banner.destinationUrl, apiUrl);
    if (!target) return [];
    const media = nativeCampaignCreative(banner);
    if (!media) return [];
    return [{
      key: `campaign:${banner.id}`,
      campaignId: banner.id,
      title: banner.headline,
      imageUrl: resolveMediaUrl(media, apiUrl),
      target,
    }];
  }).slice(0, max);
}
