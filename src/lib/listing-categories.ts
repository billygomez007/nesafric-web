/**
 * Listing categories that are more than a property type. `Listing.category` stays a plain string
 * (as the web and mobile listing forms send it); this module is the one place that says what the
 * accommodation categories mean, shared by validation, public views, search and the booking flow.
 * The mobile app mirrors it in `mobile/src/marketplace/listing-categories.ts`.
 *
 * - HOTEL and SHORT_STAY are bookable accommodation: priced per night, and a guest requests a
 *   booking (never the ordinary property enquiry) which goes to the listing's operator.
 * - WAREHOUSE is ordinary commercial real estate (rent or sale, enquiries and viewings).
 */
export const BOOKABLE_CATEGORIES = ["HOTEL", "SHORT_STAY"] as const;
export type BookableCategory = (typeof BOOKABLE_CATEGORIES)[number];

export function isBookableCategory(category: unknown): category is BookableCategory {
  return typeof category === "string" && (BOOKABLE_CATEGORIES as readonly string[]).includes(category);
}

/** Customer-facing names. "Airbnb" is not used as a label: NesAfric's own term is "Short stay". */
export const ACCOMMODATION_CATEGORY_LABELS: Record<BookableCategory | "WAREHOUSE", string> = {
  HOTEL: "Hotel",
  SHORT_STAY: "Short stay",
  WAREHOUSE: "Warehouse",
};

/** Bounds a stay request and a stay listing may use. */
export const MAX_STAY_NIGHTS = 90;
export const MAX_GUESTS = 50;
/** How far ahead a stay can be requested. */
export const MAX_BOOKING_LEAD_DAYS = 365;
