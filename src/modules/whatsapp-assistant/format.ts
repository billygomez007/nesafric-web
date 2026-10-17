import { absoluteUrl } from "@/platform/brand";
import { formatListingPrice, listingLocation, priceUnitText, specLine } from "@/lib/listing-display";
import { categoryLabel } from "./nlu";
import { referenceFor } from "./references";

/** Public property page — the same stable URL the website and sitemap use. */
export const propertyUrl = (listingId: string) => absoluteUrl(`/marketplace/properties/${listingId}`);
export const providerUrl = (provider: { id: string; slug: string | null }) =>
  absoluteUrl(provider.slug ? `/marketplace/services/${provider.slug}` : `/marketplace/${provider.id}`);

export function priceText(listingType: string, pricing: { askingAmountMinor: string | null; rentAmountMinor: string | null; currencyCode: string; frequency: string | null }) {
  const amount = listingType === "RENT" ? pricing.rentAmountMinor : pricing.askingAmountMinor;
  if (!amount) return "Price on request";
  const unit = priceUnitText(listingType, pricing.frequency);
  return `${formatListingPrice(amount, pricing.currencyCode)}${unit ? `/${unit}` : ""}`;
}

export const moneyText = (minor: string, currency = "GHS") => formatListingPrice(minor, currency);

export type PublicListingCard = {
  id: string;
  listingType: string;
  category: string;
  title: string;
  pricing: { askingAmountMinor: string | null; rentAmountMinor: string | null; currencyCode: string; frequency: string | null };
  availability: { availableFrom: Date | string };
  attributes: { bedrooms: number | null; bathrooms: string | null; sizeSqm: string | null };
  location: { countryCode: string; region: string | null; city: string | null; district: string | null; locality: string | null; label: string | null };
  media: Array<{ type: string; url: string; isCover: boolean }>;
  verification: { status: string };
  attribution?: { listedBy: string; professional: { displayName: string } } | null;
};

export function availabilityText(from: Date | string, now: Date) {
  const date = new Date(from);
  if (Number.isNaN(date.getTime()) || date <= now) return "Available now";
  return `Available from ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
}

/** A WhatsApp result card built only from the stored public listing record. */
export function listingCard(listing: PublicListingCard, index: number | null, now: Date) {
  const specs = specLine(listing.attributes);
  const lines = [
    `*${index !== null ? `${index}. ` : ""}${listing.title}*`,
    `💰 ${priceText(listing.listingType, listing.pricing)}`,
    `🏠 ${[categoryLabel(listing.category), ...specs].join(" · ")}`,
    `📍 ${listingLocation(listing.location)}`,
    `${listing.verification.status === "VERIFIED" ? "✅ Verified by NesAfric" : "Not yet verified"} · ${availabilityText(listing.availability.availableFrom, now)}`,
    ...(listing.attribution ? [`👤 ${listing.attribution.listedBy}: ${listing.attribution.professional.displayName}`] : []),
    `Ref: ${referenceFor("PR", listing.id)}`,
    `🔗 ${propertyUrl(listing.id)}`,
  ];
  return lines.join("\n");
}

/** An absolute https photo URL WhatsApp can fetch, or null (never a guessed URL). */
export function coverImageUrl(listing: Pick<PublicListingCard, "media">) {
  const photos = listing.media.filter((media) => media.type === "PHOTO");
  const cover = photos.find((media) => media.isCover) ?? photos[0];
  return cover && /^https:\/\//.test(cover.url) ? cover.url : null;
}

export type PublicProviderCard = {
  id: string;
  slug: string | null;
  displayName: string;
  type: string;
  description: string | null;
  availability: string;
  verification: string;
  verificationBadges: { identity: boolean; business: boolean; skill: boolean };
  categories: Array<{ id: string; key: string; name: string }>;
  serviceAreas: Array<{ region: string | null; city: string | null; district: string | null; label: string | null }>;
  aggregateRating: number | null;
  ratingCount: number;
  completedJobs: number;
};

export function providerVerificationText(provider: Pick<PublicProviderCard, "verification" | "verificationBadges">) {
  if (provider.verification === "VERIFIED") {
    const checks = [provider.verificationBadges.identity && "ID", provider.verificationBadges.business && "business", provider.verificationBadges.skill && "skills"].filter(Boolean);
    return `✅ Verified by NesAfric${checks.length ? ` (${checks.join(", ")} checked)` : ""}`;
  }
  return provider.verification === "PENDING" ? "⏳ Verification in progress" : "Not yet verified by NesAfric";
}

export function providerCard(provider: PublicProviderCard, index: number | null) {
  const areas = provider.serviceAreas.map((area) => area.label ?? area.district ?? area.city ?? area.region).filter(Boolean).slice(0, 3);
  const lines = [
    `*${index !== null ? `${index}. ` : ""}${provider.displayName}*`,
    `🛠 ${provider.categories.slice(0, 3).map(({ name }) => name).join(", ") || "Property services"}`,
    ...(areas.length ? [`📍 Serves: ${areas.join(", ")}`] : []),
    providerVerificationText(provider),
    // Ratings only when real customer ratings exist.
    ...(provider.aggregateRating !== null && provider.ratingCount > 0 ? [`⭐ ${provider.aggregateRating.toFixed(1)} from ${provider.ratingCount} rating${provider.ratingCount === 1 ? "" : "s"}`] : []),
    ...(provider.completedJobs > 0 ? [`✔️ ${provider.completedJobs} completed job${provider.completedJobs === 1 ? "" : "s"} on NesAfric`] : []),
    ...(provider.availability === "UNAVAILABLE" ? ["Currently not taking new work"] : []),
    ...(provider.description ? [provider.description.length > 160 ? `${provider.description.slice(0, 159)}…` : provider.description] : []),
    `🔗 ${providerUrl(provider)}`,
  ];
  return lines.join("\n");
}

export function dateTimeText(date: Date) {
  return date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });
}
