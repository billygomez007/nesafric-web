import type { PublicListing } from "@/api/types";
import { DEFAULT_COUNTRY, type SearchFilters } from "@/marketplace/filters";
import { isVerified } from "@/marketplace/format";

/**
 * How a collection is drawn. Mixing these keeps Home from reading as the same rail repeated:
 * - `featured`: one large editorial card (Top Ads only).
 * - `rail`: horizontal cards with the next one peeking.
 * - `grid`: two columns of compact cards.
 * - `compact`: stacked rows, photo on the left.
 * - `cities`: city tiles built from real listings.
 */
export type DiscoveryLayout = "featured" | "rail" | "grid" | "compact" | "cities";

/**
 * One Home collection. Every one is a bounded query on the public listings API (the same eligibility
 * rules as Search: published, verified, available) plus the Search filters its "See all" opens.
 * Nothing here ranks by popularity, proximity, price history or "luxury": the API has no data for
 * those, so there is no collection for them.
 */
export type DiscoveryCollection = {
  key: string;
  title: string;
  subtitle?: string;
  layout: DiscoveryLayout;
  /** Filters for the collection's own query; `pageSize` is `size`. */
  filters: SearchFilters;
  size: number;
  /** Fewer eligible listings than this and the whole section is left out. */
  minItems: number;
  /** Where "See all" goes: the existing Search tab with these filters. Omitted: no See all. */
  seeAll?: SearchFilters;
};

/** The newest listings: the one query Home always makes; the hero, the city tiles and "Newly listed" all read it. */
export const NEWEST: DiscoveryCollection = { key: "newest", title: "Newly listed", subtitle: "Fresh on NesAfric this week and before", layout: "rail", filters: {}, size: 20, minItems: 1, seeAll: {} };

/**
 * The fixed collections under the always-on ones, in Home order. Each is fetched only when it is
 * about to scroll into view (see `DiscoveryFeed`). Personalisation later reorders or adds entries
 * here (saved searches, preferred type or price band) without touching the screen.
 */
export const CATEGORY_COLLECTIONS: DiscoveryCollection[] = [
  { key: "apartments", title: "Apartments", layout: "grid", filters: { category: "APARTMENT" }, size: 4, minItems: 2, seeAll: { category: "APARTMENT" } },
  { key: "for-rent", title: "Homes for rent", layout: "rail", filters: { listingType: "RENT" }, size: 8, minItems: 2, seeAll: { listingType: "RENT" } },
  { key: "houses", title: "Houses", layout: "compact", filters: { category: "HOUSE" }, size: 4, minItems: 2, seeAll: { category: "HOUSE" } },
  { key: "for-sale", title: "Property for sale", layout: "rail", filters: { listingType: "SALE" }, size: 8, minItems: 2, seeAll: { listingType: "SALE" } },
  { key: "land", title: "Land & plots", layout: "compact", filters: { category: "LAND" }, size: 4, minItems: 1, seeAll: { category: "LAND" } },
  { key: "commercial", title: "Commercial & offices", layout: "grid", filters: { category: "COMMERCIAL" }, size: 4, minItems: 2, seeAll: { category: "COMMERCIAL" } },
];

/** A city collection, for a city real listings are in. */
export function cityCollection(city: string): DiscoveryCollection {
  const filters = { city, country: DEFAULT_COUNTRY };
  return { key: `city:${city.toLowerCase()}`, title: `Homes in ${city}`, layout: "rail", filters, size: 8, minItems: 2, seeAll: filters };
}

/** Eligible listings only (the API already filters; this is a second guard), capped. */
export function eligible(items: PublicListing[], max: number, exclude: ReadonlySet<string> = new Set()) {
  return items.filter((item) => isVerified(item) && !exclude.has(item.id)).slice(0, max);
}

/** Admin-pinned Top Ads in the newest results: the only real "featured" signal NesAfric has. */
export function topAds(items: PublicListing[]) {
  return eligible(items, 3).filter((item) => item.isTopAd === true);
}

export type CityTile = { city: string; listing: PublicListing };

/**
 * Cities that appear in at least `min` of the given listings, most listings first, each with one of
 * its own listings for the tile photo. No counts are shown: this is a sample, not an inventory.
 */
export function popularCities(items: PublicListing[], min = 2, max = 6): CityTile[] {
  const byCity = new Map<string, { city: string; count: number; listing: PublicListing }>();
  for (const item of eligible(items, items.length)) {
    const city = item.location.city?.trim();
    if (!city || item.location.countryCode !== DEFAULT_COUNTRY) continue;
    const key = city.toLowerCase();
    const entry = byCity.get(key);
    if (entry) entry.count += 1;
    else byCity.set(key, { city, count: 1, listing: item });
  }
  return [...byCity.values()]
    .filter((entry) => entry.count >= min)
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))
    .slice(0, max)
    .map(({ city, listing }) => ({ city, listing }));
}
