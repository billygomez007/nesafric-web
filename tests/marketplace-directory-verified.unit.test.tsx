// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/** The public professional directory is verified-only, with or without filters. */

let search = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search), usePathname: () => "/marketplace/professionals" }));
vi.mock("@/components/marketplace-banner", () => ({ MarketplaceBanner: () => null }));

const verified = { slug: "a", displayName: "Accra Homes", type: "BROKERAGE", logoUrl: null, description: null, verificationStatus: "VERIFIED", countryCode: "GH", serviceAreas: ["East Legon"], specialities: [], _count: { listings: 2, developments: 0 } };

function mockDirectory(items: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items, total: items.length }) }) as Response));
}
const requested = () => vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input), "http://localhost"));

const { MarketplaceDirectory } = await import("@/components/marketplace-directory");

afterEach(() => { cleanup(); vi.unstubAllGlobals(); search = ""; });

describe("public professional directory", () => {
  it("always requests verified professionals only and has no opt-out control", async () => {
    mockDirectory([verified]);
    render(<MarketplaceDirectory />);
    expect(await screen.findByText("Accra Homes")).toBeTruthy();
    expect(screen.queryByLabelText(/verified only/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Accra" } });
    await waitFor(() => expect(requested().some((url) => url.searchParams.get("query") === "Accra")).toBe(true));
    for (const url of requested()) expect(url.searchParams.get("verifiedOnly")).toBe("true");
  });

  it("keeps the ?type= deep link and stays verified-only", async () => {
    search = "type=DEVELOPER";
    mockDirectory([]);
    render(<MarketplaceDirectory />);
    await waitFor(() => expect(requested().length).toBeGreaterThan(0));
    expect(requested()[0].searchParams.get("type")).toBe("DEVELOPER");
    expect(requested()[0].searchParams.get("verifiedOnly")).toBe("true");
    expect(await screen.findByText("No verified professionals match this search")).toBeTruthy();
  });

  it("explains the verification rule when nobody is verified yet", async () => {
    mockDirectory([]);
    render(<MarketplaceDirectory />);
    expect(await screen.findByText("Verified professionals will appear here")).toBeTruthy();
  });
});
