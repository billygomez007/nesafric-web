/**
 * Mirror of the web repo's `src/lib/listing-categories.ts`: hotels and short stays are bookable
 * accommodation (priced per night; guests request a booking instead of enquiring); warehouses are
 * ordinary commercial real estate.
 */
export const BOOKABLE_CATEGORIES = ["HOTEL", "SHORT_STAY"] as const;
export type BookableCategory = (typeof BOOKABLE_CATEGORIES)[number];

export function isBookableCategory(category: unknown): category is BookableCategory {
  return typeof category === "string" && (BOOKABLE_CATEGORIES as readonly string[]).includes(category.toUpperCase());
}

export const STAY_LABELS: Record<BookableCategory, string> = { HOTEL: "Hotel", SHORT_STAY: "Short stay" };

export function stayLabel(category: string) {
  const key = category.toUpperCase();
  return isBookableCategory(key) ? STAY_LABELS[key as BookableCategory] : null;
}

/** Same bounds as the server. */
export const MAX_STAY_NIGHTS = 90;
export const MAX_GUESTS = 50;
export const MAX_BOOKING_LEAD_DAYS = 365;
