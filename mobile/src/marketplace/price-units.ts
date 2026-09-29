import { isBookableCategory } from "./listing-categories";

/**
 * Listing price units — mirror of the web repo's `src/lib/price-units.ts` (the API validates the
 * same list). A price unit is how the price is charged, never the property's size: "750 m²" is
 * area, "GH₵1,200/m²" is price.
 */

export const LISTING_PRICE_UNITS = ["DAILY", "MONTHLY", "QUARTERLY", "ANNUAL", "PER_SQM", "PER_KM", "CUSTOM", "PER_NIGHT"] as const;
export type ListingPriceUnit = (typeof LISTING_PRICE_UNITS)[number];

/** Units a sale may be quoted in. A sale with no unit is a total price. */
export const SALE_PRICE_UNITS = ["PER_SQM", "PER_KM"] as const satisfies readonly ListingPriceUnit[];

export const PRICE_UNIT_LABELS: Record<ListingPriceUnit, string> = {
  DAILY: "Per day",
  MONTHLY: "Per month",
  QUARTERLY: "Per quarter",
  ANNUAL: "Per year",
  PER_SQM: "Per square metre (m²)",
  PER_KM: "Per kilometre (km)",
  CUSTOM: "Custom terms",
  PER_NIGHT: "Per night",
};

const PRICE_UNIT_SUFFIX: Record<ListingPriceUnit, string> = {
  DAILY: "/day",
  MONTHLY: "/month",
  QUARTERLY: "/quarter",
  ANNUAL: "/year",
  PER_SQM: "/m²",
  PER_KM: "/km",
  CUSTOM: "",
  PER_NIGHT: "/night",
};

export function isListingPriceUnit(value: unknown): value is ListingPriceUnit {
  return typeof value === "string" && (LISTING_PRICE_UNITS as readonly string[]).includes(value);
}

function isSalePriceUnit(value: unknown) {
  return typeof value === "string" && (SALE_PRICE_UNITS as readonly string[]).includes(value);
}

/** Hotels and short stays are priced per night, and only they are. */
export const STAY_PRICE_UNITS = ["PER_NIGHT"] as const satisfies readonly ListingPriceUnit[];
const RENT_PRICE_UNITS = LISTING_PRICE_UNITS.filter((unit) => unit !== "PER_NIGHT");

/** Units offered for a listing type (and category), in display order. */
export function priceUnitsFor(listingType: string, category?: string | null): readonly ListingPriceUnit[] {
  if (isBookableCategory(category)) return STAY_PRICE_UNITS;
  return listingType === "SALE" ? SALE_PRICE_UNITS : RENT_PRICE_UNITS;
}

/** "/month", "/m²", or "" for a total sale price, CUSTOM terms or an unknown value. */
export function priceUnitSuffix(listingType: string, unit: string | null | undefined) {
  if (!isListingPriceUnit(unit)) return "";
  if (listingType === "SALE" && !isSalePriceUnit(unit)) return "";
  return PRICE_UNIT_SUFFIX[unit];
}
