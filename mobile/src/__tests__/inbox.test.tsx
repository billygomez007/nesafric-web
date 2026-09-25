/// <reference types="node" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import path from "path";
import { FlatList } from "react-native";

import { clearOtherWorkspaces, inboxKey } from "@/api/inbox-queries";
import { setActiveToken } from "@/auth/token-store";
import { usableEmail, usablePhone } from "@/workspace/contact";
import { listing } from "@/test-utils/fixtures";

jest.mock("expo-linking", () => ({ ...jest.requireActual("expo-linking"), openURL: jest.fn(async () => true) }));

const APP_DIR = path.join(__dirname, "../app");
const TOKEN = "tok_A1b2C3d4E5f6G7h8I9j0KlMnOpQrStUv";
const ORG_A = { id: "0b8f6a52-5b0c-4a1e-9c1c-00000000000a", name: "Golden Coast Properties" };
const ORG_B = { id: "0b8f6a52-5b0c-4a1e-9c1c-00000000000b", name: "Volta Homes" };
const UNLISTED = "0b8f6a52-5b0c-4a1e-9c1c-0000000000ff";
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const house = listing();

type Call = { url: URL; init: RequestInit };
let calls: Call[];

function respond(status: number, body?: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}

const LISTING_REF = { id: "11111111-1111-4111-8111-111111111111", title: "3-bed house, East Legon", listingType: "RENT", status: "PUBLISHED" };

function lead(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `lead-${n}`,
    name: `Prospect ${n}`,
    email: `prospect${n}@example.com`,
    phone: "+233 24 123 4567",
    message: `Is it still available? (${n})`,
    source: "PUBLIC_LISTING",
    status: "NEW",
    createdAt: "2026-09-20T10:00:00.000Z",
    lastActivityAt: "2026-09-20T10:00:00.000Z",
    listing: LISTING_REF,
    assignee: null,
    history: [{ id: `h-${n}`, fromStatus: null, toStatus: "NEW", createdAt: "2026-09-20T10:00:00.000Z" }],
    viewingRequests: [],
    rentalApplications: [],
    privateNotes: "internal note that the app must not show",
    ...overrides,
  };
}

function viewing(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `viewing-${n}`,
    status: "REQUESTED",
    requesterNote: "Weekend works best",
    outcome: null,
    confirmedStartsAt: null,
    confirmedEndsAt: null,
    createdAt: "2026-09-21T09:00:00.000Z",
    listing: LISTING_REF,
    lead: { id: `lead-${n}`, name: `Prospect ${n}`, email: `prospect${n}@example.com`, phone: "0241234567", status: "VIEWING_SCHEDULED" },
    assignee: null,
    preferredTimes: [{ id: `t-${n}`, startsAt: "2026-10-03T10:00:00.000Z", endsAt: "2026-10-03T11:00:00.000Z", timezone: "Africa/Accra" }],
    history: [],
    ...overrides,
  };
}

type Server = {
  leads: Record<string, ReturnType<typeof lead>[]>;
  viewings: Record<string, ReturnType<typeof viewing>[]>;
  deny?: { leads?: string[]; viewings?: string[]; dashboard?: string[] };
  /** Fail matching requests (by pathname + page) `times` times (default once). */
  failOnce?: { path: string; page?: number; with: "offline" | 401; times?: number }[];
};

function page<T>(items: T[], url: URL) {
  const pageNo = Number(url.searchParams.get("page") ?? 1);
  const size = Number(url.searchParams.get("pageSize") ?? 25);
  return { items: items.slice((pageNo - 1) * size, pageNo * size), pagination: { page: pageNo, pageSize: size, total: items.length, totalPages: Math.ceil(items.length / size) } };
}

const forbidden = () => respond(403, { error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } });

function mockServer(server: Server) {
  calls = [];
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const org = (init.headers as Record<string, string> | undefined)?.["x-organisation-id"] ?? "";
    const failure = server.failOnce?.findIndex((rule) => rule.path === url.pathname && (rule.page === undefined || String(rule.page) === url.searchParams.get("page")));
    if (failure !== undefined && failure >= 0) {
      const rule = server.failOnce![failure];
      rule.times = (rule.times ?? 1) - 1;
      if (rule.times <= 0) server.failOnce!.splice(failure, 1);
      return rule.with === "offline" ? Promise.reject(new TypeError("Network request failed")) : respond(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
    }
    const leadMatch = url.pathname.match(/^\/api\/marketplace-leads\/(.+)$/);
    const viewingMatch = url.pathname.match(/^\/api\/viewing-requests\/(.+)$/);
    switch (true) {
      case url.pathname === "/api/public/listings":
        return respond(200, { items: [house], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
      case url.pathname === "/api/auth/logout":
        return respond(204);
      case url.pathname === "/api/account/profile":
        return respond(200, { id: "u1", displayName: "Ama Mensah", email: "ama@example.com", emailVerified: true, createdAt: "2026-09-01T00:00:00.000Z" });
      case url.pathname === "/api/workspaces":
        return respond(200, { propertyOsOrganisations: [ORG_A, ORG_B], marketplaceProfessionals: [] });
      case url.pathname === "/api/dashboard":
        return server.deny?.dashboard?.includes(org) ? forbidden() : respond(200, { organisation: { id: org, name: "Org", logoUrl: null }, properties: [], units: 0, members: 1 });
      case url.pathname === "/api/marketplace-leads":
        return server.deny?.leads?.includes(org) ? forbidden() : respond(200, page(server.leads[org] ?? [], url));
      case url.pathname === "/api/viewing-requests":
        return server.deny?.viewings?.includes(org) ? forbidden() : respond(200, page(server.viewings[org] ?? [], url));
      case Boolean(leadMatch): {
        if (server.deny?.leads?.includes(org)) return forbidden();
        const found = (server.leads[org] ?? []).find((item) => item.id === leadMatch![1]);
        return found ? respond(200, found) : respond(404, { error: { code: "NOT_FOUND", message: "Not found" } });
      }
      case Boolean(viewingMatch): {
        if (server.deny?.viewings?.includes(org)) return forbidden();
        const found = (server.viewings[org] ?? []).find((item) => item.id === viewingMatch![1]);
        return found ? respond(200, found) : respond(404, { error: { code: "NOT_FOUND", message: "Not found" } });
      }
      default:
        return respond(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    }
  }) as jest.Mock;
}

const header = (call: Call, name: string) => (call.init.headers as Record<string, string> | undefined)?.[name];
const inboxCalls = () => calls.filter((call) => /^\/api\/(marketplace-leads|viewing-requests)/.test(call.url.pathname));

function signedIn() {
  secureStore.set("nesafric.session.v1", JSON.stringify({ token: TOKEN, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: { id: "u1", email: "ama@example.com", displayName: "Ama Mensah" } }));
}

const leads = (count: number, prefix = "") => Array.from({ length: count }, (_, index) => lead(index + 1, prefix ? { id: `${prefix}-lead-${index + 1}`, name: `${prefix} Prospect ${index + 1}` } : {}));

beforeEach(async () => {
  secureStore.clear();
  await AsyncStorage.clear();
  setActiveToken(null);
  jest.clearAllMocks();
});

describe("workspace inbox", () => {
  it("shows only the sections the server allows, with the server's totals", async () => {
    mockServer({ leads: { [ORG_A.id]: leads(3) }, viewings: {}, deny: { viewings: [ORG_A.id], dashboard: [ORG_A.id] } });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG_A.id}` });

    // Enquiries allowed (even though the property dashboard is refused); viewings refused → no row.
    expect(await screen.findByLabelText("Enquiries, 3 enquiries")).toBeTruthy();
    expect(screen.queryByTestId("inbox-open-viewings")).toBeNull();
    expect(screen.getByText("Your role here doesn’t include property access")).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByTestId("inbox-open-enquiries")));
    expect(await screen.findByTestId("enquiry-lead-1")).toBeTruthy();
    expect(screen.queryByText("Viewings")).toBeNull(); // no tab for a refused section
    expect(inboxCalls().length).toBeGreaterThan(0);
    for (const call of inboxCalls()) {
      expect(header(call, "authorization")).toBe(`Bearer ${TOKEN}`);
      expect(header(call, "x-organisation-id")).toBe(ORG_A.id);
    }
  });

  it("hides the entry when both sections are refused", async () => {
    mockServer({ leads: {}, viewings: {}, deny: { leads: [ORG_A.id], viewings: [ORG_A.id] } });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG_A.id}` });
    expect(await screen.findByText("No properties in this workspace yet.")).toBeTruthy();
    await waitFor(() => expect(inboxCalls()).toHaveLength(2));
    expect(screen.queryByTestId("inbox-entry")).toBeNull();

    // Opening the inbox directly doesn't reveal anything either.
    act(() => router.push(`/workspace/${ORG_A.id}/inbox`));
    expect(await screen.findByText("Your role here doesn’t include enquiries or viewings")).toBeTruthy();
  });

  it("pages through enquiries 20 at a time and retries a failed page", async () => {
    mockServer({ leads: { [ORG_A.id]: leads(45) }, viewings: { [ORG_A.id]: [] }, failOnce: [{ path: "/api/marketplace-leads", page: 2, with: "offline", times: 3 }] });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG_A.id}/inbox?tab=enquiries` });
    expect(await screen.findByText("Showing 20 of 45")).toBeTruthy();

    // Scrolling to the end asks for page 2; it fails even after the automatic retries.
    await act(async () => fireEvent(screen.UNSAFE_getByType(FlatList), "onEndReached"));
    expect(await screen.findByText("Couldn’t load more.", {}, { timeout: 8000 })).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("load-more-retry")));
    expect(await screen.findByText("Showing 40 of 45")).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByTestId("load-more")));
    expect(await screen.findByText("Showing 45 of 45")).toBeTruthy();
    expect(screen.getByText("That’s everything.")).toBeTruthy();

    const listPages = calls.filter((call) => call.url.pathname === "/api/marketplace-leads" && call.url.searchParams.get("pageSize") === "20");
    // Page 2: three attempts (two automatic retries), then the manual retry.
    expect(listPages.map((call) => call.url.searchParams.get("page"))).toEqual(["1", "2", "2", "2", "2", "3"]);
  }, 20_000);

  it("shows empty, offline and retry states", async () => {
    mockServer({ leads: { [ORG_A.id]: [] }, viewings: { [ORG_A.id]: [viewing(1)] }, failOnce: [{ path: "/api/viewing-requests", page: 1, with: "offline", times: 3 }] });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG_A.id}/inbox` });

    // The access check for viewings fails offline first: the whole inbox offers a retry.
    expect(await screen.findByText("You’re offline", {}, { timeout: 8000 })).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText("Try again")));
    expect(await screen.findByText(/No enquiries yet/)).toBeTruthy();

    fireEvent.press(screen.getByText("Viewings"));
    expect(await screen.findByTestId("viewing-viewing-1")).toBeTruthy();
    expect(screen.getByText(/Preferred · 3 Oct 2026, 10:00–11:00 \(Africa\/Accra\)/)).toBeTruthy();
  }, 20_000);

  it("keeps each workspace's enquiries separate when switching", async () => {
    mockServer({ leads: { [ORG_A.id]: leads(2, "Alpha"), [ORG_B.id]: leads(1, "Bravo") }, viewings: {} });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG_A.id}/inbox?tab=enquiries` });
    expect(await screen.findByText("Alpha Prospect 1")).toBeTruthy();

    calls = [];
    act(() => router.push(`/workspace/${ORG_B.id}/inbox?tab=enquiries`));
    expect(await screen.findByText("Bravo Prospect 1")).toBeTruthy();
    expect(screen.queryByText("Alpha Prospect 1")).toBeNull();
    expect(inboxCalls().every((call) => header(call, "x-organisation-id") === ORG_B.id)).toBe(true);

    // An enquiry id from workspace A is not visible through workspace B.
    act(() => router.push(`/workspace/${ORG_B.id}/enquiry/Alpha-lead-1`));
    expect(await screen.findByText("This enquiry isn’t available")).toBeTruthy();
  });

  it("never sends an unlisted organisation's id, and asks guests to sign in", async () => {
    mockServer({ leads: { [UNLISTED]: leads(1) }, viewings: {} });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${UNLISTED}/inbox` });
    expect(await screen.findByText("Workspace not available")).toBeTruthy();
    expect(calls.some((call) => header(call, "x-organisation-id") === UNLISTED)).toBe(false);

    // Guest: sign-in prompt, no credentials, and the marketplace still works.
    secureStore.clear();
    setActiveToken(null);
    mockServer({ leads: { [ORG_A.id]: leads(1) }, viewings: {} });
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG_A.id}/inbox` });
    expect(await screen.findByText("Sign in to see this workspace")).toBeTruthy();
    renderRouter(APP_DIR, { initialUrl: "/" });
    expect((await screen.findAllByText("GH₵8,500/month")).length).toBeGreaterThan(0);
    expect(inboxCalls()).toHaveLength(0);
    expect(calls.every((call) => !header(call, "authorization"))).toBe(true);
  });

  it("offers Call and Email only for usable contact details", async () => {
    mockServer({
      leads: { [ORG_A.id]: [lead(1), lead(2, { phone: "n/a", email: null }), lead(3, { phone: "call me", email: "prospect3@example.com" })] },
      viewings: {},
    });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG_A.id}/enquiry/lead-1` });
    expect(await screen.findByText("Is it still available? (1)")).toBeTruthy();
    expect(screen.queryByText(/internal note/)).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId("contact-call")));
    expect(Linking.openURL).toHaveBeenCalledWith("tel:+233241234567");
    await act(async () => fireEvent.press(screen.getByTestId("contact-email")));
    expect(Linking.openURL).toHaveBeenCalledWith("mailto:prospect1@example.com");

    (Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error("No handler"));
    await act(async () => fireEvent.press(screen.getByTestId("contact-call")));
    expect(await screen.findByText("Couldn’t open your phone app on this device.")).toBeTruthy();

    act(() => router.push(`/workspace/${ORG_A.id}/enquiry/lead-2`));
    expect(await screen.findByTestId("no-contact")).toBeTruthy();
    expect(screen.queryByTestId("contact-call")).toBeNull();

    act(() => router.push(`/workspace/${ORG_A.id}/enquiry/lead-3`));
    expect(await screen.findByTestId("contact-email")).toBeTruthy();
    expect(screen.queryByTestId("contact-call")).toBeNull();
  });

  it("drops enquiry data on sign-out and never writes it to device storage", async () => {
    mockServer({ leads: { [ORG_A.id]: [lead(1)] }, viewings: {} });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG_A.id}/enquiry/lead-1` });
    expect(await screen.findByText("Prospect 1")).toBeTruthy();

    act(() => router.push("/account"));
    const signOut = await screen.findByTestId("sign-out", {}, { timeout: 5000 });
    await act(async () => fireEvent.press(signOut));
    expect(await screen.findByText("Sign in to NesAfric")).toBeTruthy();

    const before = inboxCalls().length;
    act(() => router.push(`/workspace/${ORG_A.id}/enquiry/lead-1`));
    expect(await screen.findByText("Sign in to see this workspace")).toBeTruthy();
    expect(screen.queryByText("Prospect 1")).toBeNull();
    expect(inboxCalls()).toHaveLength(before);

    const stored = (await AsyncStorage.multiGet(await AsyncStorage.getAllKeys())).map(([, value]) => value ?? "").join(" ");
    for (const secret of ["Prospect 1", "prospect1@example.com", "123 4567", "Is it still available"]) expect(stored).not.toContain(secret);
    expect([...secureStore.values()].join(" ")).not.toContain("Prospect 1");
  });

  it("signs out with a notice if the session expires while reading the inbox", async () => {
    mockServer({ leads: { [ORG_A.id]: leads(1) }, viewings: {}, failOnce: [{ path: "/api/marketplace-leads", page: 1, with: 401 }] });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG_A.id}/inbox` });
    expect(await screen.findByText("Sign in to see this workspace")).toBeTruthy();
    expect(screen.queryByText("Prospect 1")).toBeNull();
    act(() => router.push("/account"));
    expect(await screen.findByTestId("notice-expired")).toBeTruthy();
  });

  it("shows a viewing request and links to its enquiry only when enquiries are allowed", async () => {
    mockServer({ leads: {}, viewings: { [ORG_A.id]: [viewing(1, { status: "CONFIRMED", confirmedStartsAt: "2026-10-04T14:00:00.000Z", confirmedEndsAt: "2026-10-04T15:00:00.000Z" })] }, deny: { leads: [ORG_A.id] } });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG_A.id}/viewing/viewing-1` });
    expect(await screen.findByText("Weekend works best")).toBeTruthy();
    expect(screen.getByText(/4 Oct 2026, 14:00/)).toBeTruthy();
    expect(screen.getByTestId("contact-call")).toBeTruthy();
    await waitFor(() => expect(inboxCalls().some((call) => call.url.pathname === "/api/marketplace-leads")).toBe(true));
    expect(screen.queryByTestId("open-enquiry")).toBeNull();
  });
});

describe("inbox helpers", () => {
  it("accepts only dialable phone numbers and well-formed emails", () => {
    expect(usablePhone("+233 24 123 4567")).toBe("+233241234567");
    expect(usablePhone("024-123-4567")).toBe("0241234567");
    expect(usablePhone("(024) 123 4567")).toBe("0241234567");
    for (const bad of [null, "", "12", "n/a", "call me", "+233 24 abc", "1234567890123456"]) expect(usablePhone(bad)).toBeNull();
    expect(usableEmail(" ama@example.com ")).toBe("ama@example.com");
    for (const bad of [null, "", "ama", "ama@", "ama@example", "a b@example.com"]) expect(usableEmail(bad)).toBeNull();
  });

  it("clears other workspaces' inbox data from the cache, and nothing else", () => {
    const client = new QueryClient();
    client.setQueryData([...inboxKey("u1", ORG_A.id), "enquiries", "list"], { secret: "A" });
    client.setQueryData([...inboxKey("u1", ORG_B.id), "enquiries", "list"], { secret: "B" });
    client.setQueryData(["account", "u1", "workspaces"], { kept: true });
    client.setQueryData(["search", {}], { kept: true });

    clearOtherWorkspaces(client, ORG_B.id);
    expect(client.getQueryData([...inboxKey("u1", ORG_A.id), "enquiries", "list"])).toBeUndefined();
    expect(client.getQueryData([...inboxKey("u1", ORG_B.id), "enquiries", "list"])).toEqual({ secret: "B" });
    expect(client.getQueryData(["account", "u1", "workspaces"])).toEqual({ kept: true });
    expect(client.getQueryData(["search", {}])).toEqual({ kept: true });
    client.clear();
  });
});
