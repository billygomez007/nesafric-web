import { providerFiltersFromParams, providerFiltersToQuery, activeProviderFilterCount } from "@/marketplace/provider-filters";
import {
  availabilityLabel,
  formatPrimaryArea,
  formatRating,
  formatResponseTime,
  formatCompletionRate,
  formatStartingRate,
  orderCategories,
  verificationBadges,
} from "@/services/format";
import { validateServiceRequest } from "@/services/request";
import { provider, serviceCategories } from "@/test-utils/fixtures";

describe("provider trust formatting", () => {
  it("shows a rating only when the server reports one", () => {
    expect(formatRating(provider())).toEqual({ score: "4.8", count: "84 verified ratings" });
    expect(formatRating(provider({ aggregateRating: 5, ratingCount: 1 }))).toEqual({ score: "5.0", count: "1 verified rating" });
    expect(formatRating(provider({ aggregateRating: null, ratingCount: 0 }))).toBeNull();
    // A stray average without any rating rows is not a rating.
    expect(formatRating(provider({ aggregateRating: 4, ratingCount: 0 }))).toBeNull();
  });

  it("shows only the verification levels the server approved", () => {
    expect(verificationBadges(provider())).toEqual(["Verified Identity", "Verified Business"]);
    expect(verificationBadges(provider({ verificationBadges: { identity: false, business: false, skill: true } }))).toEqual(["Verified Professional"]);
    expect(verificationBadges(provider({ verificationBadges: undefined }))).toEqual([]);
  });

  it("never shows a provider that isn't accepting work as available", () => {
    expect(availabilityLabel(provider())?.label).toBe("Available for work");
    expect(availabilityLabel(provider({ acceptingWork: false }))?.label).toBe("Not taking new work");
    expect(availabilityLabel(provider({ availability: "LIMITED" }))?.label).toBe("Limited availability");
  });

  it("formats provider-stated figures and omits missing ones", () => {
    expect(formatStartingRate(provider())).toBe("From GH₵250");
    expect(formatStartingRate(provider({ pricing: { startingRateMinor: "25000", currencyCode: null } }))).toBeNull();
    expect(formatResponseTime(4)).toBe("Within 4 hours");
    expect(formatResponseTime(48)).toBe("Within 2 days");
    expect(formatResponseTime(null)).toBeNull();
    expect(formatPrimaryArea(provider({ serviceAreas: [] }))).toBeNull();
    expect(formatPrimaryArea(provider({ serviceAreas: [{ countryCode: "GH", region: null, city: null, district: null, label: null }] }))).toBe("Ghana");
  });
});

describe("completion rate", () => {
  it("shows only a server-computed rate, as a whole percentage", () => {
    expect(formatCompletionRate(provider({ completionRate: 0.96 }))).toBe("96% completion rate");
    expect(formatCompletionRate(provider({ completionRate: 0.833 }))).toBe("83% completion rate");
    expect(formatCompletionRate(provider({ completionRate: 1 }))).toBe("100% completion rate");
  });
  it("shows nothing — never 0% — when the server has too little history or sends none", () => {
    expect(formatCompletionRate(provider({ completionRate: null, completedJobs: 0 }))).toBeNull();
    expect(formatCompletionRate(provider({ completionRate: undefined }))).toBeNull();
    expect(formatCompletionRate(provider({ completionRate: 1.4 }))).toBeNull();
  });
});

describe("service categories", () => {
  it("leads with the core services and keeps every server category", () => {
    expect(orderCategories(serviceCategories).map((category) => category.key)).toEqual(["plumbing", "electrical", "cleaning", "masonry", "solar"]);
  });

});

describe("provider filters", () => {
  it("maps onto the discovery API and adds the country only with an area", () => {
    expect(providerFiltersToQuery({ service: "plumbing" })).toMatchObject({ category: "plumbing", country: undefined });
    expect(providerFiltersToQuery({ district: " East Legon " })).toMatchObject({ district: "East Legon", country: "GH" });
    expect(providerFiltersToQuery({ q: "  Accra   electrician " }).q).toBe("Accra electrician");
    expect(providerFiltersToQuery({ q: "   " }).q).toBeUndefined();
  });

  it("drops route values the API would reject", () => {
    expect(providerFiltersFromParams({ service: "Plumbing!", providerType: "AGENCY", availability: "UNAVAILABLE", minimumRating: "9" })).toEqual({
      q: undefined,
      service: undefined,
      providerType: undefined,
      availability: undefined,
      minimumRating: undefined,
      region: undefined,
      city: undefined,
      district: undefined,
      country: undefined,
    });
    expect(providerFiltersFromParams({ service: "pest_control", providerType: "COMPANY" })).toMatchObject({ service: "pest_control", providerType: "COMPANY" });
  });

  it("counts filters other than the service", () => {
    expect(activeProviderFilterCount({ q: "kwame", service: "plumbing", city: "Accra", providerType: "COMPANY" })).toBe(2);
  });
});

describe("request validation", () => {
  const base = { organisationId: "o1", categoryId: "c1", propertyId: null, maintenanceRequestId: null, message: "Leaking pipe under the sink.", requestQuote: false };
  it("needs a service and a description; a property workspace is optional", () => {
    expect(validateServiceRequest(base)).toEqual({});
    expect(Object.keys(validateServiceRequest({ ...base, organisationId: null, categoryId: null, message: "fix" })).sort()).toEqual(["categoryId", "message"]);
  });
  it("only allows a formal quotation with a maintenance request", () => {
    expect(validateServiceRequest({ ...base, requestQuote: true }).requestQuote).toBeDefined();
    expect(validateServiceRequest({ ...base, requestQuote: true, maintenanceRequestId: "m1" })).toEqual({});
  });
});
