// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * Homepage order: hero copy → promoted carousel → search → company logos → properties → places →
 * professionals → service providers → business gateway. The ad area and company section always
 * stay in place, with honest NesAfric-owned content when there is nothing real to show.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/components/marketing/site-nav", () => ({ SiteNav: () => <nav data-section="nav" /> }));
vi.mock("@/components/property-marketplace-search", () => ({ ListingCard: ({ listing }: { listing: { title: string } }) => <article>{listing.title}</article> }));
vi.mock("@/components/marketing/site-footer", () => ({ SiteFooter: () => <footer data-section="footer" /> }));

const BANNER = { id: "c1", headline: "New homes at Airport Hills", supportingText: null, ctaLabel: "View", destinationUrl: "https://example.com", desktopMediaUrl: null, mobileMediaUrl: null };
const COMPANY = { slug: "accra-homes", displayName: "Accra Homes", type: "BROKERAGE", logoUrl: null, verificationStatus: "VERIFIED", _count: { listings: 1, developments: 0 } };

const LISTING = { id: "l1", title: "Two-bedroom flat", listingType: "RENT", location: { city: "Accra", district: "East Legon", region: "Greater Accra" } };

function mockApi({ banners, companies, listings = [LISTING] }: { banners: unknown[]; companies: unknown[]; listings?: unknown[] }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
    if (url.pathname === "/api/public/campaigns") return json({ banners });
    if (url.pathname.startsWith("/api/public/campaigns/")) return json({});
    if (url.pathname === "/api/public/listings") return json({ items: listings, pagination: { total: listings.length } });
    if (url.pathname === "/api/public/marketplace-directory") return json({ items: url.searchParams.get("pageSize") ? companies : [], total: companies.length });
    if (url.pathname === "/api/public/marketplace/categories") return json([]);
    if (url.pathname === "/api/public/marketplace/providers") return json({ items: [], pagination: { total: 0 } });
    return { ok: false, json: async () => ({}) } as Response;
  }));
}

const { default: Home } = await import("@/app/page");

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Top-level landmarks in document order, identified by their heading/label. */
function order(container: HTMLElement) {
  const marks: string[] = [];
  container.querySelectorAll("[data-section], h1, [aria-roledescription='carousel'], form[aria-label='Search property'], h2").forEach((node) => {
    if (node.getAttribute("data-section")) marks.push(node.getAttribute("data-section")!);
    else if (node.tagName === "H1") marks.push("hero");
    else if (node.getAttribute("aria-roledescription") === "carousel") marks.push("ads");
    else if (node.tagName === "FORM") marks.push("search");
    else marks.push(node.textContent ?? "");
  });
  return marks;
}

describe("marketplace homepage order", () => {
  it("renders hero, ads, search, companies, properties, places, professionals, services, gateway, footer in order", async () => {
    mockApi({ banners: [BANNER], companies: [COMPANY] });
    const { container } = render(<Home />);
    await screen.findByText("New homes at Airport Hills");
    await screen.findByText("Companies and professionals on NesAfric");
    const marks = order(container);
    const index = (label: string) => marks.findIndex((mark) => mark === label || mark.startsWith(label));
    const sequence = ["nav", "hero", "ads", "search", "Companies and professionals", "Properties on NesAfric", "Where people are listing", "Agents, brokerages and developers", "Offer property services?", "footer"];
    const positions = sequence.map(index);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(index("Run property on NesAfric")).toBeGreaterThan(index("Offer property services?"));
    expect(index("Run property on NesAfric")).toBeLessThan(index("footer"));
  });

  it("keeps the ad area with NesAfric's own banner when no campaign is running", async () => {
    mockApi({ banners: [], companies: [] });
    const { container } = render(<Home />);
    const banner = await screen.findByTestId("platform-banner");
    expect(banner.textContent).toContain("List your property on NesAfric");
    expect(banner.textContent).toContain("Reach renters and buyers across Ghana.");
    expect(banner.textContent).not.toMatch(/Promoted/);
    expect(screen.getByRole("link", { name: "List a property" }).getAttribute("href")).toBe("/for-professionals");
    expect(container.querySelector("[aria-roledescription='carousel']")).toBeNull();
    // The banner sits above the search.
    const search = container.querySelector("form[aria-label='Search property']")!;
    expect(banner.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the ad area when campaigns can't be loaded", async () => {
    mockApi({ banners: [], companies: [] });
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => String(input).includes("/api/public/campaigns?") ? ({ ok: false, json: async () => ({}) } as Response) : base(input, init));
    render(<Home />);
    expect(await screen.findByTestId("platform-banner")).toBeTruthy();
  });

  it("shows the real campaign carousel, not the fallback, when a campaign is running", async () => {
    mockApi({ banners: [BANNER], companies: [] });
    const { container } = render(<Home />);
    await screen.findByText("New homes at Airport Hills");
    expect(container.querySelector("[aria-roledescription='carousel']")).not.toBeNull();
    expect(screen.queryByTestId("platform-banner")).toBeNull();
  });

  it("keeps the company section with an empty state, never placeholder companies, when none are verified", async () => {
    mockApi({ banners: [], companies: [] });
    const { container } = render(<Home />);
    const empty = await screen.findByTestId("companies-empty");
    expect(screen.getByText("Companies and professionals on NesAfric")).toBeTruthy();
    expect(empty.textContent).toContain("Verified companies will appear here");
    expect(screen.getByRole("link", { name: "Get verified" }).getAttribute("href")).toBe("/for-professionals");
    // No logos, no company chips, no "View all" into an empty directory.
    const section = container.querySelector("section[aria-labelledby='companies-heading']")!;
    expect(section.querySelectorAll("img")).toHaveLength(0);
    expect(section.querySelector("a[href^='/marketplace/professionals/']")).toBeNull();
    expect(screen.queryByRole("link", { name: /View all/ })).toBeNull();
  });

  it("shows the sliding logo rail when verified companies exist", async () => {
    mockApi({ banners: [], companies: [COMPANY] });
    render(<Home />);
    expect((await screen.findAllByText("Accra Homes")).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("companies-empty")).toBeNull();
  });

  it("keeps the empty-state order: hero, NesAfric banner, search, companies, properties", async () => {
    mockApi({ banners: [], companies: [], listings: [] });
    const { container } = render(<Home />);
    await screen.findByTestId("platform-banner");
    await screen.findByTestId("companies-empty");
    await screen.findByText(/Listings appear here as soon as/);
    const nodes = ["h1", "[data-testid='platform-banner']", "form[aria-label='Search property']", "#companies-heading", "#discover-heading"].map((selector) => container.querySelector(selector)!);
    nodes.forEach((node) => expect(node).not.toBeNull());
    for (let i = 1; i < nodes.length; i += 1) expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps Properties on NesAfric visible with the listing prompt when the listings API fails", async () => {
    mockApi({ banners: [], companies: [] });
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => String(input).includes("/api/public/listings") ? ({ ok: false, json: async () => ({}) } as Response) : base(input, init));
    render(<Home />);
    expect(await screen.findByText(/Listings appear here as soon as/)).toBeTruthy();
    expect(screen.getByText("Properties on NesAfric")).toBeTruthy();
  });
});
