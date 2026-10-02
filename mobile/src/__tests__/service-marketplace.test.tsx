/// <reference types="node" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { renderRouter } from "expo-router/testing-library";
import path from "path";

import type { Workspaces } from "@/api/account";
import type { PublicProvider, ServiceCategory } from "@/api/types";
import { setActiveToken } from "@/auth/token-store";
import { resetMarketplaceMode } from "@/marketplace/mode";
import { listing, provider, serviceCategories } from "@/test-utils/fixtures";
import { resetWorkspaceNavigator } from "@/workspace/navigator";
import { OTP_CHALLENGE, signInWithEmailCode } from "@/test-utils/otp";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));

const APP_DIR = path.join(__dirname, "../app");
const TOKEN = "tok_A1b2C3d4E5f6G7h8I9j0KlMnOpQrStUv";
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const house = listing();
const kwame = provider();
const fresh = provider({
  id: "5c9e0a11-0000-4000-8000-000000000002",
  slug: "ama-cleaning",
  displayName: "Ama Cleaning",
  type: "INDIVIDUAL",
  description: null,
  verificationBadges: { identity: false, business: false, skill: false },
  categories: [{ id: serviceCategories[3].id, key: "cleaning", name: "Cleaning Services" }],
  serviceAreas: [{ countryCode: "GH", region: "Ashanti", city: "Kumasi", district: null, label: null }],
  pricing: { startingRateMinor: null, currencyCode: null },
  responseTimeHours: null,
  aggregateRating: null,
  ratingCount: 0,
  completedJobs: 0,
  completionRate: null,
  completionRateBasis: 0,
  logo: null,
});
const ORG = { id: "0b8f6a52-5b0c-4a1e-9c1c-000000000001", name: "Golden Coast Properties" };
const NONE: Workspaces = { propertyOsOrganisations: [], marketplaceProfessionals: [], serviceProviders: [] };

type Call = { url: URL; init: RequestInit };
let calls: Call[];

function json(status: number, body?: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}

type Server = {
  categories?: ServiceCategory[] | "error";
  providers?: PublicProvider[] | "offline";
  workspaces?: Workspaces;
  enquiry?: () => [number, unknown];
  quote?: () => [number, unknown];
  /** Stands in for the server's text search; by default a simple name/category match. */
  search?: (q: string) => PublicProvider[] | [number, unknown];
  /** Server-side saved provider ids for the signed-in user (mutated by POST / DELETE). */
  saved?: string[];
  /** Saved rows for providers that have since left the marketplace. */
  savedUnavailable?: string[];
  saveStatus?: number;
};

function mockServer(server: Server = {}) {
  calls = [];
  const providers = server.providers ?? [kwame, fresh];
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const headers = (init.headers ?? {}) as Record<string, string>;
    const authed = Boolean(headers.authorization);
    const orgAllowed = () => authed && (server.workspaces ?? NONE).propertyOsOrganisations.some((org) => org.id === headers["x-organisation-id"]);
    if (url.pathname === "/api/public/marketplace/categories") {
      return server.categories === "error" ? json(500, { error: { code: "INTERNAL", message: "Categories are unavailable." } }) : json(200, server.categories ?? serviceCategories);
    }
    if (url.pathname === "/api/public/marketplace/providers") {
      if (providers === "offline") return Promise.reject(new TypeError("Network request failed"));
      const key = url.searchParams.get("category");
      const q = url.searchParams.get("q");
      let pool = providers;
      if (q) {
        const answer = server.search ? server.search(q) : providers.filter((item) => `${item.displayName} ${item.categories.map((c) => c.name).join(" ")}`.toLowerCase().includes(q.toLowerCase().slice(0, 5)));
        if (!Array.isArray(answer) || (answer.length === 2 && typeof answer[0] === "number")) return json(...(answer as [number, unknown]));
        pool = answer as PublicProvider[];
      }
      const items = key ? pool.filter((item) => item.categories.some((category) => category.key === key)) : pool;
      const pageSize = Number(url.searchParams.get("pageSize") ?? 20);
      return json(200, { items: items.slice(0, pageSize), pagination: { page: 1, pageSize, total: items.length, totalPages: Math.ceil(items.length / pageSize) } });
    }
    const byId = url.pathname.match(/^\/api\/public\/marketplace\/providers\/([^/]+)$/);
    const bySlug = url.pathname.match(/^\/api\/public\/marketplace\/services\/([^/]+)$/);
    if (byId || bySlug) {
      const found = providers === "offline" ? undefined : providers.find((item) => (byId ? item.id === byId[1] : item.slug === bySlug![1]));
      return found ? json(200, { provider: found }) : json(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    }
    if (url.pathname === "/api/marketplace/saved-providers") {
      if (!authed) return json(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
      const all = providers === "offline" ? [] : providers;
      return json(200, {
        items: [
          ...(server.saved ?? []).map((id) => ({ providerId: id, savedAt: "2026-09-27T10:00:00.000Z", available: true, provider: all.find((item) => item.id === id) })),
          ...(server.savedUnavailable ?? []).map((id) => ({ providerId: id, savedAt: "2026-09-20T10:00:00.000Z", available: false, provider: null })),
        ],
      });
    }
    const savedMatch = url.pathname.match(/^\/api\/marketplace\/saved-providers\/([^/]+)$/);
    if (savedMatch) {
      if (!authed) return json(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
      if (server.saveStatus && server.saveStatus >= 400) return json(server.saveStatus, { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
      server.saved = (server.saved ?? []).filter((id) => id !== savedMatch[1]);
      if (init.method === "POST") {
        server.saved.unshift(savedMatch[1]);
        return json(200, { providerId: savedMatch[1], saved: true, savedAt: "2026-09-27T11:00:00.000Z" });
      }
      server.savedUnavailable = (server.savedUnavailable ?? []).filter((id) => id !== savedMatch[1]);
      return json(200, { providerId: savedMatch[1], saved: false });
    }
    if (url.pathname === "/api/marketplace/enquiries" && init.method === "POST") {
      if (!authed) return json(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
      if (headers["x-organisation-id"] && !orgAllowed()) return json(403, { error: { code: "FORBIDDEN", message: "Forbidden" } });
      return json(...(server.enquiry?.() ?? [201, { id: "e0000000-0000-4000-8000-000000000001", status: "NEW", providerId: kwame.id, categoryId: kwame.categories[0].id }]));
    }
    if (url.pathname.endsWith("/quote-request") && init.method === "POST") {
      return json(...(server.quote?.() ?? [201, { id: "q1" }]));
    }
    switch (url.pathname) {
      case "/api/public/listings":
        return json(200, { items: [house], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
      case "/api/public/campaigns":
        return json(200, { banners: [] });
      case "/api/public/homepage-companies":
        return json(200, { items: [] });
      case "/api/auth/otp/request":
        return json(200, OTP_CHALLENGE);
      case "/api/auth/mobile/otp/verify":
        return json(200, { token: TOKEN, tokenType: "Bearer", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: { id: "u1", email: "ama@example.com", displayName: "Ama Mensah" } });
      case "/api/workspaces":
        return authed ? json(200, server.workspaces ?? NONE) : json(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
      case "/api/account/profile":
        return json(200, { id: "u1", displayName: "Ama Mensah", email: "ama@example.com", emailVerified: true, createdAt: "2026-09-01T00:00:00.000Z" });
      case "/api/account/tenancies":
        return json(200, { tenancies: [] });
      case "/api/properties":
        return orgAllowed() ? json(200, [{ id: "p1", name: "Ocean View Apartments", category: "RESIDENTIAL", status: "ACTIVE", city: "Accra", _count: { units: 12 } }]) : json(403, {});
      case "/api/maintenance/requests":
        return orgAllowed()
          ? json(200, [
            { id: "m1", title: "Burst pipe", priority: "HIGH", status: "SUBMITTED", createdAt: "2026-09-10T00:00:00.000Z", property: { name: "Ocean View Apartments" }, unit: { name: "A2" } },
            { id: "m2", title: "Old repair", priority: "LOW", status: "COMPLETED", createdAt: "2026-08-10T00:00:00.000Z", property: { name: "Ocean View Apartments" }, unit: null },
          ])
          : json(403, {});
      default:
        return json(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    }
  }) as jest.Mock;
}

const callsTo = (pathname: string) => calls.filter((call) => call.url.pathname === pathname);
const providerSearches = () => callsTo("/api/public/marketplace/providers").map((call) => call.url.searchParams);
const selected = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.selected;

function signedIn() {
  secureStore.set("nesafric.session.v1", JSON.stringify({ token: TOKEN, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: { id: "u1", email: "ama@example.com", displayName: "Ama Mensah" } }));
}

beforeEach(async () => {
  resetMarketplaceMode();
  secureStore.clear();
  await AsyncStorage.clear();
  setActiveToken(null);
  resetWorkspaceNavigator();
});

describe("marketplace selector", () => {
  it("opens on Properties by default, with Service Providers one tap away", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/" });
    expect(await screen.findByText("Find your perfect property")).toBeTruthy();
    expect(screen.getByLabelText("Service Providers")).toBeTruthy();
    expect(selected("marketplace-mode-properties")).toBe(true);
    expect(selected("marketplace-mode-services")).toBe(false);
    // Nothing from the provider marketplace is fetched until it is opened.
    expect(calls.some((call) => call.url.pathname.startsWith("/api/public/marketplace/"))).toBe(false);
  });

  it("switches to the Service Provider Marketplace and back to Properties", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/" });
    await screen.findByText("Find your perfect property");

    fireEvent.press(screen.getByTestId("marketplace-mode-services"));
    expect(await screen.findByText("Find your perfect professional")).toBeTruthy();
    expect(
      screen.queryByText(
        "Find trusted professionals and companies for every stage of your property.",
      ),
    ).toBeNull();
    expect(screen.queryByText("Choose a major service category.")).toBeNull();
    expect(screen.getByPlaceholderText("Search plumbers, electricians, cleaners…")).toBeTruthy();
    expect((await screen.findAllByText("Kwame Plumbing Services")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Find your perfect property")).toBeNull();
    expect(selected("marketplace-mode-services")).toBe(true);

    fireEvent.press(screen.getByTestId("marketplace-mode-properties"));
    expect(await screen.findByText("Find your perfect property")).toBeTruthy();
    expect((await screen.findAllByText("4 Bedroom House")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Kwame Plumbing Services")).toBeNull();
  });
});

describe("service provider marketplace home", () => {
  it("requests the service marketplace carousel placement for Ghana", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/marketplace/services" });

    await screen.findByText("Find your perfect professional");

    await waitFor(() => {
      expect(callsTo("/api/public/campaigns").length).toBeGreaterThan(0);
    });

    const request = callsTo("/api/public/campaigns")[0];
    expect(request.url.searchParams.get("placement")).toBe("SERVICE_MARKETPLACE_PRIMARY");
    expect(request.url.searchParams.get("countryCode")).toBe("GH");
  });

  it("lists services from the categories API, core services first and admin-added ones kept", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/marketplace/services" });
    expect(screen.queryByText("Property Services")).toBeNull();
    const tiles = (await screen.findAllByTestId(/^service-category-/)).map((tile) => tile.props.testID);
    expect(tiles).toEqual([
      "service-category-plumbing",
      "service-category-electrical",
      "service-category-cleaning",
      "service-category-masonry",
      "service-category-solar",
    ]);
    expect(screen.getByText("Solar installation / maintenance")).toBeTruthy();
    expect(callsTo("/api/public/marketplace/categories")).toHaveLength(1);
  });

  it("renders compact provider cards from API values without full-card actions or invented metrics", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/marketplace/services" });

    const card = within(await screen.findByTestId(`home-provider-card-${kwame.id}`));
    expect(card.getByText("Kwame Plumbing Services")).toBeTruthy();
    expect(card.getByText("Plumbing")).toBeTruthy();
    expect(card.getByText("East Legon, Accra, Greater Accra +1 area")).toBeTruthy();
    expect(card.getByText("4.8")).toBeTruthy();
    expect(card.getByText("(84 ratings)")).toBeTruthy();
    expect(card.queryByText("Request service")).toBeNull();
    expect(card.queryByText("View profile")).toBeNull();
    expect(card.queryByText("127 jobs completed")).toBeNull();
    expect(card.queryByText("96% completion rate")).toBeNull();

    const newcomer = within(
      screen.getByTestId(`home-provider-card-${fresh.id}`),
    );
    expect(newcomer.getByText("Ama Cleaning")).toBeTruthy();
    expect(newcomer.getByText("Cleaning Services")).toBeTruthy();
    expect(newcomer.getByText("Kumasi, Ashanti")).toBeTruthy();
    expect(newcomer.getByText("No ratings yet")).toBeTruthy();
    expect(newcomer.queryByText(/0\.0|0 jobs|★ 0/)).toBeNull();

    // Home discovery cards are profile links; transactional actions live on
    // the full provider profile/search/saved experiences.
    expect(screen.queryByTestId(`save-provider-${kwame.id}`)).toBeNull();
  });

  it("opens the provider list filtered by the tapped service", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/marketplace/services" });
    fireEvent.press(await screen.findByTestId("service-category-plumbing"));
    expect(await screen.findByText("1 verified provider for Plumbing")).toBeTruthy();
    expect(providerSearches().some((params) => params.get("category") === "plumbing")).toBe(true);
    expect(screen.getByText("Kwame Plumbing Services")).toBeTruthy();
    expect(screen.queryByText("Ama Cleaning")).toBeNull();
    // Search followed the marketplace choice.
    expect(selected("marketplace-mode-services")).toBe(true);
  });

  it("hands typed text to Search, where the server searches providers", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/marketplace/services" });
    await screen.findByTestId("service-category-plumbing");
    fireEvent.changeText(screen.getByLabelText("Search service providers"), "Kwame Plumbing");
    fireEvent(screen.getByLabelText("Search service providers"), "submitEditing");
    expect(await screen.findByText("1 verified provider matching “Kwame Plumbing”")).toBeTruthy();
    expect(providerSearches().some((params) => params.get("q") === "Kwame Plumbing")).toBe(true);
    // The services list is not narrowed on the device any more.
    expect(selected("marketplace-mode-services")).toBe(true);
  });

  it("says honestly when no services or providers are listed", async () => {
    mockServer({ categories: [], providers: [] });
    renderRouter(APP_DIR, { initialUrl: "/marketplace/services" });
    expect(await screen.findByText("No services listed yet")).toBeTruthy();
    expect(await screen.findByText("No service providers listed yet")).toBeTruthy();
  });

  it("shows an honest error when the API fails, and never falls back to sample providers", async () => {
    mockServer({ categories: "error", providers: "offline" });
    renderRouter(APP_DIR, { initialUrl: "/marketplace/services" });
    // Server errors are retried twice by the query client before they are shown.
    expect(await screen.findByText("Categories are unavailable.", {}, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByText("You're offline", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByTestId(/^provider-card-/)).toBeNull();
  }, 20_000);
});

describe("search follows the selected marketplace", () => {
  it("searches properties by default and providers once Service Providers is selected", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/search" });
    expect(await screen.findByPlaceholderText("Area, city or property")).toBeTruthy();
    expect(await screen.findByText("1 verified property")).toBeTruthy();
    expect(providerSearches()).toHaveLength(0);

    fireEvent.press(screen.getByTestId("marketplace-mode-services"));
    expect(await screen.findByPlaceholderText("Search plumbers, electricians, cleaners…")).toBeTruthy();
    expect(await screen.findByText("2 verified providers")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Area, city or property")).toBeNull();

    fireEvent.press(screen.getByTestId("marketplace-mode-properties"));
    expect(await screen.findByPlaceholderText("Area, city or property")).toBeTruthy();
  });

  it("sends only server-supported provider filters, with the country an area filter needs", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/search?marketplace=services" });
    await screen.findByText("2 verified providers");
    fireEvent.press(screen.getByLabelText("Provider filters"));
    fireEvent.press(await screen.findByText("Companies"));
    fireEvent.press(screen.getByText("4★"));
    fireEvent.changeText(screen.getByLabelText("City"), "Accra");
    await act(async () => fireEvent.press(screen.getByTestId("apply-provider-filters")));
    await waitFor(() => expect(providerSearches().some((params) => params.get("providerType") === "COMPANY")).toBe(true));
    const last = providerSearches().at(-1)!;
    expect(last.get("minimumRating")).toBe("4");
    expect(last.get("city")).toBe("Accra");
    expect(last.get("country")).toBe("GH");
    expect([...last.keys()].sort()).toEqual(["city", "country", "minimumRating", "page", "pageSize", "providerType"]);
    expect(screen.getByLabelText("Provider filters, 3 active")).toBeTruthy();
  });

  it("explains an empty category result and offers to clear it", async () => {
    mockServer({ providers: [kwame] });
    renderRouter(APP_DIR, { initialUrl: "/search?marketplace=services&service=electrical" });
    expect(await screen.findByText("No Electrical providers yet")).toBeTruthy();
    fireEvent.press(screen.getByText("Clear search and filters"));
    expect(await screen.findByText("Kwame Plumbing Services")).toBeTruthy();
  });
});

describe("provider profile", () => {
  it("shows the NesAfric record, verification, service areas and the provider's own figures", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: `/marketplace/services/${kwame.id}` });
    expect(await screen.findByText("NesAfric record")).toBeTruthy();
    expect(within(screen.getByTestId("stat-rating")).getByText("4.8")).toBeTruthy();
    expect(within(screen.getByTestId("stat-rating")).getByText("84 ratings")).toBeTruthy();
    expect(within(screen.getByTestId("stat-jobs")).getByText("127")).toBeTruthy();
    expect(within(screen.getByTestId("stat-jobs")).getByText("jobs completed")).toBeTruthy();
    expect(screen.getByText("Verified Identity")).toBeTruthy();
    expect(screen.getByText("Verified Business")).toBeTruthy();
    expect(screen.queryByText("Verified Professional")).toBeNull();
    expect(screen.getByText("East Legon, Accra, Greater Accra")).toBeTruthy();
    expect(screen.getByText("Tema, Greater Accra")).toBeTruthy();
    expect(screen.getByText("From the provider")).toBeTruthy();
    expect(screen.getByText("From GH₵250")).toBeTruthy();
    expect(screen.getByText("Within 4 hours")).toBeTruthy();
    expect(within(screen.getByTestId("stat-completion")).getByText("96%")).toBeTruthy();
  });

  it("does not offer service actions when a verified provider is not accepting work", async () => {
    const paused = provider({ acceptingWork: false });
    mockServer({ providers: [paused] });
    renderRouter(APP_DIR, {
      initialUrl: `/marketplace/services/${paused.id}`,
    });

    expect(await screen.findByText(paused.displayName)).toBeTruthy();
    expect(
      screen.getByText("This provider isn’t taking new work right now and may not respond."),
    ).toBeTruthy();
    expect(screen.queryByText("Request service")).toBeNull();
    expect(screen.queryByText("Get quote")).toBeNull();
  });

  it("does not offer service actions when a provider is unavailable", async () => {
    const unavailable = provider({ availability: "UNAVAILABLE" });
    mockServer({ providers: [unavailable] });
    renderRouter(APP_DIR, {
      initialUrl: `/marketplace/services/${unavailable.id}`,
    });

    expect(await screen.findByText(unavailable.displayName)).toBeTruthy();
    expect(screen.queryByText("Request service")).toBeNull();
    expect(screen.queryByText("Get quote")).toBeNull();
  });

  it("does not offer service actions before provider verification", async () => {
    const unverified = provider({
      verification: "UNVERIFIED",
      verificationBadges: {
        identity: false,
        business: false,
        skill: false,
      },
    });
    mockServer({ providers: [unverified] });
    renderRouter(APP_DIR, {
      initialUrl: `/marketplace/services/${unverified.id}`,
    });

    expect(await screen.findByText(unverified.displayName)).toBeTruthy();
    expect(
      screen.getByText(
        "Verification is required before this provider can receive service requests.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Request service")).toBeNull();
    expect(screen.queryByText("Get quote")).toBeNull();
  });

  it("opens from a compact home provider card", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/marketplace/services" });
    fireEvent.press(
      await screen.findByTestId(`home-provider-card-${kwame.id}`),
    );
    expect(await screen.findByText("NesAfric record")).toBeTruthy();
    expect(callsTo(`/api/public/marketplace/providers/${kwame.id}`)).toHaveLength(1);
  });

  it("resolves the website's slug links", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/marketplace/services/kwame-plumbing" });
    expect(await screen.findByText("NesAfric record")).toBeTruthy();
    expect(callsTo("/api/public/marketplace/services/kwame-plumbing")).toHaveLength(1);
  });

  it("says when a provider is no longer listed", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/marketplace/services/5c9e0a11-0000-4000-8000-0000000000ff" });
    expect(await screen.findByText("Provider no longer listed")).toBeTruthy();
  });

  it("keeps an unrated provider honest", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: `/marketplace/services/${fresh.id}` });
    expect(await screen.findByText("No ratings yet")).toBeTruthy();
    expect(within(screen.getByTestId("stat-jobs")).getByText("0")).toBeTruthy();
    expect(screen.queryByTestId("verification-badge")).toBeNull();
    expect(screen.queryByText("From the provider")).toBeNull();
  });
});

describe("request service", () => {
  it("asks a signed-out person to sign in, then continues the request", async () => {
    mockServer({ workspaces: { ...NONE, propertyOsOrganisations: [ORG] } });
    renderRouter(APP_DIR, { initialUrl: `/marketplace/services/${kwame.id}` });
    fireEvent.press(await screen.findByTestId("profile-request-service"));
    expect(await screen.findByText("Sign in to request Kwame Plumbing Services")).toBeTruthy();
    expect(callsTo("/api/marketplace/enquiries")).toHaveLength(0);

    fireEvent.press(screen.getByTestId("request-sign-in"));
    await signInWithEmailCode();
    expect(await screen.findByText("What do you need done?")).toBeTruthy();
    expect(screen.getByText("Kwame Plumbing Services")).toBeTruthy();
  });

  it("sends the existing marketplace enquiry for the workspace", async () => {
    signedIn();
    mockServer({ workspaces: { ...NONE, propertyOsOrganisations: [ORG] } });
    renderRouter(APP_DIR, { initialUrl: `/marketplace/services/${kwame.id}/request?categoryId=${kwame.categories[0].id}` });
    fireEvent.changeText(await screen.findByLabelText("What do you need done?"), "Kitchen sink pipe is leaking under the cabinet.");
    fireEvent.press(await screen.findByText("Golden Coast Properties"));
    fireEvent.press(await screen.findByText("Ocean View Apartments"));
    // Completed maintenance can't be linked.
    expect(screen.queryByText(/Old repair/)).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId("send-service-request")));
    expect(await screen.findByText("Request sent to Kwame Plumbing Services")).toBeTruthy();

    const [call] = callsTo("/api/marketplace/enquiries");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["x-organisation-id"]).toBe(ORG.id);
    expect(JSON.parse(String(call.init.body))).toEqual({
      providerId: kwame.id,
      categoryId: kwame.categories[0].id,
      propertyId: "p1",
      message: "Kitchen sink pipe is leaking under the cabinet.",
    });
    expect(calls.some((entry) => entry.url.pathname.endsWith("/quote-request"))).toBe(false);
  });

  it("preserves Get quote intent when the customer chooses a workspace", async () => {
    signedIn();
    const SECOND_ORG = {
      id: "0b8f6a52-5b0c-4a1e-9c1c-000000000002",
      name: "Second Property Workspace",
    };
    mockServer({
      workspaces: {
        ...NONE,
        propertyOsOrganisations: [ORG, SECOND_ORG],
      },
    });

    renderRouter(APP_DIR, {
      initialUrl: `/marketplace/services/${kwame.id}/request?quote=1`,
    });

    // With multiple workspaces, Get quote starts on the personal context.
    // The quotation control appears after the customer chooses a workspace,
    // and the original Get quote intent must still be preserved.
    // Wait for workspace loading to finish before checking the initial
    // personal context. The quotation control is intentionally hidden there.
    const workspace = await screen.findByText("Golden Coast Properties");
    expect(screen.queryByTestId("request-quote")).toBeNull();

    fireEvent.press(workspace);

    // The original Get quote intent survives workspace selection.
    expect(
      (await screen.findByTestId("request-quote")).props.accessibilityState.checked,
    ).toBe(true);
  });

  it("requests a formal quotation only with a maintenance request", async () => {
    signedIn();
    mockServer({ workspaces: { ...NONE, propertyOsOrganisations: [ORG] } });
    renderRouter(APP_DIR, { initialUrl: `/marketplace/services/${kwame.id}/request?quote=1` });
    fireEvent.changeText(await screen.findByLabelText("What do you need done?"), "Burst pipe flooding the bathroom floor.");
    await act(async () => fireEvent.press(screen.getByTestId("send-service-request")));
    expect(screen.getByText("A formal quotation needs a maintenance request.")).toBeTruthy();
    expect(callsTo("/api/marketplace/enquiries")).toHaveLength(0);

    fireEvent.press(await screen.findByText("Burst pipe · Ocean View Apartments · A2"));
    // "Get quote" arrived with the quotation already ticked.
    expect(screen.getByTestId("request-quote").props.accessibilityState.checked).toBe(true);
    await act(async () => fireEvent.press(screen.getByTestId("send-service-request")));
    expect(await screen.findByText("A formal quotation was requested for your maintenance job.")).toBeTruthy();
    expect(JSON.parse(String(callsTo("/api/marketplace/enquiries")[0].init.body))).toMatchObject({ maintenanceRequestId: "m1" });
    const quote = calls.find((entry) => entry.url.pathname.endsWith("/quote-request"))!;
    expect(quote.url.pathname).toBe("/api/marketplace/enquiries/e0000000-0000-4000-8000-000000000001/quote-request");
    expect(JSON.parse(String(quote.init.body))).toEqual({ scope: "Burst pipe flooding the bathroom floor." });
  });

  it("downgrades Get quote to a personal request when the customer has no workspace", async () => {
    signedIn();
    mockServer();

    renderRouter(APP_DIR, {
      initialUrl: `/marketplace/services/${kwame.id}/request?quote=1`,
    });

    expect(
      await screen.findByText(
        "Formal quotations require a PropertyOS workspace and maintenance request. You can still send this provider a personal service request.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("request-quote")).toBeNull();

    fireEvent.changeText(
      screen.getByLabelText("What do you need done?"),
      "I need help repairing a leaking kitchen pipe.",
    );

    await act(async () =>
      fireEvent.press(screen.getByTestId("send-service-request")),
    );

    expect(
      await screen.findByText("Request sent to Kwame Plumbing Services"),
    ).toBeTruthy();

    const [call] = callsTo("/api/marketplace/enquiries");
    expect(
      (call.init.headers as Record<string, string>)["x-organisation-id"],
    ).toBeUndefined();
    expect(
      calls.some((entry) => entry.url.pathname.endsWith("/quote-request")),
    ).toBe(false);
  });

  it("allows a signed-in marketplace customer to request a service without a property workspace", async () => {
    signedIn();
    mockServer();
    renderRouter(APP_DIR, { initialUrl: `/marketplace/services/${kwame.id}/request` });
    fireEvent.changeText(await screen.findByLabelText("What do you need done?"), "I need help repairing a leaking kitchen pipe.");
    await act(async () => fireEvent.press(screen.getByTestId("send-service-request")));
    expect(await screen.findByText("Request sent to Kwame Plumbing Services")).toBeTruthy();
    const [call] = callsTo("/api/marketplace/enquiries");
    expect((call.init.headers as Record<string, string>)["x-organisation-id"]).toBeUndefined();
    expect(JSON.parse(String(call.init.body))).toMatchObject({
      providerId: kwame.id,
      message: "I need help repairing a leaking kitchen pipe.",
    });
  });

  it("shows the server's refusal instead of claiming success", async () => {
    signedIn();
    mockServer({
      workspaces: { ...NONE, propertyOsOrganisations: [ORG] },
      enquiry: () => [409, { error: { code: "MARKETPLACE_PROVIDER_UNAVAILABLE", message: "The listed provider does not publish this category." } }],
    });
    renderRouter(APP_DIR, { initialUrl: `/marketplace/services/${kwame.id}/request` });
    fireEvent.changeText(await screen.findByLabelText("What do you need done?"), "Replace the water heater in unit A2.");
    await act(async () => fireEvent.press(screen.getByTestId("send-service-request")));
    expect(await screen.findByText("This provider no longer offers that service on the marketplace. Choose another service or provider.")).toBeTruthy();
    expect(screen.queryByTestId("request-sent")).toBeNull();
  });
});

describe("server-side provider search", () => {
  const typeQuery = (text: string) => fireEvent.changeText(screen.getByLabelText("Search service providers"), text);
  const qs = () => providerSearches().map((params) => params.get("q")).filter(Boolean);

  it("sends the typed text to the server once typing settles, not per keystroke", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/search?marketplace=services" });
    await screen.findByText("2 verified providers");
    typeQuery("p");
    typeQuery("pl");
    typeQuery("plumber");
    expect(await screen.findByText("1 verified provider matching “plumber”")).toBeTruthy();
    expect(qs()).toEqual(["plumber"]);
  });

  it("shows exactly what the server returned, without filtering on the device", async () => {
    // The server decides "plumber" matches the cleaner (e.g. by description); the app must not second-guess it.
    mockServer({ search: () => [fresh] });
    renderRouter(APP_DIR, { initialUrl: "/search?marketplace=services" });
    await screen.findByText("2 verified providers");
    typeQuery("plumber");
    expect(await screen.findByText("1 verified provider matching “plumber”")).toBeTruthy();
    expect(screen.getByText("Ama Cleaning")).toBeTruthy();
    expect(screen.queryByText("Kwame Plumbing Services")).toBeNull();
  });

  it("treats an empty or whitespace query as ordinary browsing", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/search?marketplace=services" });
    await screen.findByText("2 verified providers");
    typeQuery("   ");
    fireEvent(screen.getByLabelText("Search service providers"), "submitEditing");
    await waitFor(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(qs()).toEqual([]);
    expect(screen.getByText("2 verified providers")).toBeTruthy();
  });

  it("says when nothing matches and offers to clear the search", async () => {
    mockServer({ search: () => [] });
    renderRouter(APP_DIR, { initialUrl: "/search?marketplace=services" });
    await screen.findByText("2 verified providers");
    typeQuery("roofers");
    expect(await screen.findByText("No providers match “roofers”")).toBeTruthy();
    fireEvent.press(screen.getByText("Clear search and filters"));
    expect(await screen.findByText("2 verified providers")).toBeTruthy();
  });

  it("shows the server's error for a failed search, with a retry", async () => {
    mockServer({ search: () => [400, { error: { code: "VALIDATION_ERROR", message: "The request contains invalid input." } }] });
    renderRouter(APP_DIR, { initialUrl: "/search?marketplace=services" });
    await screen.findByText("2 verified providers");
    typeQuery("x".repeat(3));
    expect(await screen.findByText("The request contains invalid input.")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("keeps category filtering alongside the text query", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/search?marketplace=services&service=plumbing&q=kwame" });
    expect(await screen.findByText("1 verified provider for Plumbing matching “kwame”")).toBeTruthy();
    const last = providerSearches().at(-1)!;
    expect([last.get("category"), last.get("q")]).toEqual(["plumbing", "kwame"]);
  });
});

describe("server-derived reputation and logo", () => {
  it("renders the server's completion rate and never a 0% for a newcomer", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/marketplace/services" });
    const card = within(
      await screen.findByTestId(`home-provider-card-${kwame.id}`),
    );
    expect(card.queryByText(/completion rate/)).toBeNull();
    const newcomer = within(
      screen.getByTestId(`home-provider-card-${fresh.id}`),
    );
    expect(newcomer.queryByText(/completion rate/)).toBeNull();
    expect(newcomer.queryByText(/%/)).toBeNull();
  });

  it("shows completion rate with its basis on the profile only when the server sends it", async () => {
    mockServer();
    const view = renderRouter(APP_DIR, { initialUrl: `/marketplace/services/${kwame.id}` });
    expect(within(await screen.findByTestId("stat-completion")).getByText("96%")).toBeTruthy();
    expect(screen.getByText(/covers the 132 jobs this provider accepted/)).toBeTruthy();
    view.unmount();
    renderRouter(APP_DIR, { initialUrl: `/marketplace/services/${fresh.id}` });
    await screen.findByText("NesAfric record");
    expect(screen.queryByTestId("stat-completion")).toBeNull();
  });

  it("uses the provider's logo when there is one, and initials otherwise", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/marketplace/services" });
    const card = within(
      await screen.findByTestId(`home-provider-card-${kwame.id}`),
    );
    const logo = card.getByTestId("provider-logo");
    expect([logo.props.source].flat()).toEqual([
      expect.objectContaining({
        uri: "https://api.test/api/public/media/providers/kwame-logo.png",
      }),
    ]);
    expect(card.getByLabelText("Kwame Plumbing Services logo")).toBeTruthy();
    const newcomer = within(
      screen.getByTestId(`home-provider-card-${fresh.id}`),
    );
    expect(newcomer.queryByTestId("provider-logo")).toBeNull();
    expect(newcomer.getByText("AC", { includeHiddenElements: true })).toBeTruthy();
  });

  it("falls back to initials when the logo fails to load", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/marketplace/services" });
    const card = within(
      await screen.findByTestId(`home-provider-card-${kwame.id}`),
    );
    fireEvent(card.getByTestId("provider-logo"), "error", {
      nativeEvent: { error: "404" },
    });
    expect(card.queryByTestId("provider-logo")).toBeNull();
    expect(card.getByText("KP", { includeHiddenElements: true })).toBeTruthy();
  });
});

/** The heart is inactive until the account's saved list has loaded (it can't know which way to toggle). */
async function heartReady(label: string) {
  await waitFor(() => expect(screen.getByLabelText(label).props.accessibilityState).toMatchObject({ busy: false }));
}

describe("saving providers", () => {
  it("sends a signed-out person to sign in instead of saving", async () => {
    mockServer();
    renderRouter(APP_DIR, {
      initialUrl: "/search?marketplace=services",
    });
    fireEvent.press(await screen.findByTestId(`save-provider-${kwame.id}`));
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(calls.some((call) => call.url.pathname.startsWith("/api/marketplace/saved-providers/"))).toBe(false);
  });

  it("saves and unsaves on the server, filling the heart only after the server agrees", async () => {
    signedIn();
    const server: Server = { saved: [] };
    mockServer(server);
    renderRouter(APP_DIR, {
      initialUrl: "/search?marketplace=services",
    });
    await heartReady("Save Kwame Plumbing Services");
    fireEvent.press(screen.getByLabelText("Save Kwame Plumbing Services"));
    expect(await screen.findByLabelText("Remove Kwame Plumbing Services from saved")).toBeTruthy();
    const save = calls.find((call) => call.url.pathname === `/api/marketplace/saved-providers/${kwame.id}`)!;
    expect(save.init.method).toBe("POST");
    expect((save.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(server.saved).toEqual([kwame.id]);

    fireEvent.press(screen.getByLabelText("Remove Kwame Plumbing Services from saved"));
    expect(await screen.findByLabelText("Save Kwame Plumbing Services")).toBeTruthy();
    expect(calls.some((call) => call.init.method === "DELETE" && call.url.pathname === `/api/marketplace/saved-providers/${kwame.id}`)).toBe(true);
    expect(server.saved).toEqual([]);
  });

  it("never shows a refused save as saved", async () => {
    signedIn();
    mockServer({ saved: [], saveStatus: 500 });
    renderRouter(APP_DIR, {
      initialUrl: "/search?marketplace=services",
    });
    await heartReady("Save Kwame Plumbing Services");
    fireEvent.press(screen.getByLabelText("Save Kwame Plumbing Services"));
    expect(await screen.findByText("Couldn’t save. Try again.")).toBeTruthy();
    expect(screen.getByLabelText("Save Kwame Plumbing Services")).toBeTruthy();
    expect(screen.queryByLabelText("Remove Kwame Plumbing Services from saved")).toBeNull();
  });

  it("can save from the provider profile", async () => {
    signedIn();
    const server: Server = { saved: [] };
    mockServer(server);
    renderRouter(APP_DIR, { initialUrl: `/marketplace/services/${kwame.id}` });
    await screen.findByText("NesAfric record");
    await heartReady("Save Kwame Plumbing Services");
    fireEvent.press(screen.getByLabelText("Save Kwame Plumbing Services"));
    expect(await screen.findByLabelText("Remove Kwame Plumbing Services from saved")).toBeTruthy();
    expect(server.saved).toEqual([kwame.id]);
  });
});

describe("Saved tab", () => {
  it("opens on saved properties, as before", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/saved" });
    expect(await screen.findByText("Saved properties")).toBeTruthy();
    expect(selected("saved-section-properties")).toBe(true);
    expect(screen.getByTestId("saved-empty")).toBeTruthy();
    expect(callsTo("/api/marketplace/saved-providers")).toHaveLength(0);
  });

  it("asks a signed-out person to sign in for saved providers", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/saved" });
    fireEvent.press(await screen.findByTestId("saved-section-services"));
    expect(await screen.findByText("Save providers to your account")).toBeTruthy();
    fireEvent.press(screen.getByTestId("saved-providers-sign-in"));
    expect(await screen.findByLabelText("Email")).toBeTruthy();
  });

  it("lists the account's saved providers with the shared card, and unavailable ones without details", async () => {
    signedIn();
    mockServer({ saved: [kwame.id], savedUnavailable: ["5c9e0a11-0000-4000-8000-0000000000aa"] });
    renderRouter(APP_DIR, { initialUrl: "/saved" });
    fireEvent.press(await screen.findByTestId("saved-section-services"));
    expect(await screen.findByText("Saved providers")).toBeTruthy();
    const card = within(await screen.findByTestId(`provider-card-${kwame.id}`));
    expect(card.getByText("96% completion rate")).toBeTruthy();
    expect(card.getByLabelText("Remove Kwame Plumbing Services from saved")).toBeTruthy();
    expect(screen.getByText("No longer listed")).toBeTruthy();
    // Switching Saved's section does not move Home / Search.
    expect(screen.queryByTestId("marketplace-mode-services")).toBeNull();
  });

  it("opens the profile and starts Request Service from a saved provider", async () => {
    signedIn();
    mockServer({ saved: [kwame.id], workspaces: { ...NONE, propertyOsOrganisations: [ORG] } });
    renderRouter(APP_DIR, { initialUrl: "/saved" });
    fireEvent.press(await screen.findByTestId("saved-section-services"));
    const card = within(await screen.findByTestId(`provider-card-${kwame.id}`));
    fireEvent.press(card.getByText("Request service"));
    expect(await screen.findByLabelText("What do you need done?")).toBeTruthy();
  });

  it("opens a saved provider's profile", async () => {
    signedIn();
    mockServer({ saved: [kwame.id] });
    renderRouter(APP_DIR, { initialUrl: "/saved" });
    fireEvent.press(await screen.findByTestId("saved-section-services"));
    fireEvent.press(within(await screen.findByTestId(`provider-card-${kwame.id}`)).getByText("View profile"));
    expect(await screen.findByText("NesAfric record")).toBeTruthy();
  });

  it("removes a saved provider that left the marketplace", async () => {
    signedIn();
    const gone = "5c9e0a11-0000-4000-8000-0000000000aa";
    const server: Server = { saved: [], savedUnavailable: [gone] };
    mockServer(server);
    renderRouter(APP_DIR, { initialUrl: "/saved" });
    fireEvent.press(await screen.findByTestId("saved-section-services"));
    fireEvent.press(within(await screen.findByTestId(`saved-provider-unavailable-${gone}`)).getByText("Remove"));
    expect(await screen.findByText("No saved providers yet")).toBeTruthy();
    expect(server.savedUnavailable).toEqual([]);
  });
});
