// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

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

// Artwork rendering, click-through and the "no Sponsored/Promoted prefix" rules are covered by
// tests/campaign-creative.unit.test.tsx (the clean-creative design that replaced this file's markup).
describe("MarketplaceCarousel", () => {
  it("never renders a campaign without artwork: no text fallback slide, and nothing is tracked", async () => {
    mockCampaigns({ banners: [TEXT_ONLY] });
    const { container } = render(<MarketplaceCarousel placement="MARKETPLACE_PRIMARY" />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
    expect(screen.queryByText("Airport Hills residences")).toBeNull();
    expect(posts).toEqual([]);
  });

  it("renders nothing, not even the disclosure, when no campaign is eligible", async () => {
    mockCampaigns({ banners: [] });
    const { container } = render(<MarketplaceCarousel placement="MARKETPLACE_PRIMARY" />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});
