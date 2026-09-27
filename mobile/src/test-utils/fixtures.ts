import type { PublicListing, PublicProvider, ServiceCategory } from "@/api/types";

export function listing(overrides: Partial<PublicListing> = {}): PublicListing {
  return {
    id: "3f1c2a9e-5a55-4a1e-9f1c-000000000001",
    listingType: "RENT",
    category: "HOUSE",
    title: "4 Bedroom House",
    description: "Spacious family home with garden.",
    pricing: { askingAmountMinor: null, rentAmountMinor: "850000", currencyCode: "GHS", frequency: "MONTHLY" },
    availability: { availableFrom: null },
    attributes: { bedrooms: 4, bathrooms: "4", sizeSqm: "320" },
    location: {
      countryCode: "GH",
      region: "Greater Accra",
      city: "Accra",
      district: "East Legon",
      locality: null,
      label: null,
      map: { latitude: null, longitude: null, precision: "DISTRICT" },
    },
    amenities: [{ key: "parking", label: "Parking", category: null }],
    media: [
      { id: "m2", type: "PHOTO", url: "/api/public/media/b.jpg", altText: null, title: null, isCover: false, width: null, height: null },
      { id: "m1", type: "PHOTO", url: "https://cdn.example.com/a.jpg", altText: "Front", title: null, isCover: true, width: null, height: null },
      { id: "m3", type: "VIDEO", url: "https://cdn.example.com/v.mp4", altText: null, title: null, isCover: false, width: null, height: null },
    ],
    contact: { name: "Ama", enquiryEnabled: true },
    verification: { status: "VERIFIED" },
    attribution: { listedBy: "Agent", professional: { displayName: "ABC Realty", slug: "abc-realty", verificationStatus: "VERIFIED" } },
    publishedAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

const category = (id: string, key: string, name: string, group: string, sortOrder: number): ServiceCategory => ({ id, key, name, description: null, group, sortOrder });

/** Server order (`group`, `sortOrder`, `name`), including one category an admin added later. */
export const serviceCategories: ServiceCategory[] = [
  category("c0000000-0000-4000-8000-000000000010", "masonry", "Masonry", "BUILDING_CONSTRUCTION", 10),
  category("c0000000-0000-4000-8000-000000000001", "plumbing", "Plumbing", "REPAIRS_MAINTENANCE", 10),
  category("c0000000-0000-4000-8000-000000000002", "electrical", "Electrical", "REPAIRS_MAINTENANCE", 20),
  category("c0000000-0000-4000-8000-000000000003", "cleaning", "Cleaning Services", "PROPERTY_CARE", 10),
  category("c0000000-0000-4000-8000-000000000011", "solar", "Solar installation / maintenance", "SECURITY_SYSTEMS", 30),
];

export function provider(overrides: Partial<PublicProvider> = {}): PublicProvider {
  return {
    id: "5c9e0a11-0000-4000-8000-000000000001",
    slug: "kwame-plumbing",
    displayName: "Kwame Plumbing Services",
    type: "COMPANY",
    description: "Leak repairs, pipe replacement and bathroom installations.",
    availability: "AVAILABLE",
    verification: "VERIFIED",
    verificationBadges: { identity: true, business: true, skill: false },
    acceptingWork: true,
    categories: [{ id: serviceCategories[1].id, key: "plumbing", name: "Plumbing" }],
    serviceAreas: [
      { countryCode: "GH", region: "Greater Accra", city: "Accra", district: "East Legon", label: null },
      { countryCode: "GH", region: "Greater Accra", city: "Tema", district: null, label: null },
    ],
    contact: { email: null, phone: null },
    pricing: { startingRateMinor: "25000", currencyCode: "GHS" },
    responseTimeHours: 4,
    aggregateRating: 4.8,
    ratingCount: 84,
    completedJobs: 127,
    completionRate: 0.96,
    completionRateBasis: 132,
    logo: { url: "/api/public/media/providers/kwame-logo.png" },
    ...overrides,
  };
}
