import type { ListingMedia, PublicListing } from "@/api/types";

const CURRENCY_SYMBOLS: Record<string, string> = { GHS: "GH₵", USD: "US$", NGN: "₦", KES: "KSh ", EUR: "€", GBP: "£" };
const FREQUENCY_SUFFIX: Record<string, string> = { MONTHLY: "/month", QUARTERLY: "/quarter", ANNUAL: "/year" };

function groupThousands(integer: string) {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Formats integer minor units ("850000") as "GH₵8,500". Drops ".00", keeps real pesewas/cents. */
export function formatMoney(amountMinor: string, currencyCode: string) {
  const digits = amountMinor.replace(/^-/, "").padStart(3, "0");
  const major = groupThousands(digits.slice(0, -2).replace(/^0+(?=\d)/, ""));
  const minor = digits.slice(-2);
  const symbol = CURRENCY_SYMBOLS[currencyCode] ?? `${currencyCode} `;
  return `${symbol}${major}${minor === "00" ? "" : `.${minor}`}`;
}

/** "GH₵8,500/month" for rentals, "US$250,000" for sales; null when the listing has no price. */
export function formatListingPrice(listing: Pick<PublicListing, "listingType" | "pricing">) {
  const { pricing } = listing;
  const amount = listing.listingType === "RENT" ? pricing.rentAmountMinor : pricing.askingAmountMinor;
  if (!amount) return null;
  const suffix = listing.listingType === "RENT" && pricing.frequency ? FREQUENCY_SUFFIX[pricing.frequency] ?? "" : "";
  return `${formatMoney(amount, pricing.currencyCode)}${suffix}`;
}

export function formatLocation(location: PublicListing["location"]) {
  if (location.label) return location.label;
  const parts = [location.locality ?? location.district, location.city ?? location.region].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** "4 Beds · 3 Baths · 320 m²"; omits unknown values rather than showing zeros. */
export function formatFacts(attributes: PublicListing["attributes"]) {
  const facts: string[] = [];
  if (attributes.bedrooms !== null) facts.push(`${attributes.bedrooms} ${attributes.bedrooms === 1 ? "Bed" : "Beds"}`);
  if (attributes.bathrooms !== null) {
    const baths = Number(attributes.bathrooms);
    facts.push(`${trimNumber(baths)} ${baths === 1 ? "Bath" : "Baths"}`);
  }
  if (attributes.sizeSqm !== null) facts.push(`${groupThousands(trimNumber(Number(attributes.sizeSqm)))} m²`);
  return facts.join(" · ");
}

function trimNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

/** "SEMI_DETACHED" -> "Semi detached". */
export function humanise(value: string) {
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Public photos only, cover first; resolves relative `/api/public/media/...` paths. */
export function listingPhotos(media: ListingMedia[], apiUrl: string) {
  return media
    .filter((item) => item.type === "PHOTO" && item.url)
    .sort((a, b) => Number(b.isCover) - Number(a.isCover))
    .map((item) => ({ ...item, url: resolveMediaUrl(item.url!, apiUrl) }));
}

export function resolveMediaUrl(url: string, apiUrl: string) {
  return /^https?:\/\//i.test(url) ? url : `${apiUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function isVerified(listing: Pick<PublicListing, "verification">) {
  return listing.verification.status === "VERIFIED";
}
