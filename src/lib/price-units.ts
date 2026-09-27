/**
 * Listing price units: the basis a listing's price is quoted on. Stored in `Listing.frequency`
 * (Prisma enum `ListingPriceUnit`) and shared by the API validation, the web forms and every price
 * display, so a unit can never be accepted in one place and mislabelled in another.
 *
 * A price unit is never the property's size: "750 m²" is area (`sizeSqm`), "GH₵1,200/m²" is price.
 * The mobile app mirrors this list in `mobile/src/marketplace/price-units.ts`.
 */

export const LISTING_PRICE_UNITS = ["DAILY", "MONTHLY", "QUARTERLY", "ANNUAL", "PER_SQM", "PER_KM", "CUSTOM"] as const;
export type ListingPriceUnit = (typeof LISTING_PRICE_UNITS)[number];

/** Units a sale may be quoted in. A sale with no unit is a total price. */
export const SALE_PRICE_UNITS = ["PER_SQM", "PER_KM"] as const satisfies readonly ListingPriceUnit[];

/** Units that are also lease rent periods (`RentFrequency`), so a listing can seed a lease. */
export const LEASE_RENT_PERIODS = ["MONTHLY", "QUARTERLY", "ANNUAL", "CUSTOM"] as const satisfies readonly ListingPriceUnit[];

export const PRICE_UNIT_LABELS: Record<ListingPriceUnit, string> = {
  DAILY: "Per day",
  MONTHLY: "Per month",
  QUARTERLY: "Per quarter",
  ANNUAL: "Per year",
  PER_SQM: "Per square metre (m²)",
  PER_KM: "Per kilometre (km)",
  CUSTOM: "Custom terms",
};

/** Suffix after an amount: "GH₵1,200/m²". CUSTOM has none (its terms are in the description). */
const PRICE_UNIT_SUFFIX: Record<ListingPriceUnit, string> = {
  DAILY: "/day",
  MONTHLY: "/month",
  QUARTERLY: "/quarter",
  ANNUAL: "/year",
  PER_SQM: "/m²",
  PER_KM: "/km",
  CUSTOM: "",
};

export function isListingPriceUnit(value: unknown): value is ListingPriceUnit {
  return typeof value === "string" && (LISTING_PRICE_UNITS as readonly string[]).includes(value);
}

export function isSalePriceUnit(value: unknown): value is (typeof SALE_PRICE_UNITS)[number] {
  return typeof value === "string" && (SALE_PRICE_UNITS as readonly string[]).includes(value);
}

export function isLeaseRentPeriod(value: unknown): value is (typeof LEASE_RENT_PERIODS)[number] {
  return typeof value === "string" && (LEASE_RENT_PERIODS as readonly string[]).includes(value);
}

/** Units offered in a listing form for the chosen listing type, in display order. */
export function priceUnitsFor(listingType: string): readonly ListingPriceUnit[] {
  return listingType === "SALE" ? SALE_PRICE_UNITS : LISTING_PRICE_UNITS;
}

export function priceUnitLabel(unit: string | null | undefined): string {
  return isListingPriceUnit(unit) ? PRICE_UNIT_LABELS[unit] : "";
}

/**
 * "/month", "/m²", or "" (a total sale price, CUSTOM terms, or an unknown value). A rent period on
 * a sale is ignored rather than shown, since the API never stores one.
 */
export function priceUnitSuffix(listingType: string, unit: string | null | undefined): string {
  if (!isListingPriceUnit(unit)) return "";
  if (listingType === "SALE" && !isSalePriceUnit(unit)) return "";
  return PRICE_UNIT_SUFFIX[unit];
}
