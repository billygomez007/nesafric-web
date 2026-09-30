/** Choices of the listing form — the same values as the website's listing form. */

export const PROPERTY_TYPES = [
  ["HOTEL", "Hotel"],
  ["SHORT_STAY", "Short stay"],
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
] as const;

export const RESIDENTIAL_TYPES = new Set(["APARTMENT", "HOUSE", "TOWNHOUSE", "VILLA", "GUEST_HOUSE", "HOTEL", "SHORT_STAY"]);

export const LISTING_INTENTS = [
  ["RENT", "For rent"],
  ["SALE", "For sale"],
] as const;

export const FURNISHING = [
  ["FURNISHED", "Furnished"],
  ["SEMI_FURNISHED", "Semi-furnished"],
  ["UNFURNISHED", "Unfurnished"],
] as const;

export const LISTING_AUTHORITIES = [
  ["OWNER_SELF", "Property owner"],
  ["PROPERTY_MANAGER", "Property manager"],
  ["MANAGING_AGENT", "Managing agent"],
  ["BROKERAGE_AUTHORIZED", "Broker / agency"],
  ["DEVELOPER", "Developer"],
  ["THIRD_PARTY_AUTHORIZED", "Authorised third party"],
] as const;

export const EVIDENCE_TYPES = [
  ["owner_mandate", "Owner mandate"],
  ["listing_authority", "Listing authority"],
  ["developer_authority", "Developer authority"],
  ["ownership_reference", "Ownership reference"],
] as const;

export const AMENITIES = [
  "Air conditioning", "Swimming pool", "Security service", "CCTV", "Gated community", "Parking", "Garage",
  "Generator", "Backup power", "Water reservoir", "Borehole", "Garden", "Balcony", "Roof terrace",
  "Boys quarters", "Internet", "DSTV / Satellite TV", "Fitted kitchen", "Cooker", "Refrigerator",
  "Microwave", "Washing machine", "Elevator", "Gym", "Playground", "Pet friendly",
] as const;

/** Listings a professional can still change; anything in review or live follows the review cycle. */
export const EDITABLE_LISTING_STATUSES = new Set(["DRAFT", "REJECTED", "PAUSED"]);
export const SUBMITTABLE_LISTING_STATUSES = new Set(["DRAFT", "REJECTED"]);
export const MAX_LISTING_PHOTOS = 12;
