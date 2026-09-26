/// <reference types="node" />
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import path from "path";
import * as WebBrowser from "expo-web-browser";

import type { CampaignBanner } from "@/api/home";
import { buildFeaturedSlides, resolveDestination } from "@/home/featured";
import { monogram } from "@/home/components/trusted-companies";
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

function mockApi({ banners = [] as CampaignBanner[], companies = [] as unknown[], search = (_url: URL) => [house] as unknown[] } = {}) {
  calls = [];
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, method: init.method ?? "GET" });
    if (url.pathname === "/api/public/campaigns") return json(200, { banners });
    if (url.pathname.startsWith("/api/public/campaigns/")) return json(200, { recorded: true });
    if (url.pathname === "/api/public/marketplace-directory") return json(200, { items: companies, total: companies.length, page: 1, pageSize: 12 });
    if (url.pathname === "/api/public/listings") {
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
    await screen.findByText("4 Bedroom House");
    await screen.findByText("Verified companies appear here");
    const texts = flatten(view.toJSON() as Node);
    const order = ["Find your perfect property", "Area, city or property", "Rent", "Villas", "4 Bedroom House", "Trusted by leading companies", "Search properties", "Find your next home", "Own your future", "Invest in land", "Businesses & offices", "Advanced Search"];
    const positions = order.map((text) => texts.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
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

  it("search cards open the matching results", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    fireEvent.press(await screen.findByLabelText("Land. Invest in land"));
    await waitFor(() => expect(searchCalls().some((params) => params.get("category") === "LAND" && params.get("pageSize") === "20")).toBe(true));
  });

  it("Advanced search opens the existing filter sheet", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    fireEvent.press(await screen.findByLabelText("Advanced search"));
    expect(await screen.findByText("Bedrooms (at least)")).toBeTruthy();
  });

  it("shows only real company logos, a neutral monogram otherwise, and opens the profile", async () => {
    mockApi({ companies: [
      { slug: "accra-homes", displayName: "Accra Homes Ltd", type: "BROKERAGE", logoUrl: "/uploads/accra-homes.png", verificationStatus: "VERIFIED" },
      { slug: "legon-realty", displayName: "Legon Realty", type: "BROKERAGE", logoUrl: null, verificationStatus: "VERIFIED" },
    ] });
    const view = renderRouter(APP_DIR, { initialUrl: "/" });
    expect(await screen.findByLabelText("Accra Homes Ltd, verified company")).toBeTruthy();
    expect(screen.getByText("LR")).toBeTruthy();
    expect(screen.queryByText("AH")).toBeNull();
    expect(flatten(view.toJSON() as Node)).toContain("https://api.test/uploads/accra-homes.png");
    expect(calls.find((call) => call.url.pathname === "/api/public/marketplace-directory")?.url.searchParams.get("verifiedOnly")).toBe("true");
    fireEvent.press(screen.getByLabelText("Legon Realty, verified company"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://api.test/marketplace/professionals/legon-realty");
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

  it("builds initials without inventing a logo", () => {
    expect(monogram("Accra Homes Ltd")).toBe("AH");
    expect(monogram("  legon  ")).toBe("L");
  });
});
