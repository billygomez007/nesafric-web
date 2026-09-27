/**
 * Public marketplace shapes, mirrored by hand from the web repo's `publicProjection()` and
 * `searchPublicListings()` in `src/modules/listings/service.ts`. Money is integer minor units
 * serialised as strings.
 */
export type ListingType = "RENT" | "SALE";
export type Frequency = "MONTHLY" | "QUARTERLY" | "ANNUAL" | "CUSTOM";

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
