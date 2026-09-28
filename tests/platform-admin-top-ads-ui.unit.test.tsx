// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { TopAdsContent, type TopAdItem } from "@/components/platform-admin/top-ads-content";

const listingSummary = (title: string) => ({
  id: `listing-${title}`,
  title,
  status: "PUBLISHED",
  verificationStatus: "VERIFIED",
  listingType: "RENT",
  category: "APARTMENT",
  location: "East Legon, Accra",
  price: { amountMinor: "250000", currencyCode: "GHS", frequency: "MONTHLY" },
  listedBy: "Golden Coast",
  coverUrl: null,
});

const item = (id: string, title: string, status: TopAdItem["status"], isActive = true): TopAdItem => ({
  id, listingId: `listing-${title}`, sortOrder: 0, isActive, startsAt: null, endsAt: null, status, listing: listingSummary(title),
});

let requests: Array<{ method: string; path: string; body?: string }>;

function mockApi(items: TopAdItem[]) {
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    requests.push({ method: init?.method ?? "GET", path: url.pathname + url.search, body: init?.body as string | undefined });
    const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body }) as Response;
    if (url.pathname === "/api/platform-admin/top-ads" && (init?.method ?? "GET") === "GET") return json({ items, maxActive: 12 });
    if (url.pathname === "/api/platform-admin/top-ads/candidates") return json({ items: [{ ...listingSummary("Fresh listing"), isTopAd: false }] });
    return json({ ok: true }, init?.method === "POST" ? 201 : 200);
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Top Ads admin screen", () => {
  it("lists Top Ads in order with honest status, and explains ones that are no longer live", async () => {
    mockApi([item("t1", "Villa One", "active"), item("t2", "Flat Two", "unavailable")]);
    render(<TopAdsContent />);
    const first = await screen.findByTestId("top-ad-t1");
    expect(within(first).getByText("Live")).toBeTruthy();
    const second = screen.getByTestId("top-ad-t2");
    expect(within(second).getByText("Not live")).toBeTruthy();
    expect(within(second).getByText(/no longer published and verified/)).toBeTruthy();
    expect((within(first).getByRole("button", { name: "Move Villa One up" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reorders with the full list of ids", async () => {
    mockApi([item("t1", "Villa One", "active"), item("t2", "Flat Two", "active")]);
    render(<TopAdsContent />);
    fireEvent.click(await screen.findByRole("button", { name: "Move Flat Two up" }));
    await waitFor(() => expect(requests.some((entry) => entry.method === "PUT" && entry.path === "/api/platform-admin/top-ads/order")).toBe(true));
    expect(JSON.parse(requests.find((entry) => entry.method === "PUT")!.body!)).toEqual({ ids: ["t2", "t1"] });
  });

  it("asks for confirmation before removing", async () => {
    mockApi([item("t1", "Villa One", "active")]);
    render(<TopAdsContent />);
    fireEvent.click(within(await screen.findByTestId("top-ad-t1")).getByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Remove this Top Ad?")).toBeTruthy();
    expect(requests.some((entry) => entry.method === "DELETE")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Top Ad" }));
    await waitFor(() => expect(requests.some((entry) => entry.method === "DELETE" && entry.path === "/api/platform-admin/top-ads/t1")).toBe(true));
  });

  it("pins a listing from the searchable picker", async () => {
    mockApi([]);
    render(<TopAdsContent />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Top Ad" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pin Fresh listing as a Top Ad" }));
    await waitFor(() => expect(requests.some((entry) => entry.method === "POST" && entry.path === "/api/platform-admin/top-ads")).toBe(true));
    expect(JSON.parse(requests.find((entry) => entry.method === "POST")!.body!)).toEqual({ listingId: "listing-Fresh listing" });
  });
});
