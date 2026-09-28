// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CampaignsAdminContent } from "@/components/platform-admin/campaigns-content";

const campaign = (overrides: Record<string, unknown>) => ({
  id: "c1", name: "Launch", placement: "MARKETPLACE_PRIMARY", type: "GENERAL", status: "APPROVED", priority: 0, headline: "Airport Hills", supportingText: null, ctaLabel: null,
  destinationUrl: "https://example.com", desktopMediaUrl: null, mobileMediaUrl: null, nativeAppMediaUrl: null, isPlatformOwned: true, impressionCount: 0, clickCount: 0,
  advertiser: null, advertiserProvider: null, rejectionReason: null, startAt: null, endAt: null,
  publicEligibility: { eligible: true, reason: null }, creativeReadiness: { note: null },
  ...overrides,
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockCampaigns(items: unknown[]) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/platform-admin/campaigns") && (!init || init.method === undefined)) return { ok: true, json: async () => ({ items, total: items.length }) } as Response;
    return { ok: true, json: async () => ({ id: "c1" }) } as Response;
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("Super Admin campaign visibility", () => {
  it("labels the homepage carousel placement correctly and says whether each campaign is showing, and why not", async () => {
    mockCampaigns([
      campaign({}),
      campaign({ id: "c2", name: "Autumn", status: "SCHEDULED", startAt: "2026-10-01T00:00:00.000Z", publicEligibility: { eligible: false, reason: "Starts 2026-10-01 at 00:00 UTC" }, creativeReadiness: { note: "No own app artwork: uses the next available creative." } }),
      campaign({ id: "c3", name: "Draft one", status: "DRAFT", placement: "MARKETPLACE_INLINE", publicEligibility: { eligible: false, reason: "Draft — publish it to go live" } }),
    ]);
    render(<CampaignsAdminContent />);
    const live = await screen.findByTestId("campaign-visibility-c1");
    expect(live.textContent).toBe("Showing in Homepage Advertising Carousel (web + app)");
    expect(screen.getByTestId("campaign-visibility-c2").textContent).toContain("Not currently showing: Starts 2026-10-01 at 00:00 UTC");
    expect(screen.getByTestId("campaign-visibility-c2").textContent).toContain("No own app artwork");
    expect(screen.getByTestId("campaign-visibility-c3").textContent).toContain("Not currently showing: Draft — publish it to go live");
    expect(screen.getAllByText("Property Search Carousel").length).toBeGreaterThan(0);
  });

  it("Preview shows the uploaded artwork exactly as the public carousel does: no label, copy, CTA or gradient", async () => {
    mockCampaigns([campaign({
      supportingText: "Two- and three-bedroom homes", ctaLabel: "Learn More",
      desktopMediaUrl: "https://cdn.example.com/d.jpg", mobileMediaUrl: "https://cdn.example.com/m.jpg", nativeAppMediaUrl: null,
    })]);
    render(<CampaignsAdminContent />);
    await screen.findByTestId("campaign-visibility-c1");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const preview = await screen.findByTestId("campaign-preview-artwork");
    const image = preview.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("https://cdn.example.com/d.jpg");
    expect(image.className).toContain("object-contain");
    expect(image.getAttribute("alt")).toBe("Airport Hills");
    expect(preview.textContent).toBe("");
    expect(preview.innerHTML).not.toMatch(/gradient|Promoted|Sponsored|Learn More|bg-cover/);
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expect(screen.getByTestId("campaign-preview-artwork").querySelector("img")!.getAttribute("src")).toBe("https://cdn.example.com/m.jpg");
    // The app falls back to the mobile web artwork.
    fireEvent.click(screen.getByRole("button", { name: "Native App" }));
    expect(screen.getByTestId("campaign-preview-artwork").querySelector("img")!.getAttribute("src")).toBe("https://cdn.example.com/m.jpg");
  });

  it("Preview of an artless campaign says it will not be shown, instead of drawing a text ad", async () => {
    mockCampaigns([campaign({ ctaLabel: "Learn More", publicEligibility: { eligible: false, reason: "No artwork uploaded — only the uploaded creative is shown" }, creativeReadiness: { note: "No artwork: not shown anywhere until artwork is uploaded." } })]);
    render(<CampaignsAdminContent />);
    const visibility = await screen.findByTestId("campaign-visibility-c1");
    expect(visibility.textContent).toContain("Not currently showing: No artwork uploaded");
    expect(visibility.textContent).not.toContain("Showing in");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect((await screen.findByTestId("campaign-preview-empty")).textContent).toContain("not shown here until artwork is uploaded");
    expect(screen.queryByText("Learn More")).toBeNull();
  });

  it("new campaigns default to the homepage advertising carousel", async () => {
    const fetch = mockCampaigns([]);
    render(<CampaignsAdminContent />);
    await screen.findByText("No campaigns yet");
    fireEvent.click(screen.getByRole("button", { name: /Create Campaign/ }));
    const placement = await screen.findByLabelText("Placement") as HTMLSelectElement;
    expect(placement.value).toBe("MARKETPLACE_PRIMARY");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });
});
