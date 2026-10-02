// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MarketplaceSearch, type PublicProvider } from "@/components/marketplace-search";
import { MarketplaceProviderProfile } from "@/components/marketplace-provider-profile";

/**
 * Web public Service Provider Marketplace parity with the native app: the same server-derived
 * trust signals on cards and the profile, Save / Unsave against the account's saved list (loaded
 * once per page), and Request Service through the existing enquiry and sign-in flows.
 */

const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams.value, usePathname: () => "/marketplace/services", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/platform/analytics", () => ({ trackEvent: vi.fn(), categorical: (value: unknown) => value, compactParams: (value: unknown) => value }));

const KWAME = "5c9e0a11-0000-4000-8000-000000000001";
const AMA = "5c9e0a11-0000-4000-8000-000000000002";
const PRO = "5c9e0a11-0000-4000-8000-000000000003";

function provider(overrides: Partial<PublicProvider> = {}): PublicProvider {
  return {
    id: KWAME, slug: "kwame-plumbing", displayName: "Kwame Plumbing Services", type: "COMPANY", description: "Leak repairs and bathroom installs.",
    availability: "AVAILABLE", verification: "VERIFIED", acceptingWork: true,
    verificationBadges: { identity: true, business: true, skill: false },
    logo: { url: "/api/public/media/public/providers/kwame.png" },
    categories: [{ id: "c1", key: "plumbing", name: "Plumbing" }],
    serviceAreas: [{ countryCode: "GH", region: "Greater Accra", city: "Accra", district: "East Legon", label: null }, { countryCode: "GH", region: "Greater Accra", city: "Tema", district: null, label: null }],
    contact: { email: null, phone: null }, pricing: { startingRateMinor: "25000", currencyCode: "GHS" }, responseTimeHours: 4,
    aggregateRating: 4.8, ratingCount: 84, completedJobs: 127, completionRate: 0.96, completionRateBasis: 132,
    ranking: { score: 90, signals: {} },
    ...overrides,
  };
}

const kwame = provider();
const ama = provider({
  id: AMA, slug: "ama-cleaning", displayName: "Ama Cleaning", type: "INDIVIDUAL", description: null, verificationBadges: { identity: false, business: false, skill: false },
  logo: null, categories: [{ id: "c3", key: "cleaning", name: "Cleaning Services" }], serviceAreas: [], pricing: { startingRateMinor: null, currencyCode: null }, responseTimeHours: null,
  aggregateRating: null, ratingCount: 0, completedJobs: 0, completionRate: null, completionRateBasis: 0, availability: "LIMITED",
});
const pro = provider({ id: PRO, slug: "pro-electric", displayName: "Pro Electric", verificationBadges: { identity: false, business: false, skill: true }, logo: null, completionRate: null, completionRateBasis: 3, completedJobs: 3 });

type Call = { method: string; url: string; body?: unknown; headers?: Record<string, string> };
type Server = {
  signedIn?: boolean;
  saved?: string[];
  saveStatus?: number;
  hold?: Promise<void>;
  providers?: PublicProvider[];
  profileStatus?: number;
  enquiry?: () => { status: number; body: unknown };
};

function mockServer(server: Server = {}) {
  const calls: Call[] = [];
  const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => structuredClone(body) }) as Response;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers as Record<string, string> | undefined });
    const path = url.split("?")[0];
    if (path === "/api/public/marketplace/categories") return reply(200, [{ id: "c1", key: "plumbing", name: "Plumbing" }]);
    if (path === "/api/public/marketplace/providers") {
      const items = server.providers ?? [kwame, ama, pro];
      return reply(200, { items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1 }, meta: { ranking: { strategy: "x", privateSignalsUsed: false } } });
    }
    if (path.startsWith("/api/public/marketplace/services/") || path.startsWith("/api/public/marketplace/providers/")) {
      if (server.profileStatus) return reply(server.profileStatus, { error: { code: "NOT_FOUND", message: "The requested resource was not found." } });
      const key = path.split("/").pop();
      const found = [kwame, ama, pro].find((item) => item.slug === key || item.id === key);
      return found ? reply(200, { provider: found }) : reply(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    }
    if (path === "/api/marketplace/saved-providers") {
      return server.signedIn ? reply(200, { items: (server.saved ?? []).map((providerId) => ({ providerId, savedAt: "2026-09-27T10:00:00Z", available: true, provider: null })) }) : reply(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
    }
    if (path.startsWith("/api/marketplace/saved-providers/")) {
      if (server.hold) await server.hold;
      if (server.saveStatus) return reply(server.saveStatus, { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
      const id = path.split("/").pop()!;
      server.saved = (server.saved ?? []).filter((item) => item !== id);
      if (method === "POST") server.saved.push(id);
      return reply(200, { providerId: id, saved: method === "POST" });
    }
    if (path === "/api/marketplace/enquiries") return reply(...(() => { const answer = server.enquiry?.() ?? { status: 201, body: { id: "e1" } }; return [answer.status, answer.body] as const; })());
    if (path === "/api/dashboard") return reply(200, { properties: [{ id: "p1", name: "Ocean View", referenceNumber: "OV" }] });
    if (path === "/api/maintenance/requests") return reply(200, []);
    return reply(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  }));
  return calls;
}

const card = async (id: string) => within(await screen.findByTestId(`provider-card-${id}`));
const savedLists = (calls: Call[]) => calls.filter((call) => call.url === "/api/marketplace/saved-providers");
const assign = vi.fn();

beforeEach(() => {
  searchParams.value = new URLSearchParams();
  localStorage.clear();
  assign.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, pathname: "/marketplace/services", search: "?category=plumbing", assign } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("provider cards", () => {
  it("show the logo, and initials when there is none or it fails to load", async () => {
    mockServer();
    render(<MarketplaceSearch />);
    const withLogo = await card(KWAME);
    const logo = withLogo.getByRole("img", { name: "Logo for Kwame Plumbing Services" });
    expect(logo.getAttribute("src")).toBe(kwame.logo!.url);
    expect(logo.className).toContain("object-contain");
    fireEvent.error(logo);
    expect(withLogo.queryByRole("img")).toBeNull();
    expect(withLogo.getByText("KP")).toBeTruthy();
    const noLogo = await card(AMA);
    expect(noLogo.queryByRole("img")).toBeNull();
    expect(noLogo.getByText("AC")).toBeTruthy();
  });

  it("show each verification badge only when the server says it is true", async () => {
    mockServer();
    render(<MarketplaceSearch />);
    const k = await card(KWAME);
    expect(k.getByText("Verified Identity")).toBeTruthy();
    expect(k.getByText("Verified Business")).toBeTruthy();
    expect(k.queryByText("Verified Professional")).toBeNull();
    const p = await card(PRO);
    expect(p.getByText("Verified Professional")).toBeTruthy();
    expect(p.queryByText("Verified Identity")).toBeNull();
    expect(p.queryByText("Verified Business")).toBeNull();
    expect((await card(AMA)).queryByRole("list", { name: "Verified by NesAfric" })).toBeNull();
    expect(screen.queryByText(/trusted provider|recommended|best provider/i)).toBeNull();
  });

  it("show the server's rating, completed jobs and completion rate — and nothing invented without them", async () => {
    mockServer();
    render(<MarketplaceSearch />);
    const k = await card(KWAME);
    expect(k.getByLabelText("Rated 4.8 out of 5 from 84 ratings").textContent).toBe("★4.8(84)");
    expect(k.getByText("127 jobs completed")).toBeTruthy();
    expect(k.getByText("96% completion rate")).toBeTruthy();
    expect(k.getByText("Available for work")).toBeTruthy();
    const a = await card(AMA);
    expect(a.getByText("No ratings yet")).toBeTruthy();
    expect(a.getByText("New on NesAfric")).toBeTruthy();
    expect(a.queryByText(/%|5\.0|\(0\)/)).toBeNull();
    expect(a.getByText("Limited availability")).toBeTruthy();
    // Below the minimum history the server sends null: omitted, never 0%.
    const p = await card(PRO);
    expect(p.getByText("3 jobs completed")).toBeTruthy();
    expect(p.queryByText(/completion rate/)).toBeNull();
  });

  it("label the starting rate as the provider's, and offer a quote when there is none", async () => {
    mockServer();
    render(<MarketplaceSearch />);
    const k = await card(KWAME);
    expect(k.getByText(/From GH₵250/)).toBeTruthy();
    expect(k.getByText("Provider’s starting rate")).toBeTruthy();
    expect((await card(AMA)).getByText("Request a quote")).toBeTruthy();
  });

  it("link to the profile and its Request Service section", async () => {
    mockServer();
    render(<MarketplaceSearch />);
    const k = await card(KWAME);
    expect(k.getByRole("link", { name: "View profile" }).getAttribute("href")).toBe("/marketplace/services/kwame-plumbing");
    expect(k.getByRole("link", { name: "Request service" }).getAttribute("href")).toBe("/marketplace/services/kwame-plumbing#request-service");
    expect(k.getByRole("link", { name: "Kwame Plumbing Services" }).getAttribute("href")).toBe("/marketplace/services/kwame-plumbing");
  });
});

describe("search", () => {
  it("sends free text and filters to the server and drops the meaningless verification filter", async () => {
    const calls = mockServer();
    render(<MarketplaceSearch />);
    await card(KWAME);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "Accra electrician" } });
    fireEvent.change(screen.getByLabelText("Provider type"), { target: { value: "COMPANY" } });
    fireEvent.submit(screen.getByRole("form", { name: "Search service providers" }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("q=Accra+electrician"))).toBe(true));
    const last = calls.filter((call) => call.url.startsWith("/api/public/marketplace/providers?")).at(-1)!;
    expect(last.url).toBe("/api/public/marketplace/providers?q=Accra+electrician&providerType=COMPANY");
    expect(screen.queryByLabelText("Verification")).toBeNull();
  });

  it("opens with q from the URL", async () => {
    searchParams.value = new URLSearchParams({ q: "plumber" });
    const calls = mockServer();
    render(<MarketplaceSearch />);
    await card(KWAME);
    expect(calls.some((call) => call.url === "/api/public/marketplace/providers?q=plumber")).toBe(true);
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("plumber");
  });
});

describe("saving providers", () => {
  it("loads saved state once for the whole page — not once per card", async () => {
    const calls = mockServer({ signedIn: true, saved: [AMA] });
    render(<MarketplaceSearch />);
    await card(PRO);
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove Ama Cleaning from saved providers" })).toBeTruthy());
    expect(savedLists(calls)).toHaveLength(1);
    expect(calls.filter((call) => call.url.startsWith("/api/marketplace/saved-providers/"))).toEqual([]);
    expect(screen.getByRole("button", { name: "Save Kwame Plumbing Services" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("saves and unsaves, confirming only after the server accepts", async () => {
    let release!: () => void;
    const server: Server = { signedIn: true, saved: [], hold: new Promise((resolve) => { release = resolve; }) };
    const calls = mockServer(server);
    render(<MarketplaceSearch />);
    await card(KWAME);
    const save = await screen.findByRole("button", { name: "Save Kwame Plumbing Services" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(save);
    // Waiting on the server: busy, not yet saved.
    await waitFor(() => expect(save.getAttribute("aria-busy")).toBe("true"));
    expect(save.getAttribute("aria-pressed")).toBe("false");
    await act(async () => release());
    const saved = await screen.findByRole("button", { name: "Remove Kwame Plumbing Services from saved providers" });
    expect(saved.getAttribute("aria-pressed")).toBe("true");
    expect(server.saved).toEqual([KWAME]);
    fireEvent.click(saved);
    expect(await screen.findByRole("button", { name: "Save Kwame Plumbing Services" })).toBeTruthy();
    expect(calls.filter((call) => call.url === `/api/marketplace/saved-providers/${KWAME}`).map((call) => call.method)).toEqual(["POST", "DELETE"]);
    expect(server.saved).toEqual([]);
  });

  it("never shows a refused save as saved", async () => {
    mockServer({ signedIn: true, saved: [], saveStatus: 500 });
    render(<MarketplaceSearch />);
    await card(KWAME);
    const save = await screen.findByRole("button", { name: "Save Kwame Plumbing Services" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(save);
    expect((await screen.findByRole("alert")).textContent).toBe("An unexpected error occurred.");
    expect(screen.getByRole("button", { name: "Save Kwame Plumbing Services" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("sends a signed-out visitor through the existing sign-in, back to this page", async () => {
    const calls = mockServer({ signedIn: false });
    render(<MarketplaceSearch />);
    await card(KWAME);
    const save = await screen.findByRole("button", { name: "Save Kwame Plumbing Services" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(save);
    expect(assign).toHaveBeenCalledWith(`/login?returnTo=${encodeURIComponent("/marketplace/services?category=plumbing")}`);
    expect(calls.some((call) => call.method !== "GET")).toBe(false);
  });
});

describe("public provider profile", () => {
  it("shows the same trust figures as the card, and separates the provider's own statements", async () => {
    mockServer({ signedIn: true });
    render(<MarketplaceProviderProfile slug="kwame-plumbing" />);
    expect(await screen.findByRole("heading", { name: "Kwame Plumbing Services" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Logo for Kwame Plumbing Services" })).toBeTruthy();
    expect(within(screen.getByTestId("stat-rating")).getByText(/4\.8/)).toBeTruthy();
    expect(within(screen.getByTestId("stat-rating")).getByText("(84 ratings)")).toBeTruthy();
    expect(within(screen.getByTestId("stat-jobs")).getByText("127")).toBeTruthy();
    expect(within(screen.getByTestId("stat-completion")).getByText("96%")).toBeTruthy();
    expect(screen.getByText("Verified Identity")).toBeTruthy();
    expect(screen.getByText("Available for work")).toBeTruthy();
    const stated = within(screen.getByRole("region", { name: "From the provider" }));
    expect(stated.getByText("From GH₵250")).toBeTruthy();
    expect(stated.getByText("Within 4 hours")).toBeTruthy();
    expect(stated.getByText(/Set by the provider, not verified by NesAfric/)).toBeTruthy();
    expect(screen.getByText("East Legon, Accra, Greater Accra")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Save Kwame Plumbing Services" })).toBeTruthy();
  });

  it("says 'Not enough completed history' rather than 0% when the server has no rate", async () => {
    mockServer();
    render(<MarketplaceProviderProfile slug="pro-electric" />);
    await screen.findByRole("heading", { name: "Pro Electric" });
    const completion = within(screen.getByTestId("stat-completion"));
    expect(completion.getByText("Not enough completed history")).toBeTruthy();
    expect(completion.queryByText(/%/)).toBeNull();
  });

  it("sends a signed-out visitor to sign in to request service", async () => {
    mockServer({ signedIn: false });
    render(<MarketplaceProviderProfile slug="kwame-plumbing" />);
    const link = await screen.findByRole("link", { name: "Sign in to request Kwame Plumbing Services" });
    expect(link.getAttribute("href")).toBe(`/login?returnTo=${encodeURIComponent("/marketplace/services?category=plumbing")}`);
    expect(screen.queryByRole("button", { name: "Send request" })).toBeNull();
  });

  it("sends a request through the existing enquiry and confirms only after the server accepts", async () => {
    localStorage.setItem("propertyos.activeOrganisationId", "org-1");
    const calls = mockServer({ signedIn: true });
    render(<MarketplaceProviderProfile slug="kwame-plumbing" />);
    const send = await screen.findByRole("button", { name: "Send request" });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Leaking kitchen pipe." } });
    fireEvent.click(send);
    expect((await screen.findByRole("status")).textContent).toBe("Enquiry sent.");
    const enquiry = calls.find((call) => call.url === "/api/marketplace/enquiries")!;
    expect(enquiry.headers?.["x-organisation-id"]).toBe("org-1");
    expect(enquiry.body).toMatchObject({ providerId: KWAME, categoryId: "c1", message: "Leaking kitchen pipe." });
  });

  it("shows the server's refusal instead of success", async () => {
    localStorage.setItem("propertyos.activeOrganisationId", "org-1");
    mockServer({ signedIn: true, enquiry: () => ({ status: 403, body: { error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } } }) });
    render(<MarketplaceProviderProfile slug="kwame-plumbing" />);
    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "Leaking kitchen pipe." } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect((await screen.findByRole("alert")).textContent).toBe("You do not have permission to perform this action.");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reveals nothing about a provider the server won't publish (unlisted, suspended, unverified or archived)", async () => {
    mockServer({ profileStatus: 404 });
    render(<MarketplaceProviderProfile slug="kwame-plumbing" />);
    expect(await screen.findByRole("heading", { name: "Provider not available" })).toBeTruthy();
    expect(screen.queryByText("Kwame Plumbing Services")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
