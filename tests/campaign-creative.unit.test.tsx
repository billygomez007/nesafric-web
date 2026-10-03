// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CampaignCreative } from "@/components/campaign-creative";
import { MarketplaceBanner } from "@/components/marketplace-banner";
import { MarketplaceCarousel } from "@/components/marketplace-carousel";

const campaign = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  headline: `Campaign headline ${id}`,
  supportingText: "Supporting copy that must not be drawn",
  ctaLabel: "Learn More",
  destinationUrl: `https://example.com/offer-${id}`,
  desktopMediaUrl: `https://cdn.example.com/${id}-desktop.jpg`,
  mobileMediaUrl: `https://cdn.example.com/${id}-mobile.jpg`,
  ...overrides,
});

/** Everything a person could see over the artwork: text nodes and elements other than the picture. */
function visibleText(container: HTMLElement) {
  return (container.textContent ?? "").trim();
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CampaignCreative", () => {
  it("renders only the uploaded artwork inside the link: no overlay, label, headline or CTA", () => {
    const { container } = render(<CampaignCreative campaign={campaign("a")} />);
    const link = screen.getByTestId("campaign-creative");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com/offer-a");
    // The link contains a <picture> and nothing else.
    expect(Array.from(link.children).map((child) => child.tagName)).toEqual(["PICTURE"]);
    expect(visibleText(container)).toBe("");
    expect(container.innerHTML).not.toMatch(/gradient|from-|via-|bg-black|opacity-|backdrop|brightness|contrast|blur|grayscale|scale-/);
    expect(screen.queryByText(/Sponsored|Promoted|Featured|Learn More|Campaign headline/)).toBeNull();
  });

  it("uses the mobile artwork on small screens and the desktop artwork from sm up, uncropped", () => {
    const { container } = render(<CampaignCreative campaign={campaign("b")} />);
    const source = container.querySelector("source")!;
    expect(source.getAttribute("media")).toBe("(min-width: 640px)");
    expect(source.getAttribute("srcset")).toBe("https://cdn.example.com/b-desktop.jpg");
    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("https://cdn.example.com/b-mobile.jpg");
    expect(image.className).toContain("object-cover");
    expect(image.className).not.toContain("object-contain");
    // Web campaigns use the compact responsive frame and fill it edge-to-edge.
    const box = screen.getByTestId("campaign-creative");
    expect(box.className).toContain("h-36");
    expect(box.className).toContain("sm:h-40");
    expect(box.className).toContain("lg:h-44");
  });

  it("falls back to the other artwork at that artwork's own proportions", () => {
    render(<CampaignCreative campaign={campaign("c", { mobileMediaUrl: null })} />);
    const box = screen.getByTestId("campaign-creative");
    expect(box.className).toContain("h-36");
    expect(box.className).toContain("sm:h-40");
    expect(box.className).toContain("lg:h-44");
    expect(box.querySelector("img")!.getAttribute("src")).toBe("https://cdn.example.com/c-desktop.jpg");
    expect(box.querySelector("source")).toBeNull();
  });

  it("stays accessible: the headline alone is the link's name and the image's text alternative, never drawn", () => {
    const { container } = render(<CampaignCreative campaign={campaign("d")} />);
    const link = screen.getByRole("link", { name: "Campaign headline d" });
    expect(link.getAttribute("aria-label")).toBe("Campaign headline d");
    expect(screen.getByAltText("Campaign headline d")).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/Promoted|Sponsored/);
    expect(visibleText(container)).toBe("");
  });

  it("without a destination, shows the artwork without a link", () => {
    render(<CampaignCreative campaign={campaign("e", { destinationUrl: null })} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByAltText("Campaign headline e")).toBeTruthy();
  });
});

describe("MarketplaceCarousel and MarketplaceBanner", () => {
  function mockCampaigns(body: unknown) {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => body }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("the Marketplace Primary carousel draws nothing over the artwork, keeps controls below it, and clicks through", async () => {
    const artless = campaign("none", { desktopMediaUrl: null, mobileMediaUrl: null });
    const fetchMock = mockCampaigns({ banners: [campaign("one"), artless, campaign("two")] });
    const { container } = await act(async () => render(<MarketplaceCarousel placement="MARKETPLACE_PRIMARY" />));
    const slide = await screen.findByTestId("campaign-creative");
    expect(visibleText(slide)).toBe("");
    expect(screen.getByRole("link", { name: "Campaign headline one" })).toBe(slide);
    // Nothing anywhere in the carousel zooms, tints or labels the artwork.
    expect(container.innerHTML).not.toMatch(/hover:scale|scale-|gradient|from-black|bg-black|backdrop|Sponsored|Promoted|Featured|Learn More/);
    // The campaign without artwork is skipped: two slides, two dots.
    expect(screen.getAllByRole("button", { name: /^Show campaign \d of 2:/ })).toHaveLength(2);
    expect(screen.queryByText(/Sponsored|Promoted|Learn More|Campaign headline|Supporting copy/)).toBeNull();
    // Controls live in their own bar, not inside (on top of) the slide.
    const controls = screen.getByTestId("campaign-controls");
    expect(slide.contains(controls)).toBe(false);
    expect(controls.contains(slide)).toBe(false);

    fireEvent.click(slide);
    expect(fetchMock).toHaveBeenCalledWith("/api/public/campaigns/one/click", { method: "POST" });
    fireEvent.click(screen.getByRole("button", { name: "Next campaign" }));
    expect(screen.getByTestId("campaign-creative").getAttribute("href")).toBe("https://example.com/offer-two");
  });

  it("the single-campaign banner renders nothing for a campaign without artwork", async () => {
    mockCampaigns({ banner: campaign("bare", { desktopMediaUrl: null, mobileMediaUrl: null }) });
    const { container } = await act(async () => render(<MarketplaceBanner placement="PROFESSIONAL_FEATURED" />));
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });

  it("the single-campaign banner shows only the artwork too", async () => {
    mockCampaigns({ banner: campaign("solo") });
    const { container } = await act(async () => render(<MarketplaceBanner placement="PROFESSIONAL_FEATURED" />));
    const slide = await screen.findByTestId("campaign-creative");
    expect(visibleText(slide)).toBe("");
    expect(screen.getByRole("link", { name: "Campaign headline solo" })).toBe(slide);
    expect(container.innerHTML).not.toMatch(/hover:scale|scale-|gradient|Sponsored|Promoted|Featured|Learn More/);
    expect(screen.queryByText(/Featured|Learn More|Campaign headline|Supporting copy/)).toBeNull();
    expect(slide.innerHTML).not.toMatch(/gradient|scale-105/);
  });
});
