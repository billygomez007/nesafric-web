import type { PublicProvider } from "@/api/types";
import { DEFAULT_COUNTRY } from "@/marketplace/filters";
import type { ProviderFilters } from "@/marketplace/provider-filters";

/**
 * How a provider collection is drawn. Mixing these keeps Service Providers Home from reading as
 * the same shelf repeated (the same idea as the Properties discovery feed).
 * - `rail`: horizontal cards with the next one peeking.
 * - `grid`: two columns of compact cards.
 * - `compact`: stacked rows, avatar on the left.
 */
export type ProviderLayout = "rail" | "grid" | "compact";

/**
 * One Service Providers Home collection: a bounded query on the public provider discovery API
 * (the server only ever lists verified, listed providers) plus the Search filters its "See all"
 * opens. Nothing here ranks by distance or "newest": the public provider API has no data for
 * those, so there is no collection for them.
 */
export type ProviderCollection = {
  key: string;
  title: string;
  subtitle?: string;
  layout: ProviderLayout;
  filters: ProviderFilters;
  size: number;
  /** Fewer matching providers than this and the whole section is left out. */
  minItems: number;
  /**
   * A second, device-side guard on what the server returned (like `organic` on Properties Home):
   * a card only appears under a heading it truly matches.
   */
  matches?: (provider: PublicProvider) => boolean;
  seeAll?: ProviderFilters;
};

/** The first page of providers: the one query Service Providers Home always makes. */
export const ALL_PROVIDERS_SIZE = 20;
/** How many of them the "Service providers" grid shows. */
export const ALL_PROVIDERS_SHOWN = 5;

export const TOP_RATED_MINIMUM = 4;

export function isTopRated(provider: Pick<PublicProvider, "aggregateRating" | "ratingCount">) {
  return provider.aggregateRating !== null && provider.ratingCount > 0 && provider.aggregateRating >= TOP_RATED_MINIMUM;
}

export function isAvailableNow(provider: Pick<PublicProvider, "availability" | "acceptingWork">) {
  return provider.acceptingWork && provider.availability === "AVAILABLE";
}

export const TOP_RATED: ProviderCollection = {
  key: "top-rated",
  title: "Top rated",
  subtitle: `Rated ${TOP_RATED_MINIMUM}★ and above by NesAfric customers`,
  layout: "rail",
  filters: { minimumRating: String(TOP_RATED_MINIMUM) },
  size: 8,
  minItems: 2,
  matches: isTopRated,
  seeAll: { minimumRating: String(TOP_RATED_MINIMUM) },
};

export const AVAILABLE_NOW: ProviderCollection = {
  key: "available-now",
  title: "Available now",
  subtitle: "Taking new work this week",
  layout: "rail",
  filters: { availability: "AVAILABLE" },
  size: 8,
  minItems: 2,
  matches: isAvailableNow,
  seeAll: { availability: "AVAILABLE" },
};

export const COMPANIES: ProviderCollection = {
  key: "companies",
  title: "Service companies",
  layout: "grid",
  filters: { providerType: "COMPANY" },
  size: 4,
  minItems: 2,
  matches: (provider) => provider.type === "COMPANY",
  seeAll: { providerType: "COMPANY" },
};

export const INDIVIDUALS: ProviderCollection = {
  key: "individuals",
  title: "Independent professionals",
  layout: "compact",
  filters: { providerType: "INDIVIDUAL" },
  size: 4,
  minItems: 2,
  matches: (provider) => provider.type === "INDIVIDUAL",
  seeAll: { providerType: "INDIVIDUAL" },
};

/** A collection for one service, keyed exactly as providers list it (the API matches the key exactly). */
export function serviceCollection(category: { key: string; name: string }): ProviderCollection {
  const filters = { service: category.key };
  return {
    key: `service:${category.key}`,
    title: category.name,
    layout: "rail",
    filters,
    size: 8,
    minItems: 2,
    matches: (provider) => provider.categories.some((item) => item.key === category.key),
    seeAll: filters,
  };
}

/** Cards to show: what the server returned, passed through the collection's guard, capped. */
export function shown(collection: Pick<ProviderCollection, "matches" | "size">, items: PublicProvider[]) {
  return (collection.matches ? items.filter(collection.matches) : items).slice(0, collection.size);
}

/**
 * Services that at least `min` of the given providers offer, most providers first. Built from real
 * providers rather than the category list, so every service shelf has providers behind it.
 */
export function popularServices(providers: PublicProvider[], min = 2, max = 4) {
  const byKey = new Map<string, { key: string; name: string; count: number }>();
  for (const provider of providers) {
    for (const category of provider.categories) {
      const entry = byKey.get(category.key);
      if (entry) entry.count += 1;
      else byKey.set(category.key, { key: category.key, name: category.name, count: 1 });
    }
  }
  return [...byKey.values()]
    .filter((entry) => entry.count >= min)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, max)
    .map(({ key, name }) => ({ key, name }));
}

/**
 * Ghanaian cities that at least `min` of the given providers serve, most providers first. A sample
 * of the first page, so no counts are shown.
 */
export function popularProviderCities(providers: PublicProvider[], min = 2, max = 6) {
  const byCity = new Map<string, { city: string; count: number }>();
  for (const provider of providers) {
    const seen = new Set<string>();
    for (const area of provider.serviceAreas) {
      const city = area.city?.trim();
      if (!city || area.countryCode !== DEFAULT_COUNTRY) continue;
      const key = city.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = byCity.get(key);
      if (entry) entry.count += 1;
      else byCity.set(key, { city, count: 1 });
    }
  }
  return [...byCity.values()]
    .filter((entry) => entry.count >= min)
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))
    .slice(0, max)
    .map(({ city }) => city);
}
