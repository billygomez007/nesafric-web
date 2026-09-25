/// <reference types="node" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { renderRouter } from "expo-router/testing-library";
import path from "path";

import { clearSession, setActiveToken } from "@/auth/token-store";
import { listing } from "@/test-utils/fixtures";

const APP_DIR = path.join(__dirname, "../app");
const SESSION_KEY = "nesafric.session.v1";
const TOKEN = "tok_A1b2C3d4E5f6G7h8I9j0KlMnOpQrStUv";
const ORG = { id: "0b8f6a52-5b0c-4a1e-9c1c-000000000001", name: "Golden Coast Properties" };
const OTHER_ORG = "0b8f6a52-5b0c-4a1e-9c1c-0000000000ff";
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const house = listing();

type Call = { url: URL; init: RequestInit };
let calls: Call[];

function json(status: number, body?: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}

type Overrides = Partial<Record<"signIn" | "logout" | "profile" | "workspaces" | "dashboard", () => Promise<Response>>>;

function mockApi(overrides: Overrides = {}) {
  calls = [];
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    switch (url.pathname) {
      case "/api/public/listings":
        return json(200, { items: [house], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
      case "/api/auth/mobile/session":
        return overrides.signIn?.() ?? json(200, { token: TOKEN, tokenType: "Bearer", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: { id: "u1", email: "ama@example.com", displayName: "Ama Mensah" } });
      case "/api/auth/logout":
        return overrides.logout?.() ?? json(204);
      case "/api/account/profile":
        return overrides.profile?.() ?? json(200, { id: "u1", displayName: "Ama Mensah", email: "ama@example.com", emailVerified: false, createdAt: "2026-09-01T00:00:00.000Z" });
      case "/api/workspaces":
        return overrides.workspaces?.() ?? json(200, { propertyOsOrganisations: [ORG], marketplaceProfessionals: [] });
      case "/api/dashboard":
        return overrides.dashboard?.() ?? json(200, { organisation: { ...ORG, logoUrl: null }, properties: [{ id: "p1", name: "Ocean View Apartments", referenceNumber: "OVA-1", category: "Residential", status: "ACTIVE" }], units: 12, members: 3 });
      default:
        return json(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    }
  }) as jest.Mock;
}

const header = (call: Call, name: string) => (call.init.headers as Record<string, string> | undefined)?.[name];
const callsTo = (pathname: string) => calls.filter((call) => call.url.pathname === pathname);

function storeSession(expiresAt = new Date(Date.now() + 86_400_000).toISOString()) {
  secureStore.set(SESSION_KEY, JSON.stringify({ token: TOKEN, expiresAt, user: { id: "u1", email: "ama@example.com", displayName: "Ama Mensah" } }));
}

async function signInThroughUi() {
  renderRouter(APP_DIR, { initialUrl: "/sign-in" });
  fireEvent.changeText(await screen.findByLabelText("Email"), "ama@example.com");
  fireEvent.changeText(screen.getByLabelText("Password"), "correct-horse-battery-1");
  await act(async () => fireEvent.press(screen.getByTestId("sign-in-submit")));
}

beforeEach(async () => {
  secureStore.clear();
  await AsyncStorage.clear();
  await clearSession();
  setActiveToken(null);
  jest.clearAllMocks();
});

describe("optional account access", () => {
  it("keeps the marketplace and Account usable as a guest, with no credentials sent", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByText("Sign in to NesAfric")).toBeTruthy();
    expect(screen.getByText(/work without an account/)).toBeTruthy();

    renderRouter(APP_DIR, { initialUrl: "/" });
    expect((await screen.findAllByText("GH₵8,500/month")).length).toBeGreaterThan(0);
    expect(calls.every((call) => !header(call, "authorization"))).toBe(true);
  });

  it("signs in, keeps the token only in secure storage, and uses it only for account calls", async () => {
    mockApi();
    await signInThroughUi();

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(SESSION_KEY, expect.stringContaining(TOKEN), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    const asyncEntries = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
    expect(asyncEntries.some(([, value]) => value?.includes(TOKEN))).toBe(false);
    expect(JSON.parse(String(callsTo("/api/auth/mobile/session")[0].init.body))).toEqual({ email: "ama@example.com", password: "correct-horse-battery-1" });

    renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByLabelText("Signed in as Ama Mensah")).toBeTruthy();
    expect(await screen.findByText(ORG.name)).toBeTruthy();
    expect(screen.getByText("Personal")).toBeTruthy();
    for (const call of [...callsTo("/api/account/profile"), ...callsTo("/api/workspaces")]) {
      expect(header(call, "authorization")).toBe(`Bearer ${TOKEN}`);
      expect(header(call, "x-organisation-id")).toBeUndefined();
    }

    renderRouter(APP_DIR, { initialUrl: "/" });
    expect((await screen.findAllByText("GH₵8,500/month")).length).toBeGreaterThan(0);
    expect(callsTo("/api/public/listings").every((call) => !header(call, "authorization"))).toBe(true);
  });

  it("shows readable sign-in errors and stores nothing on failure", async () => {
    mockApi({ signIn: () => json(401, { error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } }) });
    await signInThroughUi();
    expect(await screen.findByText(/don’t match/)).toBeTruthy();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();

    mockApi({ signIn: () => json(429, { error: { code: "LOGIN_RATE_LIMITED", message: "Too many failed login attempts. Try again in a few minutes." } }) });
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-submit")));
    expect(await screen.findByText("Too many failed login attempts. Try again in a few minutes.")).toBeTruthy();

    mockApi({ signIn: () => Promise.reject(new TypeError("Network request failed")) });
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-submit")));
    expect(await screen.findByText(/Can’t reach NesAfric/)).toBeTruthy();
    expect(secureStore.size).toBe(0);
  });

  it("restores a stored session on launch and discards an expired one", async () => {
    mockApi();
    storeSession();
    renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByLabelText("Signed in as Ama Mensah")).toBeTruthy();

    secureStore.clear();
    setActiveToken(null);
    storeSession(new Date(Date.now() - 1000).toISOString());
    renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByText("Sign in to NesAfric")).toBeTruthy();
    expect(secureStore.has(SESSION_KEY)).toBe(false);
  });

  it("signs out cleanly when the server rejects the session, while browsing keeps working", async () => {
    mockApi({ workspaces: () => json(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }) });
    storeSession();
    renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByText(/signed out because your session ended/)).toBeTruthy();
    expect(screen.getByText("Sign in to NesAfric")).toBeTruthy();
    await waitFor(() => expect(secureStore.has(SESSION_KEY)).toBe(false));

    renderRouter(APP_DIR, { initialUrl: "/" });
    expect((await screen.findAllByText("GH₵8,500/month")).length).toBeGreaterThan(0);
  });

  it("revokes the session on sign-out, even offline, and keeps saved properties", async () => {
    await AsyncStorage.setItem("nesafric.saved-listings.v1", JSON.stringify([{ listing: house, savedAt: "2026-09-25T00:00:00.000Z" }]));
    mockApi();
    storeSession();
    renderRouter(APP_DIR, { initialUrl: "/account" });
    const signOutButton = await screen.findByTestId("sign-out", {}, { timeout: 5000 });
    await act(async () => fireEvent.press(signOutButton));
    expect(await screen.findByText("Sign in to NesAfric")).toBeTruthy();
    expect(header(callsTo("/api/auth/logout")[0], "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(secureStore.has(SESSION_KEY)).toBe(false);

    // Offline: the server can't be told, but the device still forgets the session.
    storeSession();
    mockApi({ logout: () => Promise.reject(new TypeError("Network request failed")) });
    renderRouter(APP_DIR, { initialUrl: "/account" });
    const offlineSignOut = await screen.findByTestId("sign-out", {}, { timeout: 5000 });
    await act(async () => fireEvent.press(offlineSignOut));
    expect(await screen.findByText("Sign in to NesAfric")).toBeTruthy();
    expect(secureStore.has(SESSION_KEY)).toBe(false);

    renderRouter(APP_DIR, { initialUrl: "/saved" });
    expect(await screen.findByText(house.title)).toBeTruthy();
  });

  it("opens only listed workspaces and scopes the dashboard to that organisation", async () => {
    mockApi();
    storeSession();
    await AsyncStorage.setItem("nesafric.last-workspace.v1:u1", OTHER_ORG); // stale, not in the server list
    renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId(`workspace-${ORG.id}`));
    expect(await screen.findByText("Ocean View Apartments")).toBeTruthy();
    expect(screen.getByLabelText("Units: 12")).toBeTruthy();
    const dashboardCalls = callsTo("/api/dashboard");
    expect(dashboardCalls.map((call) => header(call, "x-organisation-id"))).toEqual([ORG.id]);
    expect(header(dashboardCalls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(await AsyncStorage.getItem("nesafric.last-workspace.v1:u1")).toBe(ORG.id);

    // An organisation the user isn't a member of is refused without ever sending its id.
    calls = [];
    renderRouter(APP_DIR, { initialUrl: `/workspace/${OTHER_ORG}` });
    expect(await screen.findByText("Workspace not available")).toBeTruthy();
    expect(calls.some((call) => header(call, "x-organisation-id") === OTHER_ORG)).toBe(false);
  });

  it("explains when the server denies property access in a workspace", async () => {
    mockApi({ dashboard: () => json(403, { error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } }) });
    storeSession();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG.id}` });
    expect(await screen.findByText("Your role here doesn’t include property access")).toBeTruthy();
  });
});
