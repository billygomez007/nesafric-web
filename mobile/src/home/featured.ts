import type { CampaignBanner } from "@/api/home";
import { filtersFromParams, type SearchFilters } from "@/marketplace/filters";
import { resolveMediaUrl } from "@/marketplace/format";

/** Where a campaign's artwork opens when tapped. Every slide resolves to a real destination. */
export type SlideTarget =
  | { type: "listing"; id: string }
  | { type: "search"; filters: SearchFilters }
  | { type: "web"; url: string };

/**
 * A campaign slide: the advertiser's uploaded artwork is the whole ad and is shown untouched, with
 * nothing drawn over it. The headline is kept only as the accessible name, never rendered.
 */
export type FeaturedSlide = {
  key: string;
  campaignId: string;
  headline: string;
  imageUrl: string;
  target: SlideTarget;
};

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
 * native creative (1200 x 792), else mobile web, else desktop. Blank URLs count as missing. Mirrors
 * `selectCampaignCreative(…, "nativeApp")` in the web repo (`src/modules/campaigns/eligibility.ts`).
 */
export function nativeCampaignCreative(banner: Pick<CampaignBanner, "desktopMediaUrl" | "mobileMediaUrl" | "nativeAppMediaUrl">) {
  return [banner.nativeAppMediaUrl, banner.mobileMediaUrl, banner.desktopMediaUrl].find((url): url is string => Boolean(url?.trim())) ?? null;
}

/**
 * Advertising carousel slides: eligible campaigns with usable artwork only, in the server's
 * priority order. A campaign without artwork or a safe destination is skipped. Property listings
 * are never turned into advertising slides, and there is no substitute or text-only slide — with no
 * campaigns left the result is empty and the carousel is hidden.
 */
export function buildFeaturedSlides(campaigns: CampaignBanner[], apiUrl: string, max = 5): FeaturedSlide[] {
  return campaigns.flatMap((banner): FeaturedSlide[] => {
    const target = resolveDestination(banner.destinationUrl, apiUrl);
    const media = nativeCampaignCreative(banner);
    if (!target || !media) return [];
    return [{ key: `campaign:${banner.id}`, campaignId: banner.id, headline: banner.headline, imageUrl: resolveMediaUrl(media, apiUrl), target }];
  }).slice(0, max);
}
