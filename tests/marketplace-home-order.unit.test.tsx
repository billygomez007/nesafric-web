// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/**
 * Homepage order: hero copy → search/categories → promoted carousel → trusted companies →
 * properties → places → professionals → service providers → business gateway. The advertising
 * carousel shows campaigns only and is hidden when none is eligible; the company section keeps an
 * honest empty state.
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
    if (url.pathname === "/api/public/homepage-companies") return json({ items: companies });
    if (url.pathname === "/api/public/marketplace-directory") return json({ items: [], total: companies.length });
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
  it("renders hero, search, ads, trusted companies, properties, places, professionals, services, gateway, footer in order", async () => {
    mockApi({ banners: [BANNER], companies: [COMPANY] });
    const { container } = render(<Home />);
    await screen.findByText("New homes at Airport Hills");
    await screen.findByText("Trusted by leading companies");
    const marks = order(container);
    const index = (label: string) => marks.findIndex((mark) => mark === label || mark.startsWith(label));
    const sequence = ["nav", "hero", "search", "ads", "Trusted by leading companies", "Properties on NesAfric", "Where people are listing", "Agents, brokerages and developers", "Offer property services?", "footer"];
    const positions = sequence.map(index);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(index("Run property on NesAfric")).toBeGreaterThan(index("Offer property services?"));
    expect(index("Run property on NesAfric")).toBeLessThan(index("footer"));
  });

  it("shows the eight locked property discovery categories directly below the search", async () => {
    mockApi({ banners: [], companies: [] });
    render(<Home />);

    for (const label of ["Rent", "Buy", "Land", "Commercial", "Houses", "Apartments", "Townhouses", "Villa"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
  });

  it("hides the advertising carousel cleanly when no campaign is eligible — no listing or NesAfric slide stands in", async () => {
    mockApi({ banners: [], companies: [], listings: [LISTING] });
    const { container } = render(<Home />);
    await screen.findByText("Two-bedroom flat");
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/api/public/campaigns?"))).toBe(true));
    expect(container.querySelector("[aria-roledescription='carousel']")).toBeNull();
    expect(screen.queryByText(/Promoted/)).toBeNull();
    expect(screen.queryByTestId("platform-banner")).toBeNull();
    expect(screen.queryByText("List your property on NesAfric")).toBeNull();
    // The listing appears only in Properties on NesAfric, never as an advertising slide.
    expect(screen.getAllByText("Two-bedroom flat")).toHaveLength(1);
  });

  it("hides the advertising carousel when campaigns can't be loaded", async () => {
    mockApi({ banners: [], companies: [] });
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => String(input).includes("/api/public/campaigns?") ? ({ ok: false, json: async () => ({}) } as Response) : base(input, init));
    const { container } = render(<Home />);
    await screen.findByText("Trusted by leading companies");
    expect(container.querySelector("[aria-roledescription='carousel']")).toBeNull();
  });

  it("asks the shared campaign API for the homepage carousel placement in Ghana", async () => {
    mockApi({ banners: [BANNER], companies: [] });
    render(<Home />);
    await screen.findByText("New homes at Airport Hills");
    const call = vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input), "http://localhost")).find((url) => url.pathname === "/api/public/campaigns" && url.searchParams.has("limit"))!;
    expect(call.searchParams.get("placement")).toBe("MARKETPLACE_PRIMARY");
    expect(call.searchParams.get("countryCode")).toBe("GH");
  });

  it("shows the real campaign carousel when a campaign is running", async () => {
    mockApi({ banners: [BANNER], companies: [] });
    const { container } = render(<Home />);
    await screen.findByText("New homes at Airport Hills");
    expect(container.querySelector("[aria-roledescription='carousel']")).not.toBeNull();
  });

  it("uses each campaign's desktop artwork on desktop and mobile artwork (else desktop) on mobile web", async () => {
    mockApi({ banners: [{ ...BANNER, desktopMediaUrl: "https://cdn.example.com/desktop.jpg", mobileMediaUrl: "https://cdn.example.com/mobile.jpg", nativeAppMediaUrl: "https://cdn.example.com/app.jpg" }], companies: [] });
    const { container } = render(<Home />);
    await screen.findByText("New homes at Airport Hills");
    const styles = [...container.querySelectorAll<HTMLElement>("[aria-roledescription='carousel'] [style]")].map((node) => node.style.backgroundImage);
    expect(styles).toContain('url("https://cdn.example.com/desktop.jpg")');
    expect(styles).toContain('url("https://cdn.example.com/mobile.jpg")');
    expect(styles.join(" ")).not.toContain("app.jpg");
  });

  it("keeps the company section with an empty state, never placeholder companies, when none are verified", async () => {
    mockApi({ banners: [], companies: [] });
    const { container } = render(<Home />);
    const empty = await screen.findByTestId("companies-empty");
    expect(screen.getByText("Trusted by leading companies")).toBeTruthy();
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

  it("keeps the empty-state order: hero, search, trusted companies, properties", async () => {
    mockApi({ banners: [], companies: [], listings: [] });
    const { container } = render(<Home />);
    await screen.findByTestId("companies-empty");
    await screen.findByText(/Listings appear here as soon as/);
    const nodes = ["h1", "form[aria-label='Search property']", "#companies-heading", "#discover-heading"].map((selector) => container.querySelector(selector)!);
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
