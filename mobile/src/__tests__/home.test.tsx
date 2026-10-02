/// <reference types="node" />
import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import path from "path";
import * as WebBrowser from "expo-web-browser";
import { Animated, StyleSheet } from "react-native";

import type { CampaignBanner } from "@/api/home";
import { buildFeaturedSlides, NATIVE_CAMPAIGN_ASPECT, nativeCampaignCreative, resolveDestination, rotationMs } from "@/home/featured";
import { useCarouselAutoplay } from "@/home/use-carousel-autoplay";
import { wrapOffset } from "@/home/components/logo-rail";
import { isNewListing } from "@/home/discovery/cards";
import { eligible } from "@/home/discovery/collections";
import { railCompanies } from "@/home/components/trusted-companies";
import { scrollFeed } from "@/test-utils/feed";
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

/** Like the server: a listing is returned only for queries it matches. */
function matching(url: URL, items: ReturnType<typeof listing>[]) {
  const p = url.searchParams;
  return items.filter((item) =>
    (!p.get("category") || p.get("category") === item.category) &&
    (!p.get("listingType") || p.get("listingType") === item.listingType) &&
    (!p.get("city") || p.get("city") === item.location.city));
}

function mockApi({ banners = [] as CampaignBanner[], companies = [] as unknown[], search = (url: URL) => matching(url, [house]) as unknown[], listingsStatus = 200 } = {}) {
  calls = [];
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, method: init.method ?? "GET" });
    if (url.pathname === "/api/public/campaigns") return json(200, { banners });
    if (url.pathname.startsWith("/api/public/campaigns/")) return json(200, { recorded: true });
    if (url.pathname === "/api/public/homepage-companies") return json(200, { items: companies });
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
    await screen.findByLabelText("Newly listed");
    await scrollFeed();
    await screen.findByTestId("company-rail-placeholder");
    const texts = flatten(view.toJSON() as Node);
    // Hero → chips → (carousel) → trusted companies directly under it → the first property shelf →
    // Advanced Search. No campaign runs here, so there is no carousel; the listing appears once.
    const order = ["Find your perfect property", "Area, city or property", "Rent", "Villas", "Trusted by leading companies", "Newly listed", "4 Bedroom House", "Advanced Search"];
    const positions = order.map((text) => texts.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // The old lower "Search properties" cards are gone; the chips at the top remain the entry points.
    for (const gone of ["Search properties", "Find your next home", "Own your future", "Invest in land", "Businesses & offices"]) expect(texts).not.toContain(gone);
    expect(screen.queryByLabelText(/^(For rent|For sale|Land|Commercial)\. /)).toBeNull();
  });

  it("shows a campaign's artwork, reports the impression and click, and opens the destination in the app", async () => {
    mockApi({ banners: [campaign] });
    renderRouter(APP_DIR, { initialUrl: "/" });
    // The accessible name is the headline alone, with no "Sponsored:"/"Promoted:" prefix.
    const artwork = await screen.findByLabelText("Airport Hills residences");
    expect(artwork).toBe(screen.getByTestId(`campaign-artwork-${campaign.id}`));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.pathname === `/api/public/campaigns/${campaign.id}/impression`)).toBe(true));
    expect(calls.some((call) => call.method === "POST" && call.url.pathname.endsWith("/click"))).toBe(false);
    fireEvent.press(artwork);
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.pathname === `/api/public/campaigns/${campaign.id}/click`)).toBe(true));
    expect(await screen.findByText("Verified property")).toBeTruthy();
  });

  it("shows the uploaded artwork untouched: no label, headline, copy, button, shade or crop, controls outside", async () => {
    const second = { ...campaign, id: "c0ffee00-0000-4000-8000-000000000002", headline: "Second campaign", mobileMediaUrl: "https://cdn.test/second.jpg" };
    mockApi({ banners: [campaign, second] });
    const view = renderRouter(APP_DIR, { initialUrl: "/" });
    const artwork = await screen.findByTestId(`campaign-artwork-${campaign.id}`);
    for (const text of ["Sponsored", "Promoted", "Featured", "Airport Hills residences", "Second campaign", "Two- and three-bedroom homes", "See the homes", "Learn more", "Learn More"]) {
      expect(screen.queryByText(text)).toBeNull();
    }
    expect(screen.queryByLabelText(/^(Sponsored|Promoted)/)).toBeNull();
    // The card holds the artwork and nothing else, uncropped and unstretched.
    const images = artwork.findAll((node) => typeof node.type === "string" && node.props.source != null);
    expect(images).toHaveLength(1);
    expect(images[0].props.contentFit ?? images[0].props.resizeMode).toBe("contain");
    expect(artwork.findAll((node) => typeof node.type === "string" && typeof node.props.children === "string")).toHaveLength(0);
    // No shade, gradient or tint drawn over the artwork.
    expect(JSON.stringify(artwork.findAll(() => true).map((node) => node.props.style))).not.toMatch(/gradient|rgba\(0,22,20/);
    // Dots and arrows sit below the card, not over it.
    const controls = screen.getByTestId("featured-controls");
    expect(artwork.findAll((node) => node === controls)).toHaveLength(0);
    expect(controls.findAll((node) => node === artwork)).toHaveLength(0);
    expect(flatten(view.toJSON() as Node)).not.toContain("Second campaign");
  });

  it("hides the advertising carousel when no campaign is eligible — listings are never promoted into it", async () => {
    mockApi();
    const view = renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByLabelText("Newly listed");
    await waitFor(() => expect(calls.some((call) => call.url.pathname === "/api/public/campaigns")).toBe(true));
    expect(screen.queryByTestId("advertising-carousel")).toBeNull();
    expect(screen.queryByText("Sponsored")).toBeNull();
    expect(screen.queryByText("View property")).toBeNull();
    expect(screen.queryByText("List your property on NesAfric")).toBeNull();
    expect(flatten(view.toJSON() as Node).filter((text) => text === "4 Bedroom House")).toHaveLength(1);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("hides the advertising carousel when campaigns can't be loaded", async () => {
    mockApi();
    const base = jest.mocked(globalThis.fetch).getMockImplementation()!;
    jest.mocked(globalThis.fetch).mockImplementation((input, init) => (new URL(String(input)).pathname === "/api/public/campaigns" ? json(500, { error: { code: "INTERNAL", message: "Down" } }) : base(input, init)));
    renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByLabelText("Newly listed");
    await waitFor(() => expect(jest.mocked(globalThis.fetch).mock.calls.some(([input]) => new URL(String(input)).pathname === "/api/public/campaigns")).toBe(true));
    expect(screen.queryByTestId("advertising-carousel")).toBeNull();
  });

  it("hides the carousel when no campaign has usable artwork — never a text-only ad; listings stay in their rail", async () => {
    mockApi({ banners: [{ ...campaign, mobileMediaUrl: null, desktopMediaUrl: "   ", nativeAppMediaUrl: "" }] });
    const view = renderRouter(APP_DIR, { initialUrl: "/" });
    const card = await screen.findByLabelText(/^4 Bedroom House, For rent/);
    await waitFor(() => expect(calls.some((call) => call.url.pathname === "/api/public/campaigns")).toBe(true));
    expect(screen.queryByTestId("advertising-carousel")).toBeNull();
    const texts = flatten(view.toJSON() as Node);
    for (const text of ["Airport Hills residences", "Two- and three-bedroom homes", "See the homes", "Sponsored", "View property", "List your property on NesAfric"]) expect(texts).not.toContain(text);
    expect(texts.filter((text) => text === "4 Bedroom House")).toHaveLength(1);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    // The listing rail still works on its own.
    fireEvent.press(card);
    expect(await screen.findByText("Verified property")).toBeTruthy();
  });

  it("requests the homepage carousel placement for Ghana from the shared campaign API", async () => {
    mockApi({ banners: [campaign] });
    renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByTestId(`campaign-artwork-${campaign.id}`);
    const request = calls.find((call) => call.url.pathname === "/api/public/campaigns")!;
    expect(request.url.searchParams.get("placement")).toBe("MARKETPLACE_INLINE");
    expect(request.url.searchParams.get("countryCode")).toBe("GH");
  });

  it("shows the native-app creative for a campaign", async () => {
    mockApi({ banners: [{ ...campaign, nativeAppMediaUrl: "https://cdn.test/airport-hills-app.jpg" }] });
    const view = renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByTestId(`campaign-artwork-${campaign.id}`);
    const texts = flatten(view.toJSON() as Node);
    expect(texts).toContain("https://cdn.test/airport-hills-app.jpg");
    expect(texts).not.toContain("https://cdn.test/airport-hills.jpg");
  });

  it("category chips and search cards open Search with the right filter", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    fireEvent.press(await screen.findByText("Villas"));
    await waitFor(() => expect(searchCalls().some((params) => params.get("category") === "VILLA" && params.get("pageSize") === "20")).toBe(true));
  });

  it("Newly listed shows only eligible listings and opens the tapped one", async () => {
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
    await screen.findByLabelText("Newly listed");
    const before = searchCalls().length;
    fireEvent.press(screen.getAllByText("See all").at(-1)!);
    await waitFor(() => expect(searchCalls().slice(before).some((params) => params.get("pageSize") === "20" && !params.get("listingType") && !params.get("category"))).toBe(true));
  });

  it("Newly listed shows loading, then an honest empty state — never sample listings", async () => {
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
    await scrollFeed();
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
    await scrollFeed();
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

  it("with the logo rail moving, campaign artwork still opens its destination", async () => {
    mockApi({ banners: [campaign] });
    renderRouter(APP_DIR, { initialUrl: "/" });
    await loopingRail();
    fireEvent.press(await screen.findByTestId(`campaign-artwork-${campaign.id}`));
    expect(await screen.findByText("Verified property")).toBeTruthy();
  });

  it("with the logo rail moving, a Newly listed card still opens the listing", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await loopingRail();
    fireEvent.press(await screen.findByLabelText(/^4 Bedroom House, For rent/));
    expect(await screen.findByText("Verified property")).toBeTruthy();
  });

  it("Advanced search opens the existing filter sheet", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await scrollFeed();
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
    await screen.findByLabelText("Newly listed");
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

  it("draws the premium background behind Home, never taking touches", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByLabelText("Newly listed");
    // Hidden from screen readers by design, so the query has to include hidden elements.
    const background = screen.getByTestId("home-premium-background", { includeHiddenElements: true });
    expect(StyleSheet.flatten(background.props.style).pointerEvents).toBe("none");
    expect(background.props.accessibilityElementsHidden).toBe(true);
    // It is the first child of the Home root, so everything else paints above it…
    expect(background.parent?.children[0]).toBe(background);
    // …and it holds no Home content.
    expect(background.findAll((node) => node.props?.accessibilityRole === "button" || node.props?.accessibilityRole === "link")).toHaveLength(0);
  });

  it("with the premium background, Speak to AI opens and the Rent chip still navigates", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByTestId("home-premium-background", { includeHiddenElements: true });
    fireEvent.press(await screen.findByLabelText("Speak to AI"));
    expect(await screen.findByTestId("ai-search-sheet")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Close"));
    await waitFor(() => expect(screen.queryByTestId("ai-search-sheet")).toBeNull());
    fireEvent.press(screen.getByText("Rent"));
    await waitFor(() => expect(searchCalls().some((params) => params.get("listingType") === "RENT" && params.get("pageSize") === "20")).toBe(true));
  });

  it("rails only verified companies with real logos, as a swipeable rail, and opens the profile", async () => {
    mockApi({ companies: [
      { slug: "accra-homes", displayName: "Accra Homes Ltd", type: "BROKERAGE", logoUrl: "/uploads/accra-homes.png", verificationStatus: "VERIFIED" },
      { slug: "legon-realty", displayName: "Legon Realty", type: "BROKERAGE", logoUrl: null, verificationStatus: "VERIFIED" },
      { slug: "test-agency", displayName: "Test Agency", type: "BROKERAGE", logoUrl: "/uploads/test.png", verificationStatus: "PENDING" },
    ] });
    const view = renderRouter(APP_DIR, { initialUrl: "/" });
    await scrollFeed();
    expect(await screen.findByLabelText("Accra Homes Ltd, verified company")).toBeTruthy();
    expect(screen.queryByLabelText("Legon Realty, verified company")).toBeNull();
    expect(screen.queryByLabelText("Test Agency, verified company")).toBeNull();
    expect(flatten(view.toJSON() as Node)).toContain("https://api.test/uploads/accra-homes.png");
    expect(screen.getByLabelText("Verified companies").props.horizontal).toBe(true);
    expect(screen.queryByTestId("company-rail-placeholder")).toBeNull();
    // The curated Homepage Media rail, not the raw directory (which also lists agents and brokers).
    expect(calls.some((call) => call.url.pathname === "/api/public/homepage-companies")).toBe(true);
    expect(calls.some((call) => call.url.pathname === "/api/public/marketplace-directory")).toBe(false);
    fireEvent.press(screen.getByLabelText("Accra Homes Ltd, verified company"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://api.test/marketplace/professionals/accra-homes");
  });

  it("without verified logos shows a quiet, non-interactive rail instead of the old linked card", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await scrollFeed();
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

  it("builds slides from campaigns only, in server order — no listing or NesAfric fallback", () => {
    const second = { ...campaign, id: "c0ffee00-0000-4000-8000-000000000002", headline: "Second" };
    expect(buildFeaturedSlides([campaign, second], API).map((slide) => slide.campaignId)).toEqual([campaign.id, second.id]);
    // Artwork, headline (for accessibility only) and destination: no label, copy or CTA to draw.
    expect(buildFeaturedSlides([campaign], API)).toEqual([{
      key: `campaign:${campaign.id}`,
      campaignId: campaign.id,
      headline: "Airport Hills residences",
      imageUrl: "https://cdn.test/airport-hills.jpg",
      target: { type: "listing", id: house.id },
    }]);
    expect(buildFeaturedSlides([], API)).toEqual([]);
    // An unsafe destination drops that campaign rather than inventing a target.
    expect(buildFeaturedSlides([{ ...campaign, destinationUrl: "javascript:alert(1)" }], API)).toEqual([]);
    // A campaign without usable artwork is skipped; the rest keep their order.
    const artless = { ...campaign, id: "c0ffee00-0000-4000-8000-000000000003", mobileMediaUrl: null, desktopMediaUrl: null, nativeAppMediaUrl: null };
    expect(buildFeaturedSlides([artless, second], API).map((slide) => slide.campaignId)).toEqual([second.id]);
    expect(buildFeaturedSlides([artless], API)).toEqual([]);
    // Campaigns are the only input: real listings can never become advertising slides.
    expect(buildFeaturedSlides.length).toBe(2);
  });

  it("picks native-app artwork, then mobile web, then desktop", () => {
    expect(nativeCampaignCreative({ nativeAppMediaUrl: "app", mobileMediaUrl: "mobile", desktopMediaUrl: "desktop" })).toBe("app");
    expect(nativeCampaignCreative({ nativeAppMediaUrl: null, mobileMediaUrl: "mobile", desktopMediaUrl: "desktop" })).toBe("mobile");
    expect(nativeCampaignCreative({ mobileMediaUrl: null, desktopMediaUrl: "desktop" })).toBe("desktop");
    expect(nativeCampaignCreative({ nativeAppMediaUrl: null, mobileMediaUrl: null, desktopMediaUrl: null })).toBeNull();
    // Blank or whitespace-only URLs count as missing.
    expect(nativeCampaignCreative({ nativeAppMediaUrl: "  ", mobileMediaUrl: "mobile", desktopMediaUrl: "desktop" })).toBe("mobile");
    expect(nativeCampaignCreative({ nativeAppMediaUrl: "", mobileMediaUrl: " ", desktopMediaUrl: "desktop" })).toBe("desktop");
    expect(nativeCampaignCreative({ nativeAppMediaUrl: " ", mobileMediaUrl: "", desktopMediaUrl: "\t" })).toBeNull();
    expect(buildFeaturedSlides([{ ...campaign, nativeAppMediaUrl: "/uploads/app.jpg" }], API)[0].imageUrl).toBe(`${API}/uploads/app.jpg`);
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
    expect(eligible([listing({ verification: { status: "PENDING" } }), ...many], 6)).toHaveLength(6);
    const now = Date.parse("2026-09-26T12:00:00.000Z");
    expect(isNewListing({ publishedAt: "2026-09-20T10:00:00.000Z" }, now)).toBe(true);
    expect(isNewListing({ publishedAt: "2026-08-01T10:00:00.000Z" }, now)).toBe(false);
    expect(isNewListing({ publishedAt: null }, now)).toBe(false);
  });
});

describe("advertising carousel size and controls", () => {
  it("keeps the full width and draws a 2.5:1 card (1200 x 480), about 60% of the old 1200 x 792 height", async () => {
    mockApi({ banners: [campaign] });
    renderRouter(APP_DIR, { initialUrl: "/" });
    const artwork = await screen.findByTestId(`campaign-artwork-${campaign.id}`);
    const { width, height } = StyleSheet.flatten(artwork.props.style) as { width: number; height: number };
    // Width is unchanged: the screen minus the 16pt gutters, capped at 560.
    expect(width).toBe(560);
    expect(height).toBe(Math.round(width * 0.4));
    expect(width / height).toBeCloseTo(2.5, 1);
    const oldHeight = Math.round(Math.min(width * (792 / 1200), 320));
    expect(height / oldHeight).toBeGreaterThanOrEqual(0.55);
    expect(height / oldHeight).toBeLessThanOrEqual(0.72);
    const image = artwork.findAll((node) => typeof node.type === "string" && node.props.source != null)[0];
    expect(image.props.contentFit ?? image.props.resizeMode).toBe("contain");
  });

  it("on an iPhone-width screen the card is ~60% of its old height", () => {
    const cardWidth = 402 - 32;
    const before = Math.round(Math.min(cardWidth * (792 / 1200), 320));
    const after = Math.round(cardWidth * NATIVE_CAMPAIGN_ASPECT);
    expect([cardWidth, before, after]).toEqual([370, 244, 148]);
    expect(after / before).toBeCloseTo(0.61, 2);
  });

  it("has no arrow buttons; one dot per campaign, and none for a single campaign", async () => {
    const second = { ...campaign, id: "c0ffee00-0000-4000-8000-00000000a002", headline: "Second campaign", mobileMediaUrl: "https://cdn.test/second.jpg" };
    const artless = { ...campaign, id: "c0ffee00-0000-4000-8000-00000000a003", mobileMediaUrl: null, desktopMediaUrl: null, nativeAppMediaUrl: null };
    mockApi({ banners: [campaign, artless, second] });
    const view = renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByTestId(`campaign-artwork-${campaign.id}`);
    expect(screen.queryByLabelText(/(Previous|Next) (advertisement|campaign)/)).toBeNull();
    expect(screen.queryByTestId(`campaign-artwork-${artless.id}`)).toBeNull();
    expect(screen.getAllByTestId(/^featured-dot/, { includeHiddenElements: true })).toHaveLength(2);
    expect(screen.getByTestId("featured-dot-active", { includeHiddenElements: true })).toBeTruthy();
    view.unmount();

    mockApi({ banners: [campaign] });
    renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByTestId(`campaign-artwork-${campaign.id}`);
    expect(screen.queryAllByTestId(/^featured-dot/, { includeHiddenElements: true })).toHaveLength(0);
  });

  it("uses the API's placement rotation, else 5 seconds", () => {
    expect(rotationMs(undefined)).toBe(5000);
    expect(rotationMs(5)).toBe(5000);
    expect(rotationMs(8)).toBe(8000);
    expect(rotationMs(10)).toBe(10000);
    expect(rotationMs(1)).toBe(5000);
    expect(rotationMs("8")).toBe(5000);
  });
});

describe("carousel autoplay timer", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function setup(initial: { count: number; delayMs?: number; paused?: boolean }) {
    const onAdvance = jest.fn();
    const hook = renderHook((props: { count: number; current: number; delayMs: number; paused: boolean }) => useCarouselAutoplay({ ...props, onAdvance: (next) => { onAdvance(next); hook.rerender({ ...props, current: next }); } }), {
      initialProps: { count: initial.count, current: 0, delayMs: initial.delayMs ?? 5000, paused: initial.paused ?? false },
    });
    return { onAdvance, hook };
  }

  it("advances every 5 seconds, loops back to the first campaign", () => {
    const { onAdvance } = setup({ count: 3 });
    act(() => { jest.advanceTimersByTime(4999); });
    expect(onAdvance).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(onAdvance).toHaveBeenLastCalledWith(1);
    act(() => { jest.advanceTimersByTime(5000); });
    expect(onAdvance).toHaveBeenLastCalledWith(2);
    act(() => { jest.advanceTimersByTime(5000); });
    expect(onAdvance).toHaveBeenLastCalledWith(0);
    expect(onAdvance).toHaveBeenCalledTimes(3);
  });

  it.each([8000, 10000])("honours a %i ms rotation", (delayMs) => {
    const { onAdvance } = setup({ count: 2, delayMs });
    act(() => { jest.advanceTimersByTime(delayMs - 1); });
    expect(onAdvance).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(onAdvance).toHaveBeenCalledWith(1);
  });

  it("never rotates a single campaign", () => {
    const { onAdvance } = setup({ count: 1 });
    act(() => { jest.advanceTimersByTime(60_000); });
    expect(onAdvance).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("holds while paused (a finger on it, reduced motion, off screen) and resumes with a full wait", () => {
    const { onAdvance, hook } = setup({ count: 3 });
    act(() => { jest.advanceTimersByTime(3000); });
    hook.rerender({ count: 3, current: 0, delayMs: 5000, paused: true });
    act(() => { jest.advanceTimersByTime(60_000); });
    expect(onAdvance).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    // A swipe lands on slide 1 and the finger lifts.
    hook.rerender({ count: 3, current: 1, delayMs: 5000, paused: false });
    act(() => { jest.advanceTimersByTime(4999); });
    expect(onAdvance).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(onAdvance).toHaveBeenCalledWith(2);
  });

  it("keeps one timer only and clears it on unmount", () => {
    const { hook } = setup({ count: 3 });
    expect(jest.getTimerCount()).toBe(1);
    hook.rerender({ count: 3, current: 2, delayMs: 5000, paused: false });
    expect(jest.getTimerCount()).toBe(1);
    hook.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
