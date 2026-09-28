/// <reference types="node" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { renderRouter } from "expo-router/testing-library";
import path from "path";

import { setActiveToken } from "@/auth/token-store";
import { OTP_CHALLENGE, OTP_REQUEST_PATH, OTP_VERIFY_PATH, signInWithEmailCode } from "@/test-utils/otp";
import { setWorkspaceIntent } from "@/workspace/intent";
import { resetWorkspaceNavigator } from "@/workspace/navigator";
import { MARKETPLACE, parseIntent } from "@/workspace/resolve";
import { registerPath, resolvePostSignInDestination } from "@/workspace/routing";

const APP_DIR = path.join(__dirname, "../app");
const TOKEN = "tok_TenantEntry_abcdefghijklmnopqrstu";
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const USER = { id: "tenant-user", email: "esi@example.com", displayName: "Esi Tenant" };
const TENANCY = {
  tenantOrganisationId: "c4f1e0a2-0000-4000-8000-000000000001",
  organisation: { id: "c4f1e0a2-0000-4000-8000-0000000000aa", name: "Golden Coast Properties" },
  leases: [
    {
      id: "lease-1",
      status: "ACTIVE",
      startDate: "2026-01-01",
      endDate: null,
      property: { id: "p1", name: "Ocean View Apartments" },
      unit: { id: "u1", name: "Flat 4B" },
    },
  ],
};

type Call = { url: URL; init: RequestInit };
let calls: Call[];

function json(status: number, body?: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}

function mockApi({ tenancies = [] as unknown[] } = {}) {
  calls = [];
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    switch (url.pathname) {
      case OTP_REQUEST_PATH:
        return json(200, OTP_CHALLENGE);
      case OTP_VERIFY_PATH:
        return json(200, { token: TOKEN, tokenType: "Bearer", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: USER });
      case "/api/account/profile":
        return json(200, { ...USER, emailVerified: true, createdAt: "2026-09-01T00:00:00.000Z" });
      case "/api/workspaces":
        return json(200, { propertyOsOrganisations: [], marketplaceProfessionals: [], serviceProviders: [] });
      case "/api/account/tenancies":
        return json(200, { tenancies });
      case "/api/public/listings":
        return json(200, { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
      default:
        return json(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    }
  }) as jest.Mock;
}

async function signInAsTenant() {
  fireEvent.press(await screen.findByTestId("gateway-tenant"));
  expect(await screen.findByText("Continue as Tenant")).toBeTruthy();
  await signInWithEmailCode("esi@example.com");
}

beforeEach(async () => {
  secureStore.clear();
  await AsyncStorage.clear();
  setActiveToken(null);
  setWorkspaceIntent(null);
  resetWorkspaceNavigator();
  jest.clearAllMocks();
});

describe("tenant entry on the signed-out Account screen", () => {
  it("shows a Tenant / Renter option alongside the existing gateway options", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByTestId("gateway-tenant")).toBeTruthy();
    expect(screen.getByText("Tenant / Renter")).toBeTruthy();
    expect(screen.getByText("Sign in to view your rented home, lease details, payments, maintenance and messages.")).toBeTruthy();
    // The other entry points are unchanged.
    expect(screen.getByTestId("open-sign-in")).toBeTruthy();
    expect(screen.getByTestId("gateway-property_management")).toBeTruthy();
    expect(screen.getByTestId("gateway-professional")).toBeTruthy();
    expect(screen.getByTestId("gateway-service_provider")).toBeTruthy();
  });

  it("opens the same sign-in screen with tenant wording, and sends nothing about the card to the server", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId("gateway-tenant"));
    expect(await screen.findByText("Continue as Tenant")).toBeTruthy();
    expect(screen.getByTestId("sign-in-send-code")).toBeTruthy();
    expect(screen.getByTestId("sign-in-google")).toBeTruthy();
    expect(calls.some((call) => call.url.search.includes("tenant") || String(call.init.body ?? "").includes("tenant"))).toBe(false);
  });

  it("after sign-in, a linked tenant sees the real tenancy the server returns", async () => {
    mockApi({ tenancies: [TENANCY] });
    renderRouter(APP_DIR, { initialUrl: "/account" });
    await signInAsTenant();
    expect(await screen.findByTestId("tenant-intent-notice")).toBeTruthy();
    expect(await screen.findByText("Your rented home is linked to this account.")).toBeTruthy();
    expect(screen.getByTestId(`home-${TENANCY.tenantOrganisationId}`)).toBeTruthy();
    expect(screen.getByText("Rented through Golden Coast Properties")).toBeTruthy();
    fireEvent.press(screen.getByTestId("tenant-intent-open"));
    await waitFor(() => expect(calls.some((call) => call.url.pathname === "/api/account/tenancies")).toBe(true));
  });

  it("after sign-in with no linked tenancy, fabricates nothing and offers the tenant access code", async () => {
    mockApi({ tenancies: [] });
    renderRouter(APP_DIR, { initialUrl: "/account" });
    await signInAsTenant();
    expect(await screen.findByText(/No rented home is linked to this account yet/)).toBeTruthy();
    expect(screen.queryByText("Your homes")).toBeNull();
    expect(screen.queryByTestId(`home-${TENANCY.tenantOrganisationId}`)).toBeNull();
    fireEvent.press(screen.getByTestId("tenant-intent-access-code"));
    expect(await screen.findByText("Connect your home")).toBeTruthy();
  });

  it("the tenant card never becomes a workspace or a set-up step", () => {
    expect(parseIntent("tenant")).toBe("tenant");
    expect(resolvePostSignInDestination("tenant", [MARKETPLACE], null)).toEqual({ type: "marketplace" });
    expect(registerPath("tenant")).toBe("/register");
  });
});
