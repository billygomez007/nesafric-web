// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketplaceCarousel } from "@/components/marketplace-carousel";
import { CampaignsAdminContent } from "@/components/platform-admin/campaigns-content";
import { NATIVE_APP_FALLBACK_SPEC, PLACEMENT_CREATIVE_SPECS, aspectRatioLabel } from "@/modules/campaigns/creative-spec";
import { DEFAULT_ROTATION_SECONDS, ROTATION_SECONDS_OPTIONS, isRotationSeconds } from "@/modules/campaigns/rotation";

const campaign = (id: string) => ({
  id,
  headline: `Campaign ${id}`,
  supportingText: null,
  ctaLabel: null,
  destinationUrl: `https://example.com/${id}`,
  desktopMediaUrl: `https://cdn.example.com/${id}-desktop.jpg`,
  mobileMediaUrl: `https://cdn.example.com/${id}-mobile.jpg`,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("campaign rotation setting", () => {
  it("offers 5, 8 and 10 seconds and defaults to 5", () => {
    expect(ROTATION_SECONDS_OPTIONS).toEqual([5, 8, 10]);
    expect(DEFAULT_ROTATION_SECONDS).toBe(5);
    for (const value of [5, 8, 10]) expect(isRotationSeconds(value)).toBe(true);
    for (const value of [0, 1, 7, 12, "5", null]) expect(isRotationSeconds(value)).toBe(false);
  });

  it("recommends 1200 x 480 (2.5:1) native artwork for every image placement", () => {
    for (const spec of Object.values(PLACEMENT_CREATIVE_SPECS)) expect(spec!.nativeApp).toEqual({ width: 1200, height: 480 });
    expect(NATIVE_APP_FALLBACK_SPEC).toEqual({ width: 1200, height: 480 });
    expect(aspectRatioLabel(NATIVE_APP_FALLBACK_SPEC)).toBe("2.5:1");
  });
});

describe("web Marketplace Primary carousel pace", () => {
  function stub(body: unknown) {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => body }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    return fetchMock;
  }
  const shown = () => screen.getByTestId("campaign-creative").getAttribute("href");

  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }));

  it.each([
    [undefined, 5],
    [8, 8],
    [10, 10],
    [3, 5],
  ])("rotationSeconds %s advances every %i seconds", async (rotationSeconds, seconds) => {
    stub({ banners: [campaign("one"), campaign("two")], ...(rotationSeconds === undefined ? {} : { rotationSeconds }) });
    await act(async () => { render(<MarketplaceCarousel placement="MARKETPLACE_PRIMARY" />); });
    expect(shown()).toBe("https://example.com/one");
    await act(async () => { vi.advanceTimersByTime(seconds * 1000 - 1); });
    expect(shown()).toBe("https://example.com/one");
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(shown()).toBe("https://example.com/two");
  });

  it("does not rotate a single campaign", async () => {
    stub({ banners: [campaign("one")], rotationSeconds: 5 });
    await act(async () => { render(<MarketplaceCarousel placement="MARKETPLACE_PRIMARY" />); });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(shown()).toBe("https://example.com/one");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Super Admin carousel rotation control", () => {
  const placements = [
    "MARKETPLACE_PRIMARY",
    "MARKETPLACE_INLINE",
    "SERVICE_MARKETPLACE_PRIMARY",
  ] as const;

  function stubAdmin(rotationSeconds = 5) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const placement = placements.find((value) => url.endsWith(`/placements/${value}/rotation`));
      if (placement) {
        if (init?.method === "PUT") {
          return { ok: true, json: async () => ({ placement, ...JSON.parse(String(init.body)) }) } as Response;
        }
        return { ok: true, json: async () => ({ placement, rotationSeconds }) } as Response;
      }
      return { ok: true, json: async () => ({ items: [], total: 0 }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("shows independent homepage, property and service rotation controls and saves the selected placement", async () => {
    const fetchMock = stubAdmin(5);
    render(<CampaignsAdminContent />);

    const labels = [
      "Homepage Advertising Carousel",
      "Property Marketplace Advertising Carousel",
      "Service Marketplace Advertising Carousel",
    ];

    for (const label of labels) {
      const group = await screen.findByRole("radiogroup", { name: `${label} carousel rotation` });
      await waitFor(() =>
        expect(group.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("5 seconds"),
      );
      expect(Array.from(group.querySelectorAll("[role=radio]")).map((radio) => radio.textContent)).toEqual([
        "5 seconds",
        "8 seconds",
        "10 seconds",
      ]);
    }

    const serviceGroup = screen.getByRole("radiogroup", {
      name: "Service Marketplace Advertising Carousel carousel rotation",
    });
    fireEvent.click(Array.from(serviceGroup.querySelectorAll("[role=radio]")).find((radio) => radio.textContent === "8 seconds")!);

    await waitFor(() =>
      expect(serviceGroup.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("8 seconds"),
    );

    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(String(put[0])).toBe(
      "/api/platform-admin/campaigns/placements/SERVICE_MARKETPLACE_PRIMARY/rotation",
    );
    expect(JSON.parse(String(put[1]!.body))).toEqual({ rotationSeconds: 8 });
  });
});
