/**
 * Property types and amenities offered when creating a listing, shared by the website form and
 * the WhatsApp listing flow so both offer the same choices and store the same keys.
 */
export const LISTING_PROPERTY_TYPES = [
  ["APARTMENT", "Apartment"],
  ["HOUSE", "House"],
  ["TOWNHOUSE", "Townhouse"],
  ["VILLA", "Villa"],
  ["LAND", "Land"],
  ["OFFICE", "Office"],
  ["SHOP", "Shop / Retail"],
  ["WAREHOUSE", "Warehouse"],
  ["COMMERCIAL", "Commercial space"],
  ["GUEST_HOUSE", "Guest house"],
  ["HOTEL", "Hotel"],
  ["SHORT_STAY", "Short stay"],
] as const;

export const RESIDENTIAL_PROPERTY_TYPES = ["APARTMENT", "HOUSE", "TOWNHOUSE", "VILLA", "GUEST_HOUSE"] as const;
export const COMMERCIAL_PROPERTY_TYPES = ["OFFICE", "SHOP", "WAREHOUSE", "COMMERCIAL"] as const;

export const LISTING_AMENITIES = [
  "Air conditioning",
  "Swimming pool",
  "Security service",
  "CCTV",
  "Gated community",
  "Parking",
  "Garage",
  "Generator",
  "Backup power",
  "Water reservoir",
  "Borehole",
  "Garden",
  "Balcony",
  "Roof terrace",
  "Boys quarters",
  "Internet",
  "DSTV / Satellite TV",
  "Fitted kitchen",
  "Cooker",
  "Refrigerator",
  "Microwave",
  "Washing machine",
  "Elevator",
  "Gym",
  "Playground",
  "Pet friendly",
] as const;

/** The stored key of an amenity label ("DSTV / Satellite TV" → "dstv-satellite-tv"). */
export const amenityKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
