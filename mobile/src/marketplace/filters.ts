import type { ListingType } from "@/api/types";

/**
 * Search filters the public listings API supports today (`publicListingSearchSchema`). Filters the
 * brief mentions but the API cannot answer yet (furnished, new developments, amenities by label,
 * geo-bounds) are intentionally absent rather than faked client-side.
 */
export type SearchFilters = {
  q?: string;
  listingType?: ListingType;
  category?: string;
  city?: string;
  minPrice?: string; // major units as typed by the user, e.g. "5000"
  maxPrice?: string;
  currencyCode?: string;
  bedroomsMin?: string;
  bathroomsMin?: string;
  /** ISO country; the API requires it with any city filter. Defaults to Ghana (launch market). */
  country?: string;
};

export const DEFAULT_COUNTRY = "GH";

/** Categories as stored by the web listing forms (`PROPERTY_TYPES`). */
export const PROPERTY_TYPES = [
  { value: "HOUSE", label: "Houses" },
  { value: "APARTMENT", label: "Apartments" },
  { value: "TOWNHOUSE", label: "Townhouses" },
  { value: "VILLA", label: "Villas" },
  { value: "LAND", label: "Land" },
  { value: "COMMERCIAL", label: "Commercial" },
  { value: "OFFICE", label: "Offices" },
  { value: "SHOP", label: "Shops" },
  { value: "HOTEL", label: "Hotels" },
  { value: "SHORT_STAY", label: "Short stays" },
  { value: "WAREHOUSE", label: "Warehouses" },
] as const;

export const INTENTS: { label: string; filters: SearchFilters }[] = [
  { label: "Hotels", filters: { category: "HOTEL" } },
  { label: "Short stays", filters: { category: "SHORT_STAY" } },
  { label: "Rent", filters: { listingType: "RENT" } },
  { label: "Buy", filters: { listingType: "SALE" } },
  { label: "Land", filters: { category: "LAND" } },
  { label: "Commercial", filters: { category: "COMMERCIAL" } },
  { label: "Warehouses", filters: { category: "WAREHOUSE" } },
];

const MAX_MAJOR = 1_000_000_000_000;

/** Parses a user-typed amount ("8,500") into minor units, or null if it isn't a sane number. */
export function majorToMinor(value: string | undefined) {
  if (!value) return undefined;
  const cleaned = value.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  if (amount > MAX_MAJOR) return null;
  return Math.round(amount * 100);
}

export function validateFilters(filters: SearchFilters): Partial<Record<keyof SearchFilters, string>> {
  const errors: Partial<Record<keyof SearchFilters, string>> = {};
  const min = majorToMinor(filters.minPrice);
  const max = majorToMinor(filters.maxPrice);
  if (min === null) errors.minPrice = "Enter a valid amount.";
  if (max === null) errors.maxPrice = "Enter a valid amount.";
  if (typeof min === "number" && typeof max === "number" && min > max) errors.maxPrice = "Maximum must be at least the minimum.";
  if (filters.q && filters.q.trim().length === 1) errors.q = "Type at least 2 characters.";
  return errors;
}

/** Maps filters onto the API's query-string contract. Assumes `validateFilters` passed. */
export function filtersToQuery(filters: SearchFilters): Record<string, string | undefined> {
  const min = majorToMinor(filters.minPrice);
  const max = majorToMinor(filters.maxPrice);
  const hasPrice = typeof min === "number" || typeof max === "number";
  const q = filters.q?.trim();
  const city = filters.city?.trim() || undefined;
  return {
    q: q && q.length >= 2 ? q : undefined,
    listingType: filters.listingType,
    category: filters.category,
    city,
    country: city ? filters.country ?? DEFAULT_COUNTRY : undefined,
    minPriceMinor: typeof min === "number" ? String(min) : undefined,
    maxPriceMinor: typeof max === "number" ? String(max) : undefined,
    // Price bounds are only meaningful in one currency; default to cedis for Ghana.
    currencyCode: hasPrice ? filters.currencyCode ?? "GHS" : undefined,
    bedroomsMin: filters.bedroomsMin || undefined,
    bathroomsMin: filters.bathroomsMin || undefined,
  };
}

export function activeFilterCount(filters: SearchFilters) {
  const { q: _q, ...rest } = filters;
  return Object.values(rest).filter((value) => value !== undefined && value !== "").length;
}

/** Route params are strings; keep only the keys we understand. */
export function filtersFromParams(params: Record<string, string | string[] | undefined>): SearchFilters {
  const pick = (key: keyof SearchFilters) => {
    const value = params[key];
    return typeof value === "string" && value ? value : undefined;
  };
  const listingType = pick("listingType");
  return {
    q: pick("q"),
    listingType: listingType === "RENT" || listingType === "SALE" ? listingType : undefined,
    category: pick("category"),
    city: pick("city"),
    minPrice: pick("minPrice"),
    maxPrice: pick("maxPrice"),
    currencyCode: pick("currencyCode"),
    bedroomsMin: pick("bedroomsMin"),
    bathroomsMin: pick("bathroomsMin"),
    country: pick("country"),
  };
}
