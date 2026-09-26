/// <reference types="node" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import path from "path";

import { setActiveToken } from "@/auth/token-store";
import { emptyMaintenanceForm, toMaintenanceInput, validateMaintenance } from "@/tenant/maintenance";
import { listing } from "@/test-utils/fixtures";

const APP_DIR = path.join(__dirname, "../app");
const TOKEN = "tok_A1b2C3d4E5f6G7h8I9j0KlMnOpQrStUv";
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const house = listing();

const ORG_A = { id: "0b8f6a52-5b0c-4a1e-9c1c-00000000000a", name: "Golden Coast Properties" };
const ORG_B = { id: "0b8f6a52-5b0c-4a1e-9c1c-00000000000b", name: "Volta Homes" };
const HOME_A = {
  tenantOrganisationId: "5e0c1d2a-0000-4000-8000-00000000000a",
  organisation: ORG_A,
  leases: [{ id: "lease-a", status: "ACTIVE", startDate: "2026-01-01", endDate: "2026-12-31", property: { id: "prop-a", name: "Ocean View" }, unit: { id: "unit-a", name: "Flat 3" } }],
};
const HOME_B = {
  tenantOrganisationId: "5e0c1d2a-0000-4000-8000-00000000000b",
  organisation: ORG_B,
  leases: [{ id: "lease-b", status: "EXPIRING", startDate: "2025-06-01", endDate: "2026-10-31", property: { id: "prop-b", name: "Volta Court" }, unit: null }],
};
const UNLISTED = "5e0c1d2a-0000-4000-8000-0000000000ff";

function maintenance(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantOrganisationId: HOME_A.tenantOrganisationId,
    title: `Leaking tap ${id}`,
    description: "The kitchen tap drips all night",
    category: "plumbing",
    priority: "NORMAL",
    status: "REPORTED",
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
    completedAt: null,
    closedAt: null,
    property: { id: "prop-a", name: "Ocean View" },
    unit: { id: "unit-a", name: "Flat 3" },
    attachments: [],
    timeline: [{ id: `t-${id}`, fromStatus: null, toStatus: "REPORTED", createdAt: "2026-09-20T10:00:00.000Z" }],
    workOrders: [],
    ...overrides,
  };
}

type Call = { url: URL; init: RequestInit };
let calls: Call[];

function respond(status: number, body?: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}

type Server = {
  homes?: unknown[];
  requests?: Record<string, ReturnType<typeof maintenance>[]>;
  /** Reply to POST /api/maintenance/requests (default: echo a new REPORTED request). */
  create?: () => Promise<Response>;
};

function mockServer(server: Server = {}) {
  calls = [];
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const org = (init.headers as Record<string, string> | undefined)?.["x-organisation-id"] ?? "";
    const homes = (server.homes ?? [HOME_A, HOME_B]) as (typeof HOME_A)[];
    const history = url.pathname.match(/^\/api\/maintenance\/tenants\/([^/]+)\/history$/);
    if (history) {
      // The server scopes by the organisation header and the tenant link.
      const home = homes.find((item) => item.tenantOrganisationId === history[1] && item.organisation.id === org);
      return home ? respond(200, server.requests?.[history[1]] ?? []) : respond(403, { error: { code: "FORBIDDEN", message: "Forbidden" } });
    }
    const detail = url.pathname.match(/^\/api\/maintenance\/requests\/([^/]+)$/);
    if (detail) {
      const home = homes.find((item) => item.organisation.id === org);
      const found = home && (server.requests?.[home.tenantOrganisationId] ?? []).find((item) => item.id === detail[1]);
      return found ? respond(200, found) : respond(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    }
    switch (url.pathname) {
      case "/api/public/listings":
        return respond(200, { items: [house], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
      case "/api/account/profile":
        return respond(200, { id: "u1", displayName: "Ama Mensah", email: "ama@example.com", emailVerified: true, createdAt: "2026-09-01T00:00:00.000Z" });
      case "/api/workspaces":
        return respond(200, { propertyOsOrganisations: [], marketplaceProfessionals: [] });
      case "/api/account/tenancies":
        return respond(200, { tenancies: homes });
      case "/api/auth/logout":
        return respond(204);
      case "/api/maintenance/requests": {
        if (server.create) return server.create();
        const body = JSON.parse(String(init.body));
        return respond(201, maintenance("new-1", { title: body.title, category: body.category, priority: body.priority }));
      }
      default:
        return respond(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    }
  }) as jest.Mock;
}

const header = (call: Call, name: string) => (call.init.headers as Record<string, string> | undefined)?.[name];
const maintenanceCalls = () => calls.filter((call) => call.url.pathname.startsWith("/api/maintenance/"));
const posts = () => calls.filter((call) => call.url.pathname === "/api/maintenance/requests" && call.init.method === "POST");

function signedIn() {
  secureStore.set("nesafric.session.v1", JSON.stringify({ token: TOKEN, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: { id: "u1", email: "ama@example.com", displayName: "Ama Mensah" } }));
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function fillForm() {
  fireEvent.press(screen.getByText("Plumbing"));
  fireEvent.changeText(screen.getByTestId("maintenance-title"), "Kitchen tap leaking");
  fireEvent.changeText(screen.getByTestId("maintenance-description"), "Water drips under the sink");
}

beforeEach(async () => {
  secureStore.clear();
  await AsyncStorage.clear();
  setActiveToken(null);
  jest.clearAllMocks();
});

describe("tenant homes and maintenance", () => {
  it("lists the user's homes on Account and opens one, scoped to that home's organisation", async () => {
    mockServer({ requests: { [HOME_A.tenantOrganisationId]: [maintenance("r1"), maintenance("r2", { status: "CLOSED", title: "Fixed window" })] } });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: "/account" });

    expect(await screen.findByText("Your homes")).toBeTruthy();
    expect(screen.getByLabelText("Ocean View · Flat 3, Rented through Golden Coast Properties")).toBeTruthy();
    expect(screen.getByLabelText("Volta Court, Rented through Volta Homes")).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByTestId(`home-${HOME_A.tenantOrganisationId}`)));
    expect(await screen.findByText("Leaking tap r1")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Finished")).toBeTruthy();
    expect(screen.getByText("Fixed window")).toBeTruthy();
    for (const call of maintenanceCalls()) {
      expect(header(call, "authorization")).toBe(`Bearer ${TOKEN}`);
      expect(header(call, "x-organisation-id")).toBe(ORG_A.id);
    }

    await act(async () => fireEvent.press(screen.getByTestId("maintenance-r1")));
    expect(await screen.findByText("What you reported")).toBeTruthy();
    expect(screen.getByTestId("request-status")).toHaveTextContent("Reported");
    expect(screen.getByTestId("timeline-REPORTED")).toBeTruthy();
  });

  it("hides Your homes when the user rents nothing, and makes no tenant calls as a guest", async () => {
    mockServer({ homes: [] });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByText("Your workspaces")).toBeTruthy();
    await waitFor(() => expect(calls.some((call) => call.url.pathname === "/api/account/tenancies")).toBe(true));
    expect(screen.queryByText("Your homes")).toBeNull();
  });

  it("makes no tenant calls as a guest", async () => {
    mockServer();
    renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByText("Sign in to NesAfric")).toBeTruthy();
    expect(calls.some((call) => call.url.pathname === "/api/account/tenancies" || call.url.pathname.startsWith("/api/maintenance/"))).toBe(false);
  });

  it("refuses a home that isn't in the server's list without calling maintenance routes", async () => {
    mockServer();
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/home/${UNLISTED}` });
    expect(await screen.findByText("This home isn’t available")).toBeTruthy();
    expect(maintenanceCalls()).toHaveLength(0);
  });

  it("keeps each home's requests separate when switching", async () => {
    mockServer({ requests: { [HOME_A.tenantOrganisationId]: [maintenance("a1", { title: "Alpha leak" })], [HOME_B.tenantOrganisationId]: [maintenance("b1", { title: "Bravo door" })] } });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/home/${HOME_A.tenantOrganisationId}` });
    expect(await screen.findByText("Alpha leak")).toBeTruthy();

    calls = [];
    act(() => router.push(`/home/${HOME_B.tenantOrganisationId}`));
    expect(await screen.findByText("Bravo door")).toBeTruthy();
    expect(screen.queryByText("Alpha leak")).toBeNull();
    expect(maintenanceCalls().every((call) => header(call, "x-organisation-id") === ORG_B.id)).toBe(true);

    // A request id from home A is not readable through home B.
    act(() => router.push(`/home/${HOME_B.tenantOrganisationId}/request/a1`));
    expect(await screen.findByText("This request isn’t available")).toBeTruthy();
  });

  it("validates the report form and sends nothing until it's complete", async () => {
    mockServer();
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/home/${HOME_A.tenantOrganisationId}/report` });
    expect(await screen.findByText("Ocean View · Flat 3")).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByTestId("submit-maintenance")));
    expect(screen.getByText("Choose what kind of problem it is.")).toBeTruthy();
    expect(screen.getByText("Give the problem a short title (at least 3 characters).")).toBeTruthy();
    expect(screen.getByText("Describe the problem (at least 3 characters).")).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });

  it("sends one report even when Send is tapped repeatedly, then shows it", async () => {
    const pending = deferred();
    mockServer({ create: () => pending.promise });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/home/${HOME_A.tenantOrganisationId}/report` });
    expect(await screen.findByText("Ocean View · Flat 3")).toBeTruthy();
    await fillForm();

    await act(async () => {
      fireEvent.press(screen.getByTestId("submit-maintenance"));
      fireEvent.press(screen.getByTestId("submit-maintenance"));
      fireEvent.press(screen.getByTestId("submit-maintenance"));
    });
    expect(posts()).toHaveLength(1);
    const post = posts()[0];
    expect(header(post, "x-organisation-id")).toBe(ORG_A.id);
    expect(JSON.parse(String(post.init.body))).toEqual({
      propertyId: "prop-a",
      unitId: "unit-a",
      tenantOrganisationId: HOME_A.tenantOrganisationId,
      title: "Kitchen tap leaking",
      description: "Water drips under the sink",
      category: "plumbing",
      priority: "NORMAL",
    });

    await act(async () => pending.resolve({ ok: true, status: 201, json: async () => maintenance("new-1", { title: "Kitchen tap leaking" }) } as Response));
    expect(await screen.findByText("Problem reported")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("view-created-request")));
    expect(await screen.findByText("What you reported")).toBeTruthy();
    expect(posts()).toHaveLength(1);
  });

  it("after an unclear failure, asks the tenant to check before sending again", async () => {
    let attempts = 0;
    mockServer({
      create: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new TypeError("Network request failed")) : respond(201, maintenance("new-2"));
      },
    });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/home/${HOME_A.tenantOrganisationId}/report` });
    expect(await screen.findByText("Ocean View · Flat 3")).toBeTruthy();
    await fillForm();

    await act(async () => fireEvent.press(screen.getByTestId("submit-maintenance")));
    expect(await screen.findByText(/couldn’t confirm that your report reached NesAfric/)).toBeTruthy();
    expect(screen.getByText("Send anyway")).toBeTruthy();
    expect(posts()).toHaveLength(1);

    await act(async () => fireEvent.press(screen.getByTestId("submit-maintenance")));
    expect(await screen.findByText("Problem reported")).toBeTruthy();
    expect(posts()).toHaveLength(2);
  });

  it("drops tenant data on sign-out", async () => {
    mockServer({ requests: { [HOME_A.tenantOrganisationId]: [maintenance("r1")] } });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/home/${HOME_A.tenantOrganisationId}` });
    expect(await screen.findByText("Leaking tap r1")).toBeTruthy();

    act(() => router.push("/account"));
    await act(async () => fireEvent.press(await screen.findByTestId("sign-out")));
    act(() => router.push(`/home/${HOME_A.tenantOrganisationId}`));
    expect(await screen.findByText("Signed out")).toBeTruthy();
    expect(screen.queryByText("Leaking tap r1")).toBeNull();
  });
});

describe("maintenance form helpers", () => {
  it("preselects a single lease and maps the form to the server's input", () => {
    const form = { ...emptyMaintenanceForm(HOME_A as never), category: "electrical", title: "  Socket sparks ", description: " Sparks when plugging in " };
    expect(validateMaintenance(form)).toEqual({});
    expect(toMaintenanceInput(HOME_A as never, form)).toEqual({
      propertyId: "prop-a",
      unitId: "unit-a",
      tenantOrganisationId: HOME_A.tenantOrganisationId,
      title: "Socket sparks",
      description: "Sparks when plugging in",
      category: "electrical",
      priority: "NORMAL",
    });
  });

  it("requires a home to be chosen when there are several", () => {
    const home = { ...HOME_A, leases: [...HOME_A.leases, { ...HOME_A.leases[0], id: "lease-2" }] };
    const form = { ...emptyMaintenanceForm(home as never), category: "other", title: "Gate", description: "Gate is stuck" };
    expect(validateMaintenance(form)).toEqual({ leaseId: "Choose which home this is for." });
  });
});
