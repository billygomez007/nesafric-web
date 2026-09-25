// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/**
 * The public homepage must only surface credible data: verified professionals for the company
 * carousel and trust counts, and service categories only when a public provider offers them.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));

const CATEGORIES = [
  { id: "c1", key: "plumbing", name: "Plumbing" },
  { id: "c2", key: "electrical", name: "Electrical" },
  { id: "c3", key: "roofing", name: "Roofing" },
];

type Routes = { providers: unknown; directory?: (url: URL) => unknown };

function mockApi({ providers, directory }: Routes) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
    if (url.pathname === "/api/public/listings") return json({ items: [], pagination: { total: 0 } });
    if (url.pathname === "/api/public/campaigns") return json({ banners: [] });
    if (url.pathname === "/api/public/marketplace/categories") return json(CATEGORIES);
    if (url.pathname === "/api/public/marketplace/providers") return json(providers);
    if (url.pathname === "/api/public/marketplace-directory") return json(directory ? directory(url) : { items: [], total: 0 });
    return { ok: false, json: async () => ({}) } as Response;
  }));
}

const directoryUrls = () => vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input), "http://localhost")).filter((url) => url.pathname === "/api/public/marketplace-directory");

const { MarketplaceHome } = await import("@/components/marketplace-home/marketplace-home");

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("marketplace homepage data quality", () => {
  it("requests only verified professionals for the carousel and every homepage count", async () => {
    mockApi({ providers: { items: [], pagination: { total: 0 } } });
    render(<MarketplaceHome />);
    await waitFor(() => expect(directoryUrls().length).toBeGreaterThanOrEqual(5));
    for (const url of directoryUrls()) expect(url.searchParams.get("verifiedOnly")).toBe("true");
  });

  it("keeps the company section with an honest empty state and omits counts when no professional is verified", async () => {
    mockApi({ providers: { items: [], pagination: { total: 0 } }, directory: () => ({ items: [], total: 0 }) });
    render(<MarketplaceHome />);
    await screen.findByText("Agents, brokerages and developers");
    await waitFor(() => expect(directoryUrls().length).toBeGreaterThanOrEqual(5));
    expect(screen.getByText("Companies and professionals on NesAfric")).toBeTruthy();
    expect(await screen.findByText("Verified companies will appear here")).toBeTruthy();
    expect(screen.queryByText(/^\d+ verified$/)).toBeNull();
  });

  it("shows the verified count when there is one", async () => {
    mockApi({
      providers: { items: [], pagination: { total: 0 } },
      directory: (url) => ({ items: [], total: url.searchParams.get("type") === "DEVELOPER" ? 2 : 0 }),
    });
    render(<MarketplaceHome />);
    expect(await screen.findByText("2 verified")).toBeTruthy();
  });

  it("replaces empty service categories with a provider invitation when there are no providers", async () => {
    mockApi({ providers: { items: [], pagination: { total: 0 } } });
    render(<MarketplaceHome />);
    expect(await screen.findByText("Offer property services?")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Plumbing" })).toBeNull();
  });

  it("links only the service categories that a public provider actually offers", async () => {
    mockApi({ providers: { items: [{ categories: [CATEGORIES[0], CATEGORIES[2]] }], pagination: { total: 1 } } });
    render(<MarketplaceHome />);
    expect(await screen.findByRole("link", { name: "Plumbing" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Roofing" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Electrical" })).toBeNull();
  });
});
