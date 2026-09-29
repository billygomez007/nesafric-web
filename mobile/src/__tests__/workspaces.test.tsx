/// <reference types="node" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import * as WebBrowser from "expo-web-browser";
import path from "path";

import type { Workspaces } from "@/api/account";
import { setActiveToken } from "@/auth/token-store";
import { setWorkspaceIntent } from "@/workspace/intent";
import { resetWorkspaceNavigator } from "@/workspace/navigator";
import { OTP_CHALLENGE, signInWithEmailCode } from "@/test-utils/otp";
import { listing } from "@/test-utils/fixtures";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));

const APP_DIR = path.join(__dirname, "../app");
const TOKEN = "tok_A1b2C3d4E5f6G7h8I9j0KlMnOpQrStUv";
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const house = listing();

const ORG = { id: "0b8f6a52-5b0c-4a1e-9c1c-000000000001", name: "Golden Coast Properties" };
const FOREIGN_ORG = "0b8f6a52-5b0c-4a1e-9c1c-0000000000ff";
const PRO = { id: "7a1f0c2e-0000-4000-8000-000000000001", displayName: "Xcel Realty", type: "BROKERAGE", status: "ACTIVE", verificationStatus: "VERIFIED", slug: "xcel-realty", myRole: "AGENT" };
const FOREIGN_PRO = "7a1f0c2e-0000-4000-8000-0000000000ff";
const PROVIDER = { id: "5c9e0a11-0000-4000-8000-000000000001", displayName: "Kofi Plumbing", type: "INDIVIDUAL", slug: "kofi-plumbing", verificationStatus: "UNVERIFIED", availabilityStatus: "AVAILABLE", suspended: false };
const FOREIGN_PROVIDER = "5c9e0a11-0000-4000-8000-0000000000ff";

const NONE: Workspaces = { propertyOsOrganisations: [], marketplaceProfessionals: [], serviceProviders: [] };
const PM_ONLY: Workspaces = { ...NONE, propertyOsOrganisations: [ORG] };
const PRO_ONLY: Workspaces = { ...NONE, marketplaceProfessionals: [PRO] };
const PROVIDER_ONLY: Workspaces = { ...NONE, serviceProviders: [PROVIDER] };
const ALL: Workspaces = { propertyOsOrganisations: [ORG], marketplaceProfessionals: [PRO], serviceProviders: [PROVIDER] };

type Call = { url: URL; init: RequestInit };
let calls: Call[];

function json(status: number, body?: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}
const forbidden = () => json(403, { error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } });

type Server = { workspaces?: Workspaces; deny?: string[]; user?: { id: string; name: string; email: string } };

/**
 * The server: `/api/workspaces` answers `server.workspaces` for the signed-in user; organisation
 * routes answer only for an organisation in that list (else 403), professional and provider
 * routes only for a listed id — like the real membership / ownership checks. `deny` lists
 * pathnames refused with 403 (the role lacks the permission).
 */
function mockServer(server: Server = {}) {
  calls = [];
  const spaces = () => server.workspaces ?? NONE;
  const user = server.user ?? { id: "u1", name: "Ama Mensah", email: "ama@example.com" };
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const org = (init.headers as Record<string, string> | undefined)?.["x-organisation-id"];
    const authed = Boolean((init.headers as Record<string, string> | undefined)?.authorization);
    if (server.deny?.includes(url.pathname)) return forbidden();
    const orgAllowed = () => authed && spaces().propertyOsOrganisations.some((item) => item.id === org);
    const pro = url.pathname.match(/^\/api\/marketplace-professionals\/([^/]+)\/(dashboard|listings|leads|viewings)$/);
    const provider = url.pathname.match(/^\/api\/providers\/([^/]+)(\/jobs|\/metrics)?$/);
    if (pro) {
      if (!authed || !spaces().marketplaceProfessionals.some((item) => item.id === pro[1])) return forbidden();
      if (pro[2] === "dashboard") {
        return json(200, { listings: { active: 4, draft: 1, pendingReview: 2, paused: 0, total: 7 }, newLeads: 3, upcomingViewings: 2, teamMembers: 5, developments: 0, profileCompletenessPercent: 80, verificationStatus: "VERIFIED", plan: null });
      }
      if (pro[2] === "listings") {
        return json(200, {
          items: [
            { id: house.id, title: "4 Bedroom House", status: "PUBLISHED", verificationStatus: "VERIFIED", listingType: "RENT", askingAmountMinor: null, rentAmountMinor: "850000", currencyCode: "GHS", frequency: "MONTHLY", verificationEvidence: [{ secret: "x" }] },
            { id: "d1", title: "Draft Townhouse", status: "DRAFT", verificationStatus: "UNVERIFIED", listingType: "SALE", askingAmountMinor: "150000000", rentAmountMinor: null, currencyCode: "GHS", frequency: null },
          ],
          total: 2,
          page: 1,
          pageSize: 50,
        });
      }
      return json(200, { items: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } });
    }
    if (provider) {
      if (!authed || !(spaces().serviceProviders ?? []).some((item) => item.id === provider[1])) return forbidden();
      if (provider[2] === "/jobs") {
        return json(200, [{ id: "job-1", status: "PENDING", assignedAt: "2026-09-20T10:00:00.000Z", quotation: null, workOrder: { title: "Fix leaking kitchen tap", status: "ASSIGNED", property: { id: "p1", name: "Ocean View Apartments" }, maintenanceRequest: { id: "m1" } } }]);
      }
      if (provider[2] === "/metrics") return json(200, { assignments: 6, accepted: 4, declined: 1, completed: 3, acceptanceRate: 0.8, onTimeRate: 1, ratings: 2, averageRating: 4.5 });
      return json(200, { provider: { displayName: PROVIDER.displayName, verificationStatus: "UNVERIFIED", availabilityStatus: "AVAILABLE", acceptingWork: true, contactEmail: "kofi@example.com" }, directory: null, metrics: {} });
    }
    switch (url.pathname) {
      case "/api/public/listings":
        return json(200, { items: [house], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
      case "/api/auth/otp/request":
        return json(200, OTP_CHALLENGE);
      case "/api/auth/mobile/otp/verify":
        return json(200, { token: TOKEN, tokenType: "Bearer", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: { id: user.id, email: user.email, displayName: user.name } });
      case "/api/auth/logout":
        return json(204);
      case "/api/account/profile":
        return json(200, { id: user.id, displayName: user.name, email: user.email, emailVerified: true, createdAt: "2026-09-01T00:00:00.000Z" });
      case "/api/account/tenancies":
        return json(200, { tenancies: [] });
      case "/api/workspaces":
        return authed ? json(200, spaces()) : json(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
      case "/api/dashboard":
        return orgAllowed() ? json(200, { organisation: { ...ORG, logoUrl: null }, properties: [{ id: "p1", name: "Ocean View Apartments", referenceNumber: "OVA-1", category: "RESIDENTIAL", status: "ACTIVE" }], units: 12, members: 3 }) : forbidden();
      case "/api/properties":
        return orgAllowed() ? json(200, [{ id: "p1", name: "Ocean View Apartments", referenceNumber: "OVA-1", category: "RESIDENTIAL", status: "ACTIVE", city: "Accra", geocodeStatus: "OK", portfolio: null, _count: { units: 12 } }]) : forbidden();
      case "/api/tenants":
        return orgAllowed()
          ? json(200, [{ id: "t1", createdAt: "2026-08-01T00:00:00.000Z", email: "kwame@example.com", phone: "+233201112222", notes: "internal", tenant: { legalName: "Kwame Boateng", preferredName: null } }])
          : forbidden();
      case "/api/maintenance/requests":
        return orgAllowed() ? json(200, [{ id: "m1", title: "Broken window", priority: "HIGH", status: "SUBMITTED", createdAt: "2026-09-10T00:00:00.000Z", property: { id: "p1", name: "Ocean View Apartments" }, unit: { id: "u1", name: "A2" }, tenantOrganisation: { tenant: { legalName: "Kwame Boateng" } } }]) : forbidden();
      case "/api/maintenance/dashboard":
        return orgAllowed() ? json(200, { total: 5, open: 2, byStatus: {}, openByPriority: { HIGH: 1, LOW: 1 }, estimateAmountMinor: "0", actualCostAmountMinor: "0" }) : forbidden();
      case "/api/marketplace-leads":
      case "/api/viewing-requests":
        return orgAllowed() ? json(200, { items: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } }) : forbidden();
      default:
        return json(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    }
  }) as jest.Mock;
}

const header = (call: Call, name: string) => (call.init.headers as Record<string, string> | undefined)?.[name];
const callsTo = (pathname: string) => calls.filter((call) => call.url.pathname === pathname);
const workspaceCalls = () => calls.filter((call) => /^\/api\/(dashboard|properties|tenants|maintenance|marketplace-professionals|providers|marketplace-leads|viewing-requests)/.test(call.url.pathname));

function signedIn(userId = "u1") {
  secureStore.set("nesafric.session.v1", JSON.stringify({ token: TOKEN, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: { id: userId, email: "ama@example.com", displayName: "Ama Mensah" } }));
}

async function signInThroughUi() {
  await signInWithEmailCode();
}

beforeEach(async () => {
  secureStore.clear();
  await AsyncStorage.clear();
  setActiveToken(null);
  setWorkspaceIntent(null);
  resetWorkspaceNavigator();
  jest.clearAllMocks();
});

describe("signed out: marketplace first, with a gateway for people who manage", () => {
  it("shows the property-seeker card and the three Manage on NesAfric cards, without any account calls", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/account" });

    expect(await screen.findByText("Looking for property?")).toBeTruthy();
    expect(screen.getByText("MANAGE ON NESAFRIC")).toBeTruthy();
    for (const [intent, title] of [["property_management", "Landlord & Property Manager"], ["professional", "Real Estate Professional"], ["service_provider", "Service Provider"]]) {
      const card = screen.getByTestId(`gateway-${intent}`);
      expect(card).toHaveProp("accessibilityRole", "button");
      expect(card).toHaveProp("accessibilityLabel", title);
      expect(card.props.accessibilityHint).toMatch(/Opens sign in\./);
    }
    expect(screen.getByText("Sign in to save properties, manage enquiries and keep track of viewings.")).toBeTruthy();
    expect(screen.getByTestId("open-sign-in")).toHaveProp("accessibilityLabel", "Sign in");
    expect(screen.getByTestId("open-create-account")).toHaveProp("accessibilityLabel", "Create account");
    expect(screen.getByText("Manage properties, units, tenants, leases, rent and maintenance.")).toBeTruthy();
    expect(screen.getByText("For agents, agencies, developers and property companies. Manage listings, leads, enquiries and your marketplace presence.")).toBeTruthy();
    expect(screen.getByText("Manage services, jobs, requests, customers and your business profile.")).toBeTruthy();
    expect(calls.some((call) => /^\/api\/(workspaces|account|dashboard)/.test(call.url.pathname))).toBe(false);
    expect(calls.every((call) => !header(call, "authorization"))).toBe(true);
  });

  it("never blocks the marketplace with a role screen: signed out, the app opens on Home", async () => {
    mockServer({ workspaces: ALL });
    await AsyncStorage.setItem("nesafric.last-workspace.v2:u1", JSON.stringify({ kind: "property_management", id: ORG.id }));
    const app = renderRouter(APP_DIR, { initialUrl: "/" });
    expect((await screen.findAllByText("4 Bedroom House")).length).toBeGreaterThan(0);
    expect(app.getPathname()).toBe("/");
    expect(screen.queryByText("MANAGE ON NESAFRIC")).toBeNull();
    expect(workspaceCalls()).toHaveLength(0);
  });

  it("a gateway card opens sign-in with that intent, and the Sign in button without one", async () => {
    mockServer();
    const app = renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId("gateway-service_provider"));
    await waitFor(() => expect(app.getPathname()).toBe("/sign-in"));
    expect(await screen.findByTestId("sign-in-title")).toHaveTextContent("Continue as Service Provider");
    // Creating an account is native now (phone or email code), not a website hand-off.
    fireEvent.press(screen.getByTestId("sign-in-mode-register"));
    expect(await screen.findByTestId("sign-in-title")).toHaveTextContent("Create your NesAfric account");
    expect(screen.getByTestId("sign-up-name")).toBeTruthy();
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();

    act(() => router.back());
    fireEvent.press(await screen.findByTestId("open-sign-in"));
    await waitFor(() => expect(app.getPathname()).toBe("/sign-in"));
    expect(await screen.findByTestId("sign-in-title")).toHaveTextContent("Sign in to NesAfric");

    act(() => router.back());
    fireEvent.press(await screen.findByTestId("open-create-account"));
    expect(await screen.findByTestId("sign-in-title")).toHaveTextContent("Create your NesAfric account");
    expect(screen.getByTestId("sign-in-mode-login")).toHaveProp("accessibilityLabel", "Sign in");
  });
});

describe("customer (no workspaces)", () => {
  it("offers Marketplace only, all three onboarding offers, and a switcher with Marketplace alone", async () => {
    mockServer({ workspaces: NONE });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: "/account" });

    expect(await screen.findByTestId("workspace-marketplace")).toBeTruthy();
    expect(screen.getByText(/You’re not a member of a landlord/)).toBeTruthy();
    for (const kind of ["property_management", "professional", "service_provider"]) expect(screen.getByTestId(`offer-${kind}`)).toBeTruthy();
    expect(screen.queryByTestId("continue-workspace")).toBeNull();

    await act(async () => fireEvent.press(screen.getByTestId("offer-professional")));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://api.test/pro/new");
    // Back from the website: the workspace list is asked for again.
    await waitFor(() => expect(callsTo("/api/workspaces").length).toBeGreaterThanOrEqual(2));
    await act(async () => fireEvent.press(screen.getByTestId("offer-property_management")));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith("https://api.test/onboarding?start=manage");

    fireEvent.press(screen.getByTestId("open-switcher"));
    expect(await screen.findByTestId("switch-marketplace")).toHaveTextContent(/Switch to Marketplace/);
    expect(screen.queryByTestId(/^switch-property_management/)).toBeNull();
  });
});

describe("property manager", () => {
  it("opens the workspace with Dashboard, Properties, Tenants, Maintenance and More, all scoped to the organisation", async () => {
    mockServer({ workspaces: PM_ONLY });
    signedIn();
    const app = renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(screen.queryByTestId("offer-property_management")).toBeNull();
    fireEvent.press(await screen.findByTestId(`workspace-${ORG.id}`));

    await waitFor(() => expect(app.getPathname()).toBe(`/workspace/${ORG.id}`));
    expect(await screen.findByLabelText("Units: 12")).toBeTruthy();
    expect(await screen.findByLabelText("Open requests: 2")).toBeTruthy();
    for (const tab of ["Dashboard", "Properties", "Tenants", "Maintenance", "More"]) expect(screen.getAllByText(tab).length).toBeGreaterThan(0);

    fireEvent.press(screen.getByTestId("tab-properties"));
    expect(await screen.findByTestId("property-p1")).toHaveTextContent(/Ocean View Apartments/);
    fireEvent.press(screen.getByTestId("tab-tenants"));
    const tenant = await screen.findByTestId("tenant-t1");
    expect(tenant).toHaveTextContent(/Kwame Boateng/);
    // Contact details returned by the server are not shown.
    expect(screen.queryByText(/kwame@example.com|\+233201112222|internal/)).toBeNull();
    fireEvent.press(screen.getByTestId("tab-maintenance"));
    expect(await screen.findByTestId("maintenance-m1")).toHaveTextContent(/Broken window/);

    const scoped = workspaceCalls();
    expect(scoped.length).toBeGreaterThan(0);
    for (const call of scoped) {
      expect(header(call, "x-organisation-id")).toBe(ORG.id);
      expect(header(call, "authorization")).toBe(`Bearer ${TOKEN}`);
    }
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem("nesafric.last-workspace.v2:u1")) ?? "null")).toEqual({ kind: "property_management", id: ORG.id }));
  });

  it("explains a tab the role can't read, and keeps the rest working", async () => {
    mockServer({ workspaces: PM_ONLY, deny: ["/api/tenants"] });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG.id}/tenants` });
    expect(await screen.findByText("Your role here doesn’t include tenants")).toBeTruthy();
    fireEvent.press(screen.getByTestId("tab-properties"));
    expect(await screen.findByTestId("property-p1")).toBeTruthy();
  });

  it("keeps the existing inbox route, and More switches back to Marketplace", async () => {
    mockServer({ workspaces: PM_ONLY });
    signedIn();
    const app = renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG.id}/inbox` });
    expect(await screen.findByText(/Your role here doesn’t include enquiries or viewings|No enquiries yet/)).toBeTruthy();

    act(() => router.replace(`/workspace/${ORG.id}/more`));
    fireEvent.press(await screen.findByTestId("more-web"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://api.test/dashboard");
    fireEvent.press(screen.getByTestId("more-marketplace"));
    await waitFor(() => expect(app.getPathname()).toBe("/"));
  });

  it("offers Continue in the last workspace on the Account tab", async () => {
    mockServer({ workspaces: PM_ONLY });
    signedIn();
    await AsyncStorage.setItem("nesafric.last-workspace.v2:u1", JSON.stringify({ kind: "property_management", id: ORG.id }));
    const app = renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId("continue-workspace"));
    await waitFor(() => expect(app.getPathname()).toBe(`/workspace/${ORG.id}`));
  });
});

describe("real estate professional", () => {
  it("shows dashboard metrics, listings and leads, and hides the professional offer", async () => {
    mockServer({ workspaces: PRO_ONLY });
    signedIn();
    const app = renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByTestId(`agent-${PRO.id}`)).toBeTruthy();
    expect(screen.queryByTestId("offer-professional")).toBeNull();
    expect(screen.getByTestId("offer-service_provider")).toBeTruthy();

    fireEvent.press(screen.getByTestId(`agent-${PRO.id}`));
    await waitFor(() => expect(app.getPathname()).toBe(`/agent/${PRO.id}`));
    expect(await screen.findByLabelText("Live listings: 4")).toBeTruthy();
    expect(screen.getByLabelText("New leads: 3")).toBeTruthy();

    fireEvent.press(screen.getByTestId("tab-listings"));
    expect(await screen.findByTestId(`pro-listing-${house.id}`)).toHaveTextContent(/GH₵8,500/);
    expect(screen.getByTestId("pro-listing-d1")).toHaveTextContent(/Draft Townhouse/);
    // A published listing opens its public page.
    fireEvent.press(screen.getByTestId(`pro-listing-${house.id}`));
    await waitFor(() => expect(app.getPathname()).toBe(`/listing/${house.id}`));
    act(() => router.back());

    fireEvent.press(await screen.findByTestId("tab-leads"));
    expect(await screen.findByText(/No enquiries yet/)).toBeTruthy();
    for (const call of workspaceCalls()) expect(header(call, "x-organisation-id")).toBeUndefined();
  });
});

describe("service provider", () => {
  it("shows the profile status, metrics and jobs from the owner-only provider routes", async () => {
    mockServer({ workspaces: PROVIDER_ONLY });
    signedIn();
    const app = renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId(`provider-${PROVIDER.id}`));
    await waitFor(() => expect(app.getPathname()).toBe(`/provider/${PROVIDER.id}`));

    expect(await screen.findByLabelText("Assigned: 6")).toBeTruthy();
    expect(screen.getByLabelText("Acceptance: 80%")).toBeTruthy();
    expect(await screen.findByLabelText("Accepting work, Yes")).toBeTruthy();
    expect(screen.queryByText(/kofi@example.com/)).toBeNull();

    fireEvent.press(screen.getByTestId("tab-jobs"));
    expect(await screen.findByTestId("job-job-1")).toHaveTextContent(/Fix leaking kitchen tap/);
    for (const call of workspaceCalls()) {
      expect(call.url.pathname.startsWith(`/api/providers/${PROVIDER.id}`)).toBe(true);
      expect(header(call, "x-organisation-id")).toBeUndefined();
    }
  });

  it("after tapping the Service Provider card and signing in, opens the provider workspace", async () => {
    mockServer({ workspaces: PROVIDER_ONLY });
    const app = renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId("gateway-service_provider"));
    await signInThroughUi();

    await waitFor(() => expect(app.getPathname()).toBe(`/provider/${PROVIDER.id}`));
    expect(await screen.findByLabelText("Assigned: 6")).toBeTruthy();
  });

  it("a new provider (no provider identity) lands on Service Provider registration", async () => {
    mockServer({ workspaces: PRO_ONLY });
    const app = renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId("gateway-service_provider"));
    await signInThroughUi();

    await waitFor(() => expect(app.getPathname()).toBe("/setup/service_provider"));
    expect(await screen.findByTestId("setup-needed")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("setup-open-web")));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith("https://api.test/onboarding?start=services");
    expect(calls.some((call) => /^\/api\/providers/.test(call.url.pathname))).toBe(false);
  });
});

describe("multi-role", () => {
  it("lists every workspace, switches between them, and remembers the last one", async () => {
    mockServer({ workspaces: ALL });
    signedIn();
    const app = renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG.id}` });
    expect(await screen.findByLabelText("Units: 12")).toBeTruthy();

    fireEvent.press(screen.getByTestId("workspace-switch"));
    expect(await screen.findByTestId("switch-marketplace")).toBeTruthy();
    expect(screen.getByTestId(`switch-property_management-${ORG.id}`)).toHaveProp("accessibilityState", { selected: true });
    expect(screen.getByTestId(`switch-professional-${PRO.id}`)).toBeTruthy();
    fireEvent.press(screen.getByTestId(`switch-service_provider-${PROVIDER.id}`));

    await waitFor(() => expect(app.getPathname()).toBe(`/provider/${PROVIDER.id}`));
    expect(await screen.findByLabelText("Assigned: 6")).toBeTruthy();
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem("nesafric.last-workspace.v2:u1")) ?? "null")).toEqual({ kind: "service_provider", id: PROVIDER.id }));

    fireEvent.press(screen.getByTestId("workspace-switch"));
    fireEvent.press(await screen.findByTestId("switch-marketplace"));
    await waitFor(() => expect(app.getPathname()).toBe("/"));
    expect((await screen.findAllByText("4 Bedroom House")).length).toBeGreaterThan(0);

    act(() => router.navigate("/account"));
    expect(await screen.findByTestId(`workspace-${ORG.id}`)).toBeTruthy();
    expect(screen.getByTestId(`agent-${PRO.id}`)).toBeTruthy();
    expect(screen.getByTestId(`provider-${PROVIDER.id}`)).toBeTruthy();
    expect(screen.queryByTestId("offers")).toBeNull();
  });
});

describe("sign-in by intent", () => {
  it.each([
    ["property_management", PM_ONLY, `/workspace/${ORG.id}`, "Units: 12"],
    ["professional", PRO_ONLY, `/agent/${PRO.id}`, "Live listings: 4"],
  ] as const)("%s card + authorised account opens that dashboard", async (intent, workspaces, pathname, stat) => {
    mockServer({ workspaces });
    const app = renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId(`gateway-${intent}`));
    await signInThroughUi();
    await waitFor(() => expect(app.getPathname()).toBe(pathname));
    expect(await screen.findByLabelText(stat)).toBeTruthy();
  });

  it("professional card + account without a business lands on professional registration", async () => {
    mockServer({ workspaces: PM_ONLY });
    const app = renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId("gateway-professional"));
    await signInThroughUi();
    await waitFor(() => expect(app.getPathname()).toBe("/setup/professional"));
    await act(async () => fireEvent.press(await screen.findByTestId("setup-open-web")));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith("https://api.test/pro/new");
    expect(calls.some((call) => /^\/api\/marketplace-professionals/.test(call.url.pathname))).toBe(false);
  });

  it("a customer who signs in stays in the marketplace, even with business workspaces", async () => {
    mockServer({ workspaces: ALL });
    const app = renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId("open-sign-in"));
    await signInThroughUi();
    expect(await screen.findByLabelText("Signed in as Ama Mensah")).toBeTruthy();
    expect(app.getPathname()).toBe("/account");
    expect(workspaceCalls()).toHaveLength(0);
  });
});

describe("launch: resume the last workspace only while the server lists it", () => {
  it.each([
    ["property manager", { kind: "property_management", id: ORG.id }, `/workspace/${ORG.id}`, "Units: 12"],
    ["professional", { kind: "professional", id: PRO.id }, `/agent/${PRO.id}`, "Live listings: 4"],
    ["service provider", { kind: "service_provider", id: PROVIDER.id }, `/provider/${PROVIDER.id}`, "Assigned: 6"],
  ] as const)("a returning %s reopens their workspace", async (_who, ref, pathname, stat) => {
    mockServer({ workspaces: ALL });
    signedIn();
    await AsyncStorage.setItem("nesafric.last-workspace.v2:u1", JSON.stringify(ref));
    const app = renderRouter(APP_DIR, { initialUrl: "/" });
    await waitFor(() => expect(app.getPathname()).toBe(pathname));
    expect(await screen.findByLabelText(stat)).toBeTruthy();
    // Marketplace is still one tap away, without signing out.
    fireEvent.press(screen.getByTestId("workspace-switch"));
    fireEvent.press(await screen.findByTestId("switch-marketplace"));
    await waitFor(() => expect(app.getPathname()).toBe("/"));
  });

  it("a signed-in customer opens on the marketplace", async () => {
    mockServer({ workspaces: NONE });
    signedIn();
    const app = renderRouter(APP_DIR, { initialUrl: "/" });
    expect((await screen.findAllByText("4 Bedroom House")).length).toBeGreaterThan(0);
    await waitFor(() => expect(callsTo("/api/workspaces").length).toBeGreaterThan(0));
    expect(app.getPathname()).toBe("/");
    expect(workspaceCalls()).toHaveLength(0);
  });

  it("falls back to the marketplace when access was removed, and forgets the stale workspace", async () => {
    mockServer({ workspaces: PRO_ONLY });
    signedIn();
    await AsyncStorage.setItem("nesafric.last-workspace.v2:u1", JSON.stringify({ kind: "property_management", id: ORG.id }));
    const app = renderRouter(APP_DIR, { initialUrl: "/" });
    await waitFor(async () => expect(await AsyncStorage.getItem("nesafric.last-workspace.v2:u1")).toBeNull());
    expect(app.getPathname()).toBe("/");
    expect(calls.some((call) => header(call, "x-organisation-id") === ORG.id)).toBe(false);
  });

  it("a hand-edited last workspace (someone else's organisation) cannot open it", async () => {
    mockServer({ workspaces: PM_ONLY });
    signedIn();
    await AsyncStorage.setItem("nesafric.last-workspace.v2:u1", JSON.stringify({ kind: "property_management", id: FOREIGN_ORG }));
    const app = renderRouter(APP_DIR, { initialUrl: "/" });
    await waitFor(async () => expect(await AsyncStorage.getItem("nesafric.last-workspace.v2:u1")).toBeNull());
    expect(app.getPathname()).toBe("/");
    expect(calls.some((call) => header(call, "x-organisation-id") === FOREIGN_ORG)).toBe(false);
  });

  it("a deep link at launch is respected instead of jumping to the workspace", async () => {
    mockServer({ workspaces: ALL });
    signedIn();
    await AsyncStorage.setItem("nesafric.last-workspace.v2:u1", JSON.stringify({ kind: "property_management", id: ORG.id }));
    const app = renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByTestId(`workspace-${ORG.id}`)).toBeTruthy();
    expect(app.getPathname()).toBe("/account");
  });

  it("choosing the marketplace is remembered, so the next launch opens it", async () => {
    mockServer({ workspaces: PM_ONLY });
    signedIn();
    await AsyncStorage.setItem("nesafric.last-workspace.v2:u1", JSON.stringify({ kind: "property_management", id: ORG.id }));
    renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId("workspace-marketplace"));
    await waitFor(async () => expect(await AsyncStorage.getItem("nesafric.last-workspace.v2:u1")).toBeNull());
  });
});

describe("security", () => {
  it("an intent never grants a workspace: the offer is shown instead", async () => {
    mockServer({ workspaces: NONE });
    renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId("gateway-property_management"));
    await signInThroughUi();

    // Straight to set-up, never into a workspace, and nothing private is requested.
    expect(await screen.findByTestId("setup-needed")).toBeTruthy();
    expect(screen.getByText(/doesn’t have a property management workspace yet/)).toBeTruthy();
    expect(screen.queryByTestId("setup-ready")).toBeNull();
    expect(workspaceCalls()).toHaveLength(0);
  });

  it("ignores and removes a tampered last-workspace value", async () => {
    mockServer({ workspaces: PM_ONLY });
    signedIn();
    await AsyncStorage.setItem("nesafric.last-workspace.v2:u1", JSON.stringify({ kind: "property_management", id: FOREIGN_ORG }));
    renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByTestId(`workspace-${ORG.id}`)).toBeTruthy();
    expect(screen.queryByTestId("continue-workspace")).toBeNull();
    await waitFor(async () => expect(await AsyncStorage.getItem("nesafric.last-workspace.v2:u1")).toBeNull());
    expect(calls.some((call) => header(call, "x-organisation-id") === FOREIGN_ORG)).toBe(false);
  });

  it.each([
    ["organisation", `/workspace/${FOREIGN_ORG}`],
    ["organisation tab", `/workspace/${FOREIGN_ORG}/tenants`],
    ["professional", `/agent/${FOREIGN_PRO}/listings`],
    ["provider", `/provider/${FOREIGN_PROVIDER}/jobs`],
  ])("refuses a deep link to a foreign %s without fetching it", async (_kind, url) => {
    mockServer({ workspaces: ALL });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: url });
    expect(await screen.findByText("Workspace not available")).toBeTruthy();
    expect(workspaceCalls()).toHaveLength(0);
  });

  it("signed out, a workspace link asks to sign in and sends nothing", async () => {
    mockServer({ workspaces: ALL });
    renderRouter(APP_DIR, { initialUrl: `/provider/${PROVIDER.id}` });
    expect(await screen.findByText("Sign in to see this workspace")).toBeTruthy();
    expect(workspaceCalls()).toHaveLength(0);
    expect(calls.every((call) => !header(call, "authorization"))).toBe(true);
  });

  it("sign-out drops workspace data and the remembered workspace, so the next person sees none of it", async () => {
    mockServer({ workspaces: ALL });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG.id}/tenants` });
    expect(await screen.findByTestId("tenant-t1")).toBeTruthy();
    await waitFor(async () => expect(await AsyncStorage.getItem("nesafric.last-workspace.v2:u1")).not.toBeNull());

    act(() => router.navigate("/account"));
    await act(async () => fireEvent.press(await screen.findByTestId("sign-out")));
    expect(await screen.findByText("Looking for property?")).toBeTruthy();
    await waitFor(async () => expect((await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("nesafric.last-workspace."))).toEqual([]));

    // Someone else signs in on the same phone: no workspaces of their own, nothing of the previous user's.
    mockServer({ workspaces: NONE, user: { id: "u2", name: "Esi Owusu", email: "esi@example.com" } });
    renderRouter(APP_DIR, { initialUrl: "/sign-in" });
    await signInThroughUi();
    renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByLabelText("Signed in as Esi Owusu")).toBeTruthy();
    expect(screen.queryByText(ORG.name)).toBeNull();
    expect(screen.queryByTestId("continue-workspace")).toBeNull();
    const before = calls.length;
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG.id}/tenants` });
    expect(await screen.findByText("Workspace not available")).toBeTruthy();
    expect(screen.queryByText("Kwame Boateng")).toBeNull();
    expect(calls.slice(before).some((call) => header(call, "x-organisation-id"))).toBe(false);
  });

  it("never sends credentials to public marketplace routes", async () => {
    mockServer({ workspaces: ALL });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG.id}` });
    expect(await screen.findByLabelText("Units: 12")).toBeTruthy();
    renderRouter(APP_DIR, { initialUrl: "/search" });
    expect((await screen.findAllByText("4 Bedroom House")).length).toBeGreaterThan(0);
    expect(callsTo("/api/public/listings").every((call) => !header(call, "authorization"))).toBe(true);
  });
});
