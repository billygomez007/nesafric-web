import { activeFilterCount, filtersFromParams, filtersToQuery, majorToMinor, validateFilters } from "@/marketplace/filters";

describe("search filters", () => {
  it("converts typed major amounts to minor units", () => {
    expect(majorToMinor("8,500")).toBe(850000);
    expect(majorToMinor("12.5")).toBe(1250);
    expect(majorToMinor("")).toBeUndefined();
    expect(majorToMinor("abc")).toBeNull();
    expect(majorToMinor("-5")).toBeNull();
  });

  it("maps filters onto the public listings API contract", () => {
    expect(filtersToQuery({ q: " east legon ", listingType: "RENT", minPrice: "5000", bedroomsMin: "3", city: " " })).toEqual({
      q: "east legon",
      listingType: "RENT",
      category: undefined,
      city: undefined,
      country: undefined,
      minPriceMinor: "500000",
      maxPriceMinor: undefined,
      currencyCode: "GHS",
      bedroomsMin: "3",
      bathroomsMin: undefined,
    });
    expect(filtersToQuery({ q: "a" }).q).toBeUndefined();
    // The API rejects city filters without a country ("Country is required for narrower location filters").
    expect(filtersToQuery({ city: "Accra" })).toMatchObject({ city: "Accra", country: "GH" });
    expect(filtersToQuery({ city: "Lagos", country: "NG" })).toMatchObject({ city: "Lagos", country: "NG" });
    expect(filtersToQuery({}).currencyCode).toBeUndefined();
  });

  it("validates price ranges and short queries", () => {
    expect(validateFilters({ minPrice: "9000", maxPrice: "100" })).toEqual({ maxPrice: "Maximum must be at least the minimum." });
    expect(validateFilters({ minPrice: "x" })).toEqual({ minPrice: "Enter a valid amount." });
    expect(validateFilters({ q: "a" })).toEqual({ q: "Type at least 2 characters." });
    expect(validateFilters({ q: "ab", minPrice: "1", maxPrice: "1" })).toEqual({});
  });

  it("reads only known route params and counts active filters", () => {
    const filters = filtersFromParams({ listingType: "LEASE", category: "LAND", q: "tema", unknown: "x", city: ["a", "b"] });
    expect(filters).toMatchObject({ listingType: undefined, category: "LAND", q: "tema", city: undefined });
    expect(activeFilterCount(filters)).toBe(1);
  });
});
