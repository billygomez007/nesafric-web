/// <reference types="node" />
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import path from "path";
import { StyleSheet } from "react-native";

import type { CampaignBanner } from "@/api/home";
import type { PublicListing } from "@/api/types";
import { CATEGORY_COLLECTIONS, cityCollection, fetchSize, NEWEST, organic, popularCities, TOP_AD_HEADROOM, topAds } from "@/home/discovery/collections";
import { scrollFeed } from "@/test-utils/feed";
import { listing } from "@/test-utils/fixtures";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));

const APP_DIR = path.join(__dirname, "../app");

let n = 0;
function home(overrides: Partial<PublicListing> & { city?: string } = {}) {
  n += 1;
  const { city = "Accra", ...rest } = overrides;
  return listing({
    id: `3f1c2a9e-5a55-4a1e-9f1c-${String(n).padStart(12, "0")}`,
    title: `Home ${n}`,
    location: { countryCode: "GH", region: null, city, district: null, locality: null, label: null, map: { latitude: null, longitude: null, precision: null } },
    ...rest,
  });
}

// A small but varied inventory: every listing is real-shaped, nothing is invented by the app.
const topAd = home({ title: "Airport Hills Villa", category: "HOUSE", isTopAd: true });
const apartment1 = home({ title: "Cantonments Apartment", category: "APARTMENT" });
const apartment2 = home({ title: "Osu Apartment", category: "APARTMENT", listingType: "SALE", pricing: { askingAmountMinor: "150000000", rentAmountMinor: null, currencyCode: "GHS", frequency: null } });
const house1 = home({ title: "Tema House", category: "HOUSE", city: "Tema" });
const house2 = home({ title: "Community 25 House", category: "HOUSE", city: "Tema" });
const office1 = home({ title: "Kumasi Office", category: "COMMERCIAL", city: "Kumasi" });
const office2 = home({ title: "Adum Shop", category: "COMMERCIAL", city: "Kumasi" });
const INVENTORY = [topAd, apartment1, apartment2, house1, house2, office1, office2];

type Call = { url: URL; method: string };
let calls: Call[];

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}

/** Like the server: filters apply, pageSize bounds the page. */
function mockApi({ inventory = INVENTORY, banners = [] as CampaignBanner[], failCategory }: { inventory?: PublicListing[]; banners?: CampaignBanner[]; failCategory?: string } = {}) {
  calls = [];
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, method: init.method ?? "GET" });
    const p = url.searchParams;
    if (url.pathname === "/api/public/campaigns") return json(200, { banners });
    if (url.pathname === "/api/public/homepage-companies") return json(200, { items: [] });
    if (url.pathname === "/api/public/listings") {
      if (failCategory && p.get("category") === failCategory) return json(500, { error: { code: "INTERNAL", message: "Down" } });
      // Like the server: every active Top Ad is pinned first, then the page is cut to pageSize.
      const items = [...inventory]
        .sort((a, b) => Number(b.isTopAd === true) - Number(a.isTopAd === true))
        .filter((item) => (!p.get("category") || p.get("category") === item.category) && (!p.get("listingType") || p.get("listingType") === item.listingType) && (!p.get("city") || p.get("city") === item.location.city))
        .slice(0, Number(p.get("pageSize") ?? 20));
      return json(200, { items, pagination: { page: 1, pageSize: items.length, total: items.length, totalPages: 1 } });
    }
    const detail = inventory.find((item) => url.pathname === `/api/public/listings/${item.id}`);
    if (detail) return json(200, { listing: detail });
    return json(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  }) as jest.Mock;
}

const listingQueries = () => calls.filter((call) => call.url.pathname === "/api/public/listings").map((call) => call.url.searchParams);

describe("home discovery feed", () => {
  it("fetches the first shelves up front and lower ones only on the way down", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    expect(await screen.findByTestId("collection-newest")).toBeTruthy();
    await waitFor(() => expect(listingQueries().some((params) => params.get("category") === "APARTMENT")).toBe(true));
    // Nothing further down has been requested yet.
    expect(listingQueries().some((params) => params.get("category") === "COMMERCIAL")).toBe(false);
    // Every request is bounded.
    expect(listingQueries().every((params) => Number(params.get("pageSize")) <= fetchSize(NEWEST))).toBe(true);

    await scrollFeed();
    await waitFor(() => expect(listingQueries().some((params) => params.get("category") === "COMMERCIAL")).toBe(true));
    expect(await screen.findByTestId("collection-commercial")).toBeTruthy();
  });

  it("draws collections in different layouts: Top Ad hero, rail, city tiles, grid, compact rows", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    const featured = await screen.findByTestId("collection-featured");
    expect(within(featured).getByText("Top Ad")).toBeTruthy();
    expect(within(featured).getByLabelText(/^Top Ad, Airport Hills Villa/)).toBeTruthy();
    // The hero isn't repeated in "Newly listed".
    const newest = screen.getByTestId("collection-newest");
    expect(within(newest).getByLabelText("Newly listed").props.horizontal).toBe(true);
    expect(within(newest).queryByLabelText(/^Airport Hills Villa/)).toBeNull();

    // Cities come from real listings: Accra (3), Kumasi (2) and Tema (2); no counts are shown.
    const cities = await screen.findByTestId("collection-cities");
    expect(within(cities).getByLabelText("Properties in Accra")).toBeTruthy();
    expect(within(cities).getByLabelText("Properties in Tema")).toBeTruthy();
    expect(within(cities).queryByText(/\d+ (listings|properties)/)).toBeNull();

    const apartments = await screen.findByTestId("collection-apartments");
    expect(within(apartments).queryByLabelText("Apartments")).toBeNull(); // grid, not a rail
    expect(within(apartments).getByLabelText(/^Cantonments Apartment/)).toBeTruthy();

    await scrollFeed();
    expect(await screen.findByTestId("collection-city:accra")).toBeTruthy();
    const houses = await screen.findByTestId("collection-houses");
    expect(within(houses).getByLabelText(/^Tema House/)).toBeTruthy();
  });

  it("leaves out a shelf with too few listings or a failed request — never an empty heading", async () => {
    mockApi({ failCategory: "COMMERCIAL" });
    renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByTestId("collection-newest");
    await scrollFeed();
    await waitFor(() => expect(listingQueries().some((params) => params.get("category") === "LAND")).toBe(true));
    // No land at all: the whole section is absent.
    expect(screen.queryByText("Land & plots")).toBeNull();
    // Commercial failed: absent, and the rest of Home carries on.
    await waitFor(() => expect(listingQueries().filter((params) => params.get("category") === "COMMERCIAL").length).toBeGreaterThan(0));
    expect(screen.queryByText("Commercial & offices")).toBeNull();
    expect(screen.queryByText(/No properties found/)).toBeNull();
    expect(screen.getByText("Advanced Search")).toBeTruthy();
  });

  it("See all opens the existing Search with that collection's filter", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    const apartments = await screen.findByTestId("collection-apartments");
    const before = listingQueries().length;
    fireEvent.press(within(apartments).getByLabelText("See all"));
    await waitFor(() => expect(listingQueries().slice(before).some((params) => params.get("category") === "APARTMENT" && params.get("pageSize") === "20")).toBe(true));
  });

  it("a city tile opens Search for that city", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    const cities = await screen.findByTestId("collection-cities");
    const before = listingQueries().length;
    fireEvent.press(within(cities).getByLabelText("Properties in Tema"));
    await waitFor(() => expect(listingQueries().slice(before).some((params) => params.get("city") === "Tema" && params.get("country") === "GH" && params.get("pageSize") === "20")).toBe(true));
  });

  it("keeps service providers out of the property feed", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByTestId("collection-newest");
    await scrollFeed();
    expect(calls.some((call) => /^\/api\/(public\/)?(marketplace\/)?providers/.test(call.url.pathname))).toBe(false);
  });

  it("with no Top Ads there is no Featured section, and a thin inventory shows only what exists", async () => {
    mockApi({ inventory: [apartment1] });
    renderRouter(APP_DIR, { initialUrl: "/" });
    expect(await screen.findByTestId("collection-newest")).toBeTruthy();
    await scrollFeed();
    await waitFor(() => expect(listingQueries().some((params) => params.get("category") === "COMMERCIAL")).toBe(true));
    // One apartment is below every shelf's minimum except "Newly listed"; no Top Ad, no city pair.
    for (const key of ["featured", "cities", "apartments", "for-rent", "houses", "for-sale", "land", "commercial"]) {
      expect(screen.queryByTestId(`collection-${key}`)).toBeNull();
    }
  });
});

describe("Top Ads stay in Featured", () => {
  // Worst case: all 12 allowed Top Ads active, matching the Newly listed, Apartments, For rent and
  // Accra queries, and pinned ahead of every organic listing by the server.
  const paid = Array.from({ length: 12 }, (_, i) => home({ title: `Paid ad ${i + 1}`, category: "APARTMENT", isTopAd: true }));

  it("labels at most three Top Ads in Featured and shows none on any organic shelf, which still fill with organic listings", async () => {
    mockApi({ inventory: [...paid, ...INVENTORY.filter((item) => item !== topAd)] });
    renderRouter(APP_DIR, { initialUrl: "/" });
    const featured = await screen.findByTestId("collection-featured");
    expect(within(featured).getAllByText("Top Ad")).toHaveLength(3);
    // Every card elsewhere is labelled by its title; a paid one would start with "Paid ad".
    const leaked = () => expect(screen.queryAllByLabelText(/^Paid ad \d+/)).toHaveLength(0);
    leaked();

    // Organic listings still fill the shelves the Top Ads were pinned above.
    const newest = await screen.findByTestId("collection-newest");
    expect(within(newest).getByLabelText(/^Cantonments Apartment/)).toBeTruthy();
    const apartments = await screen.findByTestId("collection-apartments");
    expect(within(apartments).getByLabelText(/^Cantonments Apartment/)).toBeTruthy();
    expect(within(apartments).getByLabelText(/^Osu Apartment/)).toBeTruthy();

    // Checked at every step down the feed, as sections mount and unmount.
    const seen = new Set<string>();
    await scrollFeed({
      afterEachRound: () => {
        leaked();
        for (const node of screen.queryAllByTestId(/^collection-/)) seen.add(String(node.props.testID));
      },
    });
    for (const key of ["collection-apartments", "collection-city:accra", "collection-houses", "collection-commercial"]) expect(seen).toContain(key);
    // Each organic request asked for enough rows to get past every pinned Top Ad.
    expect(listingQueries().every((params) => Number(params.get("pageSize")) >= TOP_AD_HEADROOM + 4)).toBe(true);
  });
});

describe("home discovery rules", () => {
  it("cities need at least two listings, most first, Ghana only", () => {
    const tiles = popularCities([home({ city: "Tema" }), home({ city: "Accra" }), home({ city: "Accra" }), home({ city: "Tema" }), home({ city: "Accra" }), home({ city: "Ho" }), home({ city: "Lomé", location: { ...listing().location, countryCode: "TG", city: "Lomé" } })]);
    expect(tiles.map((tile) => tile.city)).toEqual(["Accra", "Tema"]);
  });

  it("only admin-pinned, verified Top Ads are featured", () => {
    expect(topAds([home({ isTopAd: true }), home({ isTopAd: false }), home(), home({ isTopAd: true, verification: { status: "PENDING" } })])).toHaveLength(1);
  });

  it("every collection is a bounded query with a See all into Search", () => {
    for (const collection of [NEWEST, ...CATEGORY_COLLECTIONS, cityCollection("Accra")]) {
      expect(collection.size).toBeLessThanOrEqual(20);
      // Room for every possible Top Ad on top of the shelf, within the API's 50-row page.
      expect(fetchSize(collection)).toBe(Math.min(collection.size + TOP_AD_HEADROOM, 50));
      expect(collection.seeAll).toBeDefined();
    }
    expect(cityCollection("Accra").filters).toEqual({ city: "Accra", country: "GH" });
  });

  it("organic shelves never take a Top Ad, and cities ignore them", () => {
    const paid = Array.from({ length: 5 }, () => home({ isTopAd: true, city: "Takoradi" }));
    expect(organic([...paid, apartment1, topAd], 10)).toEqual([apartment1]);
    expect(topAds([...paid, apartment1])).toHaveLength(3);
    expect(popularCities([...paid, apartment1]).map((tile) => tile.city)).toEqual([]);
  });
});

describe("advertising carousel", () => {
  const campaign = (id: string): CampaignBanner => ({ id, placement: "MARKETPLACE_PRIMARY", headline: `Campaign ${id}`, supportingText: null, ctaLabel: null, destinationUrl: "https://developer.example/launch", desktopMediaUrl: null, mobileMediaUrl: `https://cdn.test/${id}.jpg` });

  it("with several campaigns, draws each at 88% so the next one peeks and the carousel is shorter", async () => {
    mockApi({ banners: [campaign("c0ffee00-0000-4000-8000-000000000001"), campaign("c0ffee00-0000-4000-8000-000000000002")] });
    renderRouter(APP_DIR, { initialUrl: "/" });
    const artwork = await screen.findByTestId("campaign-artwork-c0ffee00-0000-4000-8000-000000000001");
    const { width, height } = StyleSheet.flatten(artwork.props.style) as { width: number; height: number };
    expect(width).toBe(Math.round(560 * 0.88));
    expect(width / height).toBeCloseTo(2.5, 1);
  });
});
