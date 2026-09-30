/**
 * Public marketplace shapes, mirrored by hand from the web repo's `publicProjection()` and
 * `searchPublicListings()` in `src/modules/listings/service.ts`. Money is integer minor units
 * serialised as strings.
 */
export type ListingType = "RENT" | "SALE";
/** Listing price unit (`ListingPriceUnit` on the server; the field keeps its historic name). */
export type Frequency = "DAILY" | "MONTHLY" | "QUARTERLY" | "ANNUAL" | "CUSTOM" | "PER_SQM" | "PER_KM";

export type ListingMedia = {
  id: string;
  type: "PHOTO" | "VIDEO" | "FLOOR_PLAN" | string;
  url: string | null;
  altText: string | null;
  title: string | null;
  isCover: boolean;
  width: number | null;
  height: number | null;
};

export type PublicListing = {
  id: string;
  /** Pinned to the top of these results by a NesAfric admin (search results only; older servers omit it). */
  isTopAd?: boolean;
  listingType: ListingType;
  category: string;
  title: string;
  description: string | null;
  pricing: { askingAmountMinor: string | null; rentAmountMinor: string | null; currencyCode: string; frequency: Frequency | null };
  availability: { availableFrom: string | null };
  attributes: { bedrooms: number | null; bathrooms: string | null; sizeSqm: string | null };
  location: {
    countryCode: string;
    region: string | null;
    city: string | null;
    district: string | null;
    locality: string | null;
    label: string | null;
    map: { latitude: string | null; longitude: string | null; precision: string | null };
  };
  amenities: { key: string; label: string; category: string | null }[];
  media: ListingMedia[];
  contact: { name: string | null; enquiryEnabled: boolean };
  verification: { status: string };
  attribution: { listedBy: string; professional: { displayName: string; slug: string; verificationStatus: string } | null };
  publishedAt: string | null;
};

export type ListingSearchResult = {
  items: PublicListing[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type ListingDetailResult = { listing: PublicListing };

export type LeadInput = {
  name: string;
  email?: string;
  phone?: string;
  message?: string;
  marketingConsent: boolean;
  source: string;
};

export type LeadCreated = { id: string; listingId: string; status: string; createdAt: string };

export type ViewingInput = {
  leadId: string;
  preferredTimes: { startsAt: string; endsAt: string; timezone: string }[];
  requesterNote?: string;
};

/**
 * Service Provider Marketplace shapes, mirrored by hand from the web repo's `publicProfile()` in
 * `src/modules/marketplace/service.ts` and `listPubliclyVisibleServiceCategories()`. Every trust
 * figure (rating, rating count, completed jobs, verification) is derived by the server from
 * `ProviderRating`, `ProviderAssignment` and reviewer-set verification; the app only displays it.
 */
export type ServiceCategory = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  group: string;
  sortOrder: number;
  parentId?: string | null;
  parent?: {
    id: string;
    key: string;
    name: string;
    sortOrder: number;
  } | null;
  children?: ServiceCategory[];
};

export type ProviderType = "INDIVIDUAL" | "COMPANY";
export type ProviderAvailability = "AVAILABLE" | "LIMITED" | "UNAVAILABLE";

export type ProviderServiceArea = {
  countryCode: string;
  region: string | null;
  city: string | null;
  district: string | null;
  label: string | null;
};

export type PublicProvider = {
  id: string;
  slug: string | null;
  displayName: string;
  type: ProviderType | string;
  description: string | null;
  availability: ProviderAvailability | string;
  verification: string;
  /** Missing on servers that predate per-level badges: treat as "no level shown". */
  verificationBadges?: { identity: boolean; business: boolean; skill: boolean };
  acceptingWork: boolean;
  categories: { id: string; key: string; name: string }[];
  serviceAreas: ProviderServiceArea[];
  contact: { email: string | null; phone: string | null };
  pricing: { startingRateMinor: string | null; currencyCode: string | null };
  responseTimeHours: number | null;
  aggregateRating: number | null;
  ratingCount: number;
  completedJobs: number;
  /**
   * Server-derived share of concluded jobs completed (0–1), or null when there is too little
   * history. Missing on servers that predate it. Never computed on the device.
   */
  completionRate?: number | null;
  /** How many concluded jobs `completionRate` is based on. */
  completionRateBasis?: number;
  /** Public logo / profile image; null (or missing on older servers) when there is none. */
  logo?: { url: string } | null;
};

export type ProviderSearchResult = {
  items: PublicProvider[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type ProviderDetailResult = { provider: PublicProvider };

export type ServiceEnquiryInput = {
  providerId: string;
  categoryId: string;
  propertyId?: string;
  maintenanceRequestId?: string;
  message: string;
};

export type ServiceEnquiryCreated = { id: string; status: string; providerId: string; categoryId: string };

/** `GET /api/marketplace/saved-providers`: a provider that left the marketplace comes back as unavailable, with no details. */
export type SavedProviderItem =
  | { providerId: string; savedAt: string; available: true; provider: PublicProvider }
  | { providerId: string; savedAt: string; available: false; provider: null };

export type SavedProvidersResult = { items: SavedProviderItem[] };
