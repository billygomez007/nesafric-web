// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/" }));

import { ListingCard, type PublicListing } from "@/components/property-marketplace-search";
import { resolveSignInDestination } from "@/lib/workspace-destination";

afterEach(cleanup);

describe("post sign-in destination (web password and Google)", () => {
  it("keeps the existing order: property management, then professional", () => {
    expect(resolveSignInDestination({ propertyOsOrganisations: [{ id: "o1" }], marketplaceProfessionals: [{ id: "p1" }], serviceProviders: [{ id: "s1" }] })).toEqual({
      path: "/dashboard",
      remember: { key: "propertyos.activeOrganisationId", value: "o1" },
    });
    expect(resolveSignInDestination({ propertyOsOrganisations: [], marketplaceProfessionals: [{ id: "p1" }], serviceProviders: [{ id: "s1" }] }).path).toBe("/pro/p1");
  });

  it("sends a service-provider owner to their provider workspace instead of onboarding", () => {
    expect(resolveSignInDestination({ propertyOsOrganisations: [], marketplaceProfessionals: [], serviceProviders: [{ id: "s1" }] })).toEqual({ path: "/providers/s1" });
  });

  it("falls back to onboarding with no workspace, and to the dashboard on a malformed answer", () => {
    expect(resolveSignInDestination({ propertyOsOrganisations: [], marketplaceProfessionals: [] }).path).toBe("/onboarding");
    expect(resolveSignInDestination(undefined).path).toBe("/dashboard");
  });
});

const base: PublicListing = {
  id: "l1",
  listingType: "RENT",
  scope: "PROPERTY",
  category: "APARTMENT",
  title: "Two-bedroom flat",
  description: "",
  pricing: { askingAmountMinor: null, rentAmountMinor: "250000", currencyCode: "GHS", frequency: "MONTHLY" },
  availability: { availableFrom: "2026-09-01", actual: true },
  attributes: { bedrooms: 2, bathrooms: "1", sizeSqm: null },
  location: { countryCode: "GH", region: "Greater Accra", city: "Accra", district: null, locality: null, label: null, map: { latitude: null, longitude: null, precision: null, geocodingRequired: true } },
  amenities: [],
  media: [],
  contact: { name: null, email: null, phone: null, enquiryEnabled: true },
  verification: { status: "VERIFIED", evidenceReady: true },
  attribution: { listedBy: "Owner", professional: null },
  publishedAt: "2026-09-01T00:00:00.000Z",
};

describe("ListingCard and Top Ads", () => {
  it("shows a small Top Ad label on a pinned listing, using the same card", () => {
    render(<ListingCard listing={{ ...base, isTopAd: true }} />);
    expect(screen.getByTestId("top-ad-badge").textContent).toBe("Top Ad");
    expect(screen.getByRole("link").getAttribute("href")).toBe("/marketplace/properties/l1");
  });

  it("never labels an organic listing", () => {
    render(<ListingCard listing={base} />);
    expect(screen.queryByTestId("top-ad-badge")).toBeNull();
    expect(screen.queryByText(/Top Ad|Sponsored/)).toBeNull();
  });
});
