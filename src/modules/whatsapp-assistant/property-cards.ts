import { absoluteUrl } from "@/platform/brand";
import type { WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";
import type { searchPublicListings } from "@/modules/listings/service";

/** A listing as the public marketplace search returns it: published, verified, safe to show. */
export type PublicListing = Awaited<ReturnType<typeof searchPublicListings>>["items"][number];
export type PropertyMessage = { body: string; interactive?: WhatsAppInteractive };

const PERIOD: Record<string, string> = { DAILY: "per day", PER_NIGHT: "per night", MONTHLY: "per month", QUARTERLY: "per quarter", ANNUAL: "per year" };
const TYPE: Record<string, string> = { APARTMENT: "Apartment", HOUSE: "House", TOWNHOUSE: "Townhouse", VILLA: "Villa", LAND: "Land", OFFICE: "Office", SHOP: "Shop", WAREHOUSE: "Warehouse", COMMERCIAL: "Commercial property", GUEST_HOUSE: "Guest house", HOTEL: "Hotel", SHORT_STAY: "Short stay", STUDIO: "Studio" };
const clip = (text: string | null | undefined, limit: number) => {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
};

/** "GHS 1,250" from minor units, keeping pesewas only when there are some. Exact for any size. */
export function formatAmount(minor: string, currency: string) {
  const value = BigInt(minor);
  const whole = (value / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (value % BigInt(100)).toString().padStart(2, "0");
  return `${currency} ${whole}${cents === "00" ? "" : `.${cents}`}`;
}

/** The price as listed, with what it is for: a period for rent, a sale price otherwise. */
export function priceLabel(listing: Pick<PublicListing, "listingType" | "pricing">) {
  const { rentAmountMinor, askingAmountMinor, currencyCode, frequency } = listing.pricing;
  const amount = listing.listingType === "RENT" ? rentAmountMinor ?? askingAmountMinor : askingAmountMinor ?? rentAmountMinor;
  if (amount === null) return "Price on request";
  if (listing.listingType === "SALE") return `${formatAmount(amount, currencyCode)} sale price`;
  return `${formatAmount(amount, currencyCode)}${frequency && PERIOD[frequency] ? ` ${PERIOD[frequency]}` : ""}`;
}

export const typeLabel = (category: string) => TYPE[category.toUpperCase()] ?? category.charAt(0).toUpperCase() + category.slice(1).toLowerCase().replaceAll("_", " ");
export const locationLabel = (location: PublicListing["location"]) => clip(location.label ?? [location.locality, location.district, location.city, location.region].filter(Boolean).join(", "), 120) || "Location on request";

function roomsLine(attributes: PublicListing["attributes"]) {
  const bedrooms = attributes.bedrooms === null ? null : attributes.bedrooms === 0 ? "Studio" : `${attributes.bedrooms} bedroom${attributes.bedrooms === 1 ? "" : "s"}`;
  const bathrooms = attributes.bathrooms === null ? null : `${Number(attributes.bathrooms)} bathroom${Number(attributes.bathrooms) === 1 ? "" : "s"}`;
  return [bedrooms && `🛏️ ${bedrooms}`, bathrooms && `🚿 ${bathrooms}`].filter(Boolean).join(" | ");
}

/** The listing's cover photo (or first public photo), only if Meta can fetch it over HTTPS. */
export function coverPhoto(media: PublicListing["media"]) {
  const photos = media.filter((item) => item.type === "PHOTO" && typeof item.url === "string" && item.url.startsWith("https://"));
  return (photos.find((item) => item.isCover) ?? photos[0])?.url ?? undefined;
}

const acceptsRequests = (listing: PublicListing) => listing.contact.enquiryEnabled && !listing.bookable;
export const listingUrl = (id: string) => absoluteUrl(`/marketplace/properties/${id}`);

/**
 * One search result as a WhatsApp message: the cover photo above the details, and buttons to see
 * the full details, ask a question or book a viewing. Button ids carry the listing id, so a tap on
 * an earlier page's card still opens the right property. `body` is the stored text fallback.
 */
export function propertyCard(listing: PublicListing, position: number, total: number): PropertyMessage {
  const lines = [
    `*${clip(listing.title, 120)}*`,
    `🏠 ${typeLabel(listing.category)} for ${listing.listingType === "RENT" ? "rent" : "sale"}`,
    `📍 ${locationLabel(listing.location)}`,
    roomsLine(listing.attributes),
    `💰 ${priceLabel(listing)}`,
    clip(listing.description, 280),
    `✅ Verified by NesAfric · Published`,
  ].filter(Boolean);
  const text = lines.join("\n");
  const buttons = [{ id: `details ${listing.id}`, title: "View property" }, ...(acceptsRequests(listing) ? [{ id: `inquire ${listing.id}`, title: "Ask a question" }, { id: `view ${listing.id}`, title: "Book a viewing" }] : [])];
  const photo = coverPhoto(listing.media);
  return {
    body: `${position}. ${text}\n${listingUrl(listing.id)}`,
    interactive: { type: "button", ...(photo ? { header: { type: "image" as const, link: photo } } : {}), body: text, footer: `Property ${position} of ${total}`, buttons },
  };
}

/** After the cards: page on, change the filters or start again. */
export function resultsNavigation(shown: { from: number; to: number; total: number }, hasMore: boolean): PropertyMessage {
  const text = `Showing ${shown.from}–${shown.to} of ${shown.total} matching ${shown.total === 1 ? "property" : "properties"}. Tap a card's buttons, or:`;
  const buttons = [...(hasMore ? [{ id: "more", title: "Show more" }] : []), { id: "change filters", title: "Change filters" }, { id: "new search", title: "New search" }];
  return { body: `${text}\n${hasMore ? "Reply more for the next page, " : ""}change filters, or new search.`, interactive: { type: "button", body: text, buttons } };
}

/** The full details of one listing, with the same actions. Only published data is shown. */
export function propertyDetailsMessage(listing: PublicListing): PropertyMessage {
  const amenities = listing.amenities.slice(0, 8).map((item) => item.label).join(", ");
  const facts = [
    `*${clip(listing.title, 120)}*`,
    `🏠 ${typeLabel(listing.category)} for ${listing.listingType === "RENT" ? "rent" : "sale"}`,
    `📍 ${locationLabel(listing.location)}`,
    roomsLine(listing.attributes),
    listing.attributes.sizeSqm ? `📐 ${Number(listing.attributes.sizeSqm)} m²` : "",
    `💰 ${priceLabel(listing)}`,
    amenities ? `✨ ${clip(amenities, 200)}` : "",
  ].filter(Boolean).join("\n");
  const description = clip(listing.description, 500);
  const text = [facts, description, `Full listing and photos: ${listingUrl(listing.id)}`].filter(Boolean).join("\n\n");
  const photo = coverPhoto(listing.media);
  const buttons = acceptsRequests(listing) ? [{ id: `inquire ${listing.id}`, title: "Ask a question" }, { id: `view ${listing.id}`, title: "Book a viewing" }] : [];
  const tail = acceptsRequests(listing) ? "" : "\n\nThis property takes requests on its listing page only.";
  return {
    body: `${text}${tail}`,
    interactive: buttons.length && text.length <= 1024 ? { type: "button", ...(photo ? { header: { type: "image" as const, link: photo } } : {}), body: text, buttons } : undefined,
  };
}
