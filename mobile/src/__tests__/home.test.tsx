/// <reference types="node" />
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import path from "path";
import * as WebBrowser from "expo-web-browser";
import { Animated, StyleSheet } from "react-native";

import type { CampaignBanner } from "@/api/home";
import { buildFeaturedSlides, resolveDestination } from "@/home/featured";
import { wrapOffset } from "@/home/components/logo-rail";
import { homeListings, isNewListing } from "@/home/components/properties-on-nesafric";
import { railCompanies } from "@/home/components/trusted-companies";
import { listing } from "@/test-utils/fixtures";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));

const APP_DIR = path.join(__dirname, "../app");
const API = "https://api.test";
const house = listing();
const campaign: CampaignBanner = {
  id: "c0ffee00-0000-4000-8000-000000000001",
  placement: "MARKETPLACE_PRIMARY",
  headline: "Airport Hills residences",
  supportingText: "Two- and three-bedroom homes",
  ctaLabel: "See the homes",
  destinationUrl: `https://www.nesafric.com/marketplace/properties/${house.id}`,
  desktopMediaUrl: null,
  mobileMediaUrl: "https://cdn.test/airport-hills.jpg",
};

type Call = { url: URL; method: string };
let calls: Call[];

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}

function mockApi({ banners = [] as CampaignBanner[], companies = [] as unknown[], search = (_url: URL) => [house] as unknown[], listingsStatus = 200 } = {}) {
  calls = [];
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, method: init.method ?? "GET" });
    if (url.pathname === "/api/public/campaigns") return json(200, { banners });
    if (url.pathname.startsWith("/api/public/campaigns/")) return json(200, { recorded: true });
    if (url.pathname === "/api/public/marketplace-directory") return json(200, { items: companies, total: companies.length, page: 1, pageSize: 12 });
    if (url.pathname === "/api/public/listings") {
      if (listingsStatus >= 400) return json(listingsStatus, { error: { code: "INTERNAL", message: "Unavailable" } });
      const items = search(url);
      return json(200, { items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1 } });
    }
    if (url.pathname === `/api/public/listings/${house.id}`) return json(200, { listing: house });
    return json(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  }) as jest.Mock;
}

type Node = { props?: Record<string, unknown>; children?: (Node | string)[] | null } | string | null;

/** Text, placeholders and image URIs in document order (the render tree has circular props). */
function flatten(node: Node | Node[], out: string[] = []): string[] {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((child) => flatten(child, out)); return out; }
  if (typeof node === "string") { out.push(node); return out; }
  const props = node.props ?? {};
  if (typeof props.placeholder === "string") out.push(props.placeholder);
  const source = props.source as { uri?: string } | { uri?: string }[] | undefined;
  for (const item of Array.isArray(source) ? source : source ? [source] : []) if (item?.uri) out.push(item.uri);
  (node.children ?? []).forEach((child) => flatten(child, out));
  return out;
}

const searchCalls = () => calls.filter((call) => call.url.pathname === "/api/public/listings").map((call) => call.url.searchParams);

describe("marketplace home", () => {
  beforeEach(() => jest.mocked(WebBrowser.openBrowserAsync).mockClear());

  it("renders the sections in the homepage brief's order", async () => {
    mockApi();
    const view = renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByLabelText("Properties on NesAfric");
    await screen.findByTestId("company-rail-placeholder");
    const texts = flatten(view.toJSON() as Node);
    // Featured carousel (first "4 Bedroom House") → companies → properties rail (second) → Advanced Search.
    const order = ["Find your perfect property", "Area, city or property", "Rent", "Villas", "View property", "Trusted by leading companies", "Properties on NesAfric", "4 Bedroom House", "Advanced Search"];
    const positions = order.map((text, i) => (i === 7 ? texts.lastIndexOf(text) : texts.indexOf(text)));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // The old lower "Search properties" cards are gone; the chips at the top remain the entry points.
    for (const gone of ["Search properties", "Find your next home", "Own your future", "Invest in land", "Businesses & offices"]) expect(texts).not.toContain(gone);
    expect(screen.queryByLabelText(/^(For rent|For sale|Land|Commercial)\. /)).toBeNull();
  });

  it("shows sponsored campaigns first, reports the impression and click, and opens the destination in the app", async () => {
    mockApi({ banners: [campaign] });
    renderRouter(APP_DIR, { initialUrl: "/" });
    expect(await screen.findByText("Airport Hills residences")).toBeTruthy();
    expect(screen.getByText("Sponsored")).toBeTruthy();
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.pathname === `/api/public/campaigns/${campaign.id}/impression`)).toBe(true));
    fireEvent.press(screen.getByText("See the homes"));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.pathname === `/api/public/campaigns/${campaign.id}/click`)).toBe(true));
    expect(await screen.findByText("Verified property")).toBeTruthy();
  });

  it("falls back to real listings (not ads) and each slide opens that listing", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    fireEvent.press(await screen.findByText("View property"));
    expect(await screen.findByText("Verified property")).toBeTruthy();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("category chips and search cards open Search with the right filter", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    fireEvent.press(await screen.findByText("Villas"));
    await waitFor(() => expect(searchCalls().some((params) => params.get("category") === "VILLA" && params.get("pageSize") === "20")).toBe(true));
  });

  it("Properties on NesAfric shows only eligible listings and opens the tapped one", async () => {
    const pending = listing({ id: "3f1c2a9e-5a55-4a1e-9f1c-000000000007", title: "Unverified bungalow", verification: { status: "PENDING" } });
    mockApi({ search: () => [house, pending] });
    renderRouter(APP_DIR, { initialUrl: "/" });
    const card = await screen.findByLabelText(/^4 Bedroom House, For rent/);
    expect(screen.queryByLabelText(/^Unverified bungalow, For /)).toBeNull();
    fireEvent.press(card);
    expect(await screen.findByText("Verified property")).toBeTruthy();
  });

  it("See all opens the existing Search screen with every listing", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByLabelText("Properties on NesAfric");
    const before = searchCalls().length;
    fireEvent.press(screen.getAllByText("See all").at(-1)!);
    await waitFor(() => expect(searchCalls().slice(before).some((params) => params.get("pageSize") === "20" && !params.get("listingType") && !params.get("category"))).toBe(true));
  });

  it("Properties on NesAfric shows loading, then an honest empty state — never sample listings", async () => {
    mockApi({ search: () => [] });
    const view = renderRouter(APP_DIR, { initialUrl: "/" });
    expect(screen.getByLabelText("Loading properties")).toBeTruthy();
    expect(await screen.findByText("New properties will appear here.")).toBeTruthy();
    expect(flatten(view.toJSON() as Node)).not.toContain("4 Bedroom House");
  });

  it("keeps Home usable when listings fail, with a retry", async () => {
    mockApi({ listingsStatus: 500 });
    renderRouter(APP_DIR, { initialUrl: "/" });
    expect(await screen.findByText("Properties couldn't load right now.", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("Find your perfect property")).toBeTruthy();
    expect(screen.getByText("Advanced Search")).toBeTruthy();
    const before = searchCalls().length;
    fireEvent.press(screen.getByText("Try again"));
    await waitFor(() => expect(searchCalls().length).toBeGreaterThan(before));
  });

  // Regression: the logo rail used to drift by calling scrollTo every frame. On a real iPhone each
  // of those scroll events let the Home ScrollView take over any touch in progress, so chips,
  // "View property" and property cards stopped responding. The rail must drift by transform only.
  async function loopingRail() {
    const rail = await screen.findByTestId("company-rail-placeholder");
    act(() => fireEvent(rail, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 58 } } }));
  }

  it("the logo rail drifts with a native transform, not by scrolling", async () => {
    const timing = jest.spyOn(Animated, "timing");
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await loopingRail();
    const setWidth = 6 * (92 + 10);
    await waitFor(() => expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: -setWidth, useNativeDriver: true, isInteraction: false })));
    const row = screen.getByTestId("logo-rail-row");
    expect(JSON.stringify(row.props.style)).toContain("translateX");
    timing.mockRestore();
  });

  it.each([
    ["Rent", "listingType", "RENT"],
    ["Houses", "category", "HOUSE"],
    ["Apartments", "category", "APARTMENT"],
  ])("with the logo rail moving, the %s chip still opens filtered Search", async (label, key, value) => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await loopingRail();
    fireEvent.press(await screen.findByText(label));
    await waitFor(() => expect(searchCalls().some((params) => params.get(key) === value && params.get("pageSize") === "20")).toBe(true));
  });

  it("with the logo rail moving, featured View property still opens the listing", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await loopingRail();
    fireEvent.press(await screen.findByText("View property"));
    expect(await screen.findByText("Verified property")).toBeTruthy();
  });

  it("with the logo rail moving, a Properties on NesAfric card still opens the listing", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await loopingRail();
    fireEvent.press(await screen.findByLabelText(/^4 Bedroom House, For rent/));
    expect(await screen.findByText("Verified property")).toBeTruthy();
  });

  it("Advanced search opens the existing filter sheet", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    fireEvent.press(await screen.findByLabelText("Advanced search"));
    expect(await screen.findByText("Bedrooms (at least)")).toBeTruthy();
  });

  it("shows a floating Speak to AI button that opens an honest AI search sheet and closes it", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    const button = await screen.findByLabelText("Speak to AI");
    expect(screen.queryByTestId("ai-search-sheet")).toBeNull();
    fireEvent.press(button);
    const sheet = await screen.findByTestId("ai-search-sheet");
    expect(sheet.props.accessibilityLabel).toBe("AI property search");
    expect(screen.getByText("Find property with AI")).toBeTruthy();
    expect(screen.getByText("Tell NesAfric what kind of property you're looking for.")).toBeTruthy();
    expect(screen.getByText("“3-bedroom house in East Legon under GH₵3 million”")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Close"));
    await waitFor(() => expect(screen.queryByTestId("ai-search-sheet")).toBeNull());
  });

  it("the AI microphone says voice search is coming soon — nothing recorded, requested or recommended", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByLabelText("Properties on NesAfric");
    fireEvent.press(await screen.findByLabelText("Speak to AI"));
    const before = calls.length;
    fireEvent.press(screen.getByLabelText("Voice search, coming soon"));
    expect(await screen.findByText(/Nothing was recorded/)).toBeTruthy();
    expect(calls.length).toBe(before);
    expect(screen.queryByText(/recording|listening|results for/i)).toBeNull();
    fireEvent.press(screen.getByText("Use Advanced Search"));
    expect(await screen.findByText("Bedrooms (at least)")).toBeTruthy();
  });

  it("the floating layer passes touches through to Home except on the pill", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByTestId("speak-to-ai");
    expect(StyleSheet.flatten(screen.getByTestId("speak-to-ai-layer").props.style).pointerEvents).toBe("box-none");
    fireEvent.press(screen.getByText("Buy"));
    await waitFor(() => expect(searchCalls().some((params) => params.get("listingType") === "SALE" && params.get("pageSize") === "20")).toBe(true));
  });

  it("rails only verified companies with real logos, as a swipeable rail, and opens the profile", async () => {
    mockApi({ companies: [
      { slug: "accra-homes", displayName: "Accra Homes Ltd", type: "BROKERAGE", logoUrl: "/uploads/accra-homes.png", verificationStatus: "VERIFIED" },
      { slug: "legon-realty", displayName: "Legon Realty", type: "BROKERAGE", logoUrl: null, verificationStatus: "VERIFIED" },
      { slug: "test-agency", displayName: "Test Agency", type: "BROKERAGE", logoUrl: "/uploads/test.png", verificationStatus: "PENDING" },
    ] });
    const view = renderRouter(APP_DIR, { initialUrl: "/" });
    expect(await screen.findByLabelText("Accra Homes Ltd, verified company")).toBeTruthy();
    expect(screen.queryByLabelText("Legon Realty, verified company")).toBeNull();
    expect(screen.queryByLabelText("Test Agency, verified company")).toBeNull();
    expect(flatten(view.toJSON() as Node)).toContain("https://api.test/uploads/accra-homes.png");
    expect(screen.getByLabelText("Verified companies").props.horizontal).toBe(true);
    expect(screen.queryByTestId("company-rail-placeholder")).toBeNull();
    expect(calls.find((call) => call.url.pathname === "/api/public/marketplace-directory")?.url.searchParams.get("verifiedOnly")).toBe("true");
    fireEvent.press(screen.getByLabelText("Accra Homes Ltd, verified company"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://api.test/marketplace/professionals/accra-homes");
  });

  it("without verified logos shows a quiet, non-interactive rail instead of the old linked card", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    const rail = await screen.findByTestId("company-rail-placeholder");
    await screen.findByLabelText("Verified company logos will appear here");
    expect(screen.queryByText("Verified companies appear here")).toBeNull();
    expect(screen.queryByText("Agency or developer? Get verified")).toBeNull();
    expect(screen.queryAllByRole("link").some((node) => rail.findAll((child) => child === node).length > 0)).toBe(false);
    fireEvent.press(rail);
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });
});

describe("featured slides", () => {
  it("maps NesAfric destinations into the app and keeps other https links for the browser", () => {
    expect(resolveDestination(`https://www.nesafric.com/marketplace/properties/${house.id}`, API)).toEqual({ type: "listing", id: house.id });
    expect(resolveDestination("/marketplace/properties?listingType=RENT&city=Accra", API)).toEqual({ type: "search", filters: expect.objectContaining({ listingType: "RENT", city: "Accra" }) });
    expect(resolveDestination("https://developer.example/launch", API)).toEqual({ type: "web", url: "https://developer.example/launch" });
    expect(resolveDestination("http://insecure.example", API)).toBeNull();
    expect(resolveDestination("javascript:alert(1)", API)).toBeNull();
  });

  it("prefers campaigns, then listings with photos, then one NesAfric slide — never sample properties", () => {
    expect(buildFeaturedSlides([campaign], [house], API).map((slide) => slide.eyebrow)).toEqual(["Sponsored"]);
    const fromListings = buildFeaturedSlides([], [house, listing({ id: "3f1c2a9e-5a55-4a1e-9f1c-000000000009", media: [] })], API);
    expect(fromListings.map((slide) => slide.target)).toEqual([{ type: "listing", id: house.id }]);
    expect(buildFeaturedSlides([], [], API)).toEqual([expect.objectContaining({ title: "List your property on NesAfric", target: { type: "web", url: `${API}/for-professionals` } })]);
  });

});

describe("home rails", () => {
  it("keeps only verified companies with a logo, once each", () => {
    const company = (slug: string, verificationStatus = "VERIFIED", logoUrl: string | null = `/uploads/${slug}.png`) => ({ slug, displayName: slug, type: "BROKERAGE", logoUrl, verificationStatus });
    expect(railCompanies([company("a"), company("a"), company("b", "PENDING"), company("c", "VERIFIED", null), company("d", "VERIFIED", " ")]).map((c) => c.slug)).toEqual(["a"]);
  });

  it("wraps the logo rail offset into the middle copy without moving it visually", () => {
    expect(wrapOffset(100, 600)).toBe(700);
    expect(wrapOffset(700, 600)).toBe(700);
    expect(wrapOffset(1250, 600)).toBe(650);
    expect(wrapOffset(-50, 600)).toBe(1150);
  });

  it("shows at most six verified listings and marks only recently published ones as new", () => {
    const many = Array.from({ length: 8 }, (_, i) => listing({ id: `3f1c2a9e-5a55-4a1e-9f1c-00000000010${i}` }));
    expect(homeListings([listing({ verification: { status: "PENDING" } }), ...many])).toHaveLength(6);
    const now = Date.parse("2026-09-26T12:00:00.000Z");
    expect(isNewListing({ publishedAt: "2026-09-20T10:00:00.000Z" }, now)).toBe(true);
    expect(isNewListing({ publishedAt: "2026-08-01T10:00:00.000Z" }, now)).toBe(false);
    expect(isNewListing({ publishedAt: null }, now)).toBe(false);
  });
});
