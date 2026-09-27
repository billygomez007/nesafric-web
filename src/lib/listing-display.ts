/**
 * Presentation helpers for public listings: turn stored enum values into the words a renter or
 * buyer would use. Display only — never used for filtering, analytics or API payloads.
 */

import { priceUnitSuffix } from "@/lib/price-units";

const LISTING_TYPE_LABELS: Record<string, string> = { RENT: "For rent", SALE: "For sale" };
const SCOPE_LABELS: Record<string, string> = { PROPERTY: "Whole property", UNIT: "Unit" };

/** "SERVICED_APARTMENT" / "serviced apartment" -> "Serviced apartment". */
export function humanize(value: string | null | undefined): string {
  if (!value) return "";
  const words = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function listingTypeLabel(value: string): string {
  return LISTING_TYPE_LABELS[value] ?? humanize(value);
}

export function scopeLabel(value: string): string {
  return SCOPE_LABELS[value] ?? humanize(value);
}

/**
 * Unit after a price, without the slash: "month", "day", "m²", "km". "" for a total sale price,
 * CUSTOM terms or an unknown value. Rendered as "GH₵1,200 / m²".
 */
export function priceUnitText(listingType: string, unit: string | null | undefined): string {
  return priceUnitSuffix(listingType, unit).replace(/^\//, "");
}

/**
 * Price in whole currency units from a minor-unit string. Ghana cedi uses the en-GH locale so it
 * renders as "GH₵8,500"; pesewas are only shown when the amount is not whole.
 */
export function formatListingPrice(amountMinor: string, currencyCode: string): string {
  const value = Number(amountMinor) / 100;
  const whole = Number.isInteger(value);
  const locale = currencyCode === "GHS" ? "en-GH" : "en";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(value);
  } catch {
    return `${currencyCode} ${value.toLocaleString("en")}`;
  }
}

/** Most-specific-first public location line, e.g. "East Legon, Accra". */
export function listingLocation(location: {
  label: string | null;
  locality?: string | null;
  district: string | null;
  city: string | null;
  region: string | null;
  countryCode: string;
}): string {
  if (location.label) return location.label;
  const parts = [location.locality, location.district, location.city].filter(Boolean);
  if (parts.length) return parts.slice(0, 2).join(", ");
  return [location.region, location.countryCode].filter(Boolean).join(", ");
}

/** "4 bed · 3 bath · 320 m²" — omits anything not provided instead of printing dashes. */
export function specLine(attributes: { bedrooms: number | null; bathrooms: string | null; sizeSqm: string | null }): string[] {
  const parts: string[] = [];
  if (attributes.bedrooms !== null && attributes.bedrooms !== undefined) {
    parts.push(attributes.bedrooms === 0 ? "Studio" : `${attributes.bedrooms} bed`);
  }
  if (attributes.bathrooms) parts.push(`${Number(attributes.bathrooms)} bath`);
  if (attributes.sizeSqm) parts.push(`${Number(attributes.sizeSqm).toLocaleString("en")} m²`);
  return parts;
}
