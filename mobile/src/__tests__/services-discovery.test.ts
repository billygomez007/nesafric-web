import { isAvailableNow, isTopRated, popularProviderCities, popularServices, serviceCollection, shown, TOP_RATED } from "@/services/discovery/collections";
import { provider } from "@/test-utils/fixtures";

const plumbing = { id: "c1", key: "plumbing", name: "Plumbing" };
const cleaning = { id: "c2", key: "cleaning", name: "Cleaning Services" };
const area = (city: string, countryCode = "GH") => ({ countryCode, region: null, city, district: null, label: null });

describe("service discovery collections", () => {
  it("counts only providers with real ratings of 4 and above as top rated", () => {
    expect(isTopRated({ aggregateRating: 4.8, ratingCount: 84 })).toBe(true);
    expect(isTopRated({ aggregateRating: 4, ratingCount: 1 })).toBe(true);
    expect(isTopRated({ aggregateRating: 3.9, ratingCount: 50 })).toBe(false);
    expect(isTopRated({ aggregateRating: null, ratingCount: 0 })).toBe(false);
    // A score with no ratings behind it is never shown as top rated.
    expect(isTopRated({ aggregateRating: 5, ratingCount: 0 })).toBe(false);
  });

  it("treats only providers accepting work as available now", () => {
    expect(isAvailableNow({ availability: "AVAILABLE", acceptingWork: true })).toBe(true);
    expect(isAvailableNow({ availability: "AVAILABLE", acceptingWork: false })).toBe(false);
    expect(isAvailableNow({ availability: "LIMITED", acceptingWork: true })).toBe(false);
  });

  it("drops providers the server returned that don't match the shelf, then caps it", () => {
    const rated = provider({ id: "a", aggregateRating: 4.6, ratingCount: 10 });
    const unrated = provider({ id: "b", aggregateRating: null, ratingCount: 0 });
    expect(shown(TOP_RATED, [rated, unrated]).map((item) => item.id)).toEqual(["a"]);
    const many = Array.from({ length: 12 }, (_, index) => provider({ id: `p${index}` }));
    expect(shown(TOP_RATED, many)).toHaveLength(TOP_RATED.size);
  });

  it("gives a shelf only to services at least two providers offer, most providers first", () => {
    const providers = [
      provider({ id: "1", categories: [plumbing, cleaning] }),
      provider({ id: "2", categories: [plumbing] }),
      provider({ id: "3", categories: [cleaning] }),
      provider({ id: "4", categories: [plumbing, { id: "c3", key: "solar", name: "Solar" }] }),
    ];
    expect(popularServices(providers)).toEqual([
      { key: "plumbing", name: "Plumbing" },
      { key: "cleaning", name: "Cleaning Services" },
    ]);
    expect(popularServices([provider({ categories: [plumbing] })])).toEqual([]);
  });

  it("builds a service shelf that searches by the exact category key", () => {
    const collection = serviceCollection(plumbing);
    expect(collection.filters).toEqual({ service: "plumbing" });
    expect(collection.seeAll).toEqual({ service: "plumbing" });
    expect(collection.matches?.(provider({ categories: [plumbing] }))).toBe(true);
    expect(collection.matches?.(provider({ categories: [cleaning] }))).toBe(false);
  });

  it("lists Ghanaian cities served by at least two providers, counting each provider once", () => {
    const providers = [
      provider({ id: "1", serviceAreas: [area("Accra"), area("accra"), area("Tema")] }),
      provider({ id: "2", serviceAreas: [area("Accra")] }),
      provider({ id: "3", serviceAreas: [area("Kumasi"), area("Tema")] }),
      provider({ id: "4", serviceAreas: [area("Lagos", "NG"), area("Kumasi", "NG")] }),
    ];
    expect(popularProviderCities(providers)).toEqual(["Accra", "Tema"]);
  });
});
