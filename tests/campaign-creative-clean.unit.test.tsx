// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { MarketplaceBanner } from "@/components/marketplace-banner";
import { MarketplaceCarousel } from "@/components/marketplace-carousel";

/**
 * Uploaded campaign artwork is the finished creative: it is shown without the headline, supporting
 * copy, CTA, badge or gradient painted on it. Disclosure sits outside the art. Campaigns without
 * artwork fall back to their own text. Impressions and clicks are still recorded.
 */

const ART = { id: "c-art", headline: "Airport Hills residences", supportingText: "Two- and three-bedroom homes", ctaLabel: "See the homes", destinationUrl: "https://www.nesafric.com/marketplace/properties", desktopMediaUrl: "https://cdn.test/desktop.jpg", mobileMediaUrl: "https://cdn.test/mobile.jpg" };
const TEXT_ONLY = { ...ART, id: "c-text", desktopMediaUrl: null, mobileMediaUrl: null };

let posts: string[];

function mockCampaigns(response: { banners?: unknown[]; banner?: unknown }) {
  posts = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (init?.method === "POST") posts.push(url.pathname);
    if (url.pathname === "/api/public/campaigns") return { ok: true, json: async () => response } as Response;
    return { ok: true, json: async () => ({}) } as Response;
  }));
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MarketplaceCarousel", () => {
  it("shows artwork cleanly, keeps the whole slide clickable, and records impression and click", async () => {
    mockCampaigns({ banners: [ART] });
    render(<MarketplaceCarousel placement="MARKETPLACE_PRIMARY" />);
    const slide = await screen.findByTestId("campaign-slide");
    expect(slide.getAttribute("aria-label")).toBe("Sponsored: Airport Hills residences");
    expect(slide.getAttribute("href")).toBe(ART.destinationUrl);
    expect(within(slide).getAllByTestId("campaign-art")).toHaveLength(2);
    // Nothing painted over the creative.
    for (const text of ["Airport Hills residences", "Two- and three-bedroom homes", "See the homes", "Promoted", "Sponsored"]) {
      expect(within(slide).queryByText(text)).toBeNull();
    }
    expect(slide.innerHTML).not.toMatch(/gradient/);
    // Disclosure is for assistive technology only (the accessible name above): no visible caption
    // or badge is drawn over or around the artwork.
    expect(screen.queryByTestId("campaign-disclosure")).toBeNull();
    expect(screen.queryByText("Sponsored")).toBeNull();

    await waitFor(() => expect(posts).toContain("/api/public/campaigns/c-art/impression"));
    slide.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(slide);
    expect(posts).toContain("/api/public/campaigns/c-art/click");
  });

  it("never renders a campaign without artwork: no text fallback slide, and nothing is tracked", async () => {
    mockCampaigns({ banners: [TEXT_ONLY] });
    const { container } = render(<MarketplaceCarousel placement="MARKETPLACE_PRIMARY" />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
    expect(screen.queryByText("Airport Hills residences")).toBeNull();
    expect(posts).toEqual([]);
  });

  it("shows only campaigns that have artwork when some don't", async () => {
    mockCampaigns({ banners: [{ ...TEXT_ONLY, id: "c-none", headline: "No artwork" }, ART] });
    render(<MarketplaceCarousel placement="MARKETPLACE_PRIMARY" />);
    const slide = await screen.findByTestId("campaign-slide");
    expect(slide.getAttribute("aria-label")).toBe("Sponsored: Airport Hills residences");
    expect(screen.queryByLabelText("Sponsored: No artwork")).toBeNull();
    // One slide left: no previous/next controls.
    expect(screen.queryByRole("button", { name: "Next campaign" })).toBeNull();
    await waitFor(() => expect(posts).toContain("/api/public/campaigns/c-art/impression"));
    expect(posts.some((path) => path.includes("c-none"))).toBe(false);
  });

  it("renders nothing, not even the disclosure, when no campaign is eligible", async () => {
    mockCampaigns({ banners: [] });
    const { container } = render(<MarketplaceCarousel placement="MARKETPLACE_PRIMARY" />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});

describe("MarketplaceBanner", () => {
  it("shows artwork without copy on it, and text only when there is no artwork", async () => {
    mockCampaigns({ banner: ART });
    render(<MarketplaceBanner placement="PROFESSIONAL_FEATURED" />);
    const banner = await screen.findByTestId("campaign-banner");
    expect(banner.getAttribute("aria-label")).toBe("Sponsored: Airport Hills residences");
    expect(within(banner).queryByText("Airport Hills residences")).toBeNull();
    expect(within(banner).queryByText("Featured")).toBeNull();
    cleanup();

    mockCampaigns({ banner: TEXT_ONLY });
    render(<MarketplaceBanner placement="PROFESSIONAL_FEATURED" />);
    expect(within(await screen.findByTestId("campaign-banner")).getByText("Airport Hills residences")).toBeTruthy();
  });
});
