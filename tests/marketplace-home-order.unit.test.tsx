// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/**
 * Homepage order: hero copy → promoted carousel → search → company logos → properties → places →
 * professionals → service providers → business gateway. Empty carousels leave no gap.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/components/marketing/site-nav", () => ({ SiteNav: () => <nav data-section="nav" /> }));
vi.mock("@/components/property-marketplace-search", () => ({ ListingCard: ({ listing }: { listing: { title: string } }) => <article>{listing.title}</article> }));
vi.mock("@/components/marketing/site-footer", () => ({ SiteFooter: () => <footer data-section="footer" /> }));

const BANNER = { id: "c1", headline: "New homes at Airport Hills", supportingText: null, ctaLabel: "View", destinationUrl: "https://example.com", desktopMediaUrl: null, mobileMediaUrl: null };
const COMPANY = { slug: "accra-homes", displayName: "Accra Homes", type: "BROKERAGE", logoUrl: null, verificationStatus: "VERIFIED", _count: { listings: 1, developments: 0 } };

const LISTING = { id: "l1", title: "Two-bedroom flat", listingType: "RENT", location: { city: "Accra", district: "East Legon", region: "Greater Accra" } };

function mockApi({ banners, companies }: { banners: unknown[]; companies: unknown[] }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
    if (url.pathname === "/api/public/campaigns") return json({ banners });
    if (url.pathname.startsWith("/api/public/campaigns/")) return json({});
    if (url.pathname === "/api/public/listings") return json({ items: [LISTING], pagination: { total: 1 } });
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

  it("collapses the ad carousel and the company carousel completely when there is nothing to show", async () => {
    mockApi({ banners: [], companies: [] });
    const { container } = render(<Home />);
    await screen.findByText("Properties on NesAfric");
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/api/public/campaigns"))).toBe(true));
    expect(container.querySelector("[aria-roledescription='carousel']")).toBeNull();
    // The carousel wrapper is still in the DOM but empty, so `empty:hidden` removes its margin and border.
    const search = container.querySelector("form[aria-label='Search property']")!;
    const wrapper = search.closest(".mt-8")!.previousElementSibling as HTMLElement;
    expect(wrapper.className).toContain("empty:hidden");
    expect(wrapper.childElementCount).toBe(0);
    expect(screen.queryByText("Companies and professionals on NesAfric")).toBeNull();
  });
});
