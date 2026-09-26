import type { CampaignBanner } from "@/api/home";
import type { PublicListing } from "@/api/types";
import { filtersFromParams, type SearchFilters } from "@/marketplace/filters";
import { formatListingPrice, formatLocation, listingPhotos, resolveMediaUrl } from "@/marketplace/format";

/** Where a featured slide's call to action goes. Every slide resolves to a real destination. */
export type SlideTarget =
  | { type: "listing"; id: string }
  | { type: "search"; filters: SearchFilters }
  | { type: "web"; url: string };

export type FeaturedSlide = {
  key: string;
  /** Set only for paid campaign slides, which report impressions and clicks. */
  campaignId?: string;
  eyebrow: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  ctaLabel: string;
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
 * Featured carousel content, most specific first:
 * 1. live MARKETPLACE_PRIMARY campaigns (labelled "Sponsored");
 * 2. otherwise the newest published listings that have a photo (real inventory, not ads);
 * 3. otherwise one NesAfric-owned slide inviting owners to list — never placeholder properties.
 */
export function buildFeaturedSlides(campaigns: CampaignBanner[], listings: PublicListing[], apiUrl: string, max = 5): FeaturedSlide[] {
  const sponsored = campaigns.flatMap((banner): FeaturedSlide[] => {
    const target = resolveDestination(banner.destinationUrl, apiUrl);
    if (!target) return [];
    const media = banner.mobileMediaUrl ?? banner.desktopMediaUrl;
    return [{
      key: `campaign:${banner.id}`,
      campaignId: banner.id,
      eyebrow: "Sponsored",
      title: banner.headline,
      subtitle: banner.supportingText,
      imageUrl: media ? resolveMediaUrl(media, apiUrl) : null,
      ctaLabel: banner.ctaLabel ?? "Learn more",
      target,
    }];
  });
  if (sponsored.length) return sponsored.slice(0, max);

  const properties = listings.flatMap((listing): FeaturedSlide[] => {
    const photo = listingPhotos(listing.media, apiUrl)[0];
    if (!photo) return [];
    const details = [formatListingPrice(listing), formatLocation(listing.location)].filter(Boolean).join(" · ");
    return [{
      key: `listing:${listing.id}`,
      eyebrow: listing.listingType === "RENT" ? "New to rent" : "New for sale",
      title: listing.title,
      subtitle: details || null,
      imageUrl: photo.url,
      ctaLabel: "View property",
      target: { type: "listing", id: listing.id },
    }];
  });
  if (properties.length) return properties.slice(0, max);

  return [{
    key: "nesafric:list-your-property",
    eyebrow: "From NesAfric",
    title: "List your property on NesAfric",
    subtitle: "Reach renters and buyers across Ghana.",
    imageUrl: null,
    ctaLabel: "List a property",
    target: { type: "web", url: `${apiUrl}/for-professionals` },
  }];
}
