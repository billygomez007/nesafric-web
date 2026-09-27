import type { PublicListing } from "@/api/types";

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
