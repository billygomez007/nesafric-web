// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/**
 * The public homepage must only surface credible data:
 * selected homepage companies come from the dedicated homepage-companies endpoint,
 * professional trust counts remain verified-only, and service categories appear
 * only when a public provider actually offers them.
 *
 * CompaniesCarouselSection is composed by the top-level homepage (`src/app/page.tsx`),
 * directly above MarketplaceHome, so company-rail checks render the real homepage.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@/components/marketing/site-nav", () => ({
  SiteNav: () => <nav data-section="nav" />,
}));

vi.mock("@/components/marketing/site-footer", () => ({
  SiteFooter: () => <footer data-section="footer" />,
}));

const CATEGORIES = [
  {
    id: "parent-construction",
    key: "property_services_construction_building_works",
    name: "Construction & Building Works",
    parentId: null,
    sortOrder: 10,
  },
  {
    id: "parent-repairs",
    key: "property_services_repairs_maintenance",
    name: "Repairs & Maintenance",
    parentId: null,
    sortOrder: 20,
  },
  {
    id: "c1",
    key: "plumbing",
    name: "Plumbing Repairs",
    parentId: "parent-repairs",
    sortOrder: 10,
  },
  {
    id: "c2",
    key: "electrical",
    name: "Electrical Repairs",
    parentId: "parent-repairs",
    sortOrder: 20,
  },
];

type Routes = {
  providers?: unknown;
  categories?: typeof CATEGORIES;
  directory?: (url: URL) => unknown;
  homepageCompanies?: unknown;
};

function mockApi({
  providers = { items: [], pagination: { total: 0 } },
  categories = CATEGORIES,
  directory,
  homepageCompanies = { items: [] },
}: Routes) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const json = (body: unknown) =>
        ({ ok: true, json: async () => body }) as Response;

      if (url.pathname === "/api/public/listings") {
        return json({ items: [], pagination: { total: 0 } });
      }

      if (url.pathname === "/api/public/campaigns") {
        return json({ banners: [] });
      }

      if (url.pathname === "/api/public/homepage-companies") {
        return json(homepageCompanies);
      }

      if (url.pathname === "/api/public/marketplace/categories") {
        return json(categories);
      }

      if (url.pathname === "/api/public/marketplace/providers") {
        return json(providers);
      }

      if (url.pathname === "/api/public/marketplace-directory") {
        return json(
          directory ? directory(url) : { items: [], total: 0 },
        );
      }

      return {
        ok: false,
        json: async () => ({}),
      } as Response;
    }),
  );
}

const requestedUrls = () =>
  vi
    .mocked(fetch)
    .mock.calls.map(
      ([input]) => new URL(String(input), "http://localhost"),
    );

const directoryUrls = () =>
  requestedUrls().filter(
    (url) => url.pathname === "/api/public/marketplace-directory",
  );

const homepageCompanyUrls = () =>
  requestedUrls().filter(
    (url) => url.pathname === "/api/public/homepage-companies",
  );

const { MarketplaceHome } = await import(
  "@/components/marketplace-home/marketplace-home"
);

const { default: Home } = await import("@/app/page");

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("marketplace homepage data quality", () => {
  it("uses the dedicated company rail and verified-only professional counts", async () => {
    mockApi({
      providers: { items: [], pagination: { total: 0 } },
    });

    render(<Home />);

    await waitFor(() => {
      expect(homepageCompanyUrls()).toHaveLength(1);
      expect(directoryUrls()).toHaveLength(4);
    });

    for (const url of directoryUrls()) {
      expect(url.searchParams.get("verifiedOnly")).toBe("true");
      expect(url.searchParams.get("pageSize")).toBe("1");
    }

    expect(
      directoryUrls().some(
        (url) => url.searchParams.get("pageSize") === "16",
      ),
    ).toBe(false);
  });

  it("keeps the company section honest and omits counts when no professional is verified", async () => {
    mockApi({
      providers: { items: [], pagination: { total: 0 } },
      directory: () => ({ items: [], total: 0 }),
      homepageCompanies: { items: [] },
    });

    render(<Home />);

    await screen.findByText("Agents, brokerages and developers");

    await waitFor(() => {
      expect(homepageCompanyUrls()).toHaveLength(1);
      expect(directoryUrls()).toHaveLength(4);
    });

    expect(
      screen.getByText("Trusted by leading companies"),
    ).toBeTruthy();

    expect(
      await screen.findByText("Verified companies will appear here"),
    ).toBeTruthy();

    expect(screen.queryByText(/^\d+ verified$/)).toBeNull();
  });

  it("shows the verified count when there is one", async () => {
    mockApi({
      providers: { items: [], pagination: { total: 0 } },
      directory: (url) => ({
        items: [],
        total:
          url.searchParams.get("type") === "DEVELOPER"
            ? 2
            : 0,
      }),
    });

    render(<MarketplaceHome />);

    expect(await screen.findByText("2 verified")).toBeTruthy();
  });

  it("keeps Property Services categories browsable when there are no published providers", async () => {
    mockApi({
      providers: { items: [], pagination: { total: 0 } },
      categories: CATEGORIES,
    });

    render(<MarketplaceHome />);

    const repairs = await screen.findByRole("link", {
      name: "Repairs & Maintenance",
    });

    expect(repairs.getAttribute("href")).toBe(
      "/marketplace/services/category/property_services_repairs_maintenance",
    );

    expect(
      screen.queryByRole("link", { name: "Plumbing Repairs" }),
    ).toBeNull();
  });

  it("links top-level Property Services categories to their category pages", async () => {
    mockApi({
      categories: CATEGORIES,
    });

    render(<MarketplaceHome />);

    const repairs = await screen.findByRole("link", {
      name: "Repairs & Maintenance",
    });
    expect(repairs.getAttribute("href")).toBe(
      "/marketplace/services/category/property_services_repairs_maintenance",
    );

    const construction = screen.getByRole("link", {
      name: "Construction & Building Works",
    });
    expect(construction.getAttribute("href")).toBe(
      "/marketplace/services/category/property_services_construction_building_works",
    );

    expect(screen.queryByRole("link", { name: "Plumbing Repairs" })).toBeNull();
  });
});
