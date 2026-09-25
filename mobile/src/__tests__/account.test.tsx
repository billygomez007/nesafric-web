/// <reference types="node" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import path from "path";

import { SIGNED_OUT_FLAG, setActiveToken } from "@/auth/token-store";
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

/** A response the test releases by hand, to hold a request "on the wire". */
function deferred() {
  let resolve!: (response: Response) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, respond: (status: number, body?: unknown) => resolve({ ok: status < 300, status, json: async () => body } as Response), fail: () => reject(new TypeError("Network request failed")) };
}

const offline = () => Promise.reject(new TypeError("Network request failed"));

/** Simulates closing and reopening the app: module memory is gone, storage remains. */
function restartApp(initialUrl = "/account") {
  setActiveToken(null);
  renderRouter(APP_DIR, { initialUrl });
}

async function asyncStorageHoldsToken() {
  const entries = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
  return entries.some(([, value]) => value?.includes(TOKEN));
}

async function tapSignOut() {
  const button = await screen.findByTestId("sign-out", {}, { timeout: 5000 });
  await act(async () => fireEvent.press(button));
}

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

  it("signs out on this device at once and reports server revocation only once the server confirms it", async () => {
    await AsyncStorage.setItem("nesafric.saved-listings.v1", JSON.stringify([{ listing: house, savedAt: "2026-09-25T00:00:00.000Z" }]));
    const logout = deferred();
    mockApi({ logout: () => logout.promise });
    storeSession();
    renderRouter(APP_DIR, { initialUrl: "/account" });
    await tapSignOut();

    // The server hasn't answered yet, but the device is already signed out.
    expect(await screen.findByText("Sign in to NesAfric")).toBeTruthy();
    expect(screen.getByTestId("notice-server-pending")).toBeTruthy();
    expect(screen.queryByTestId("notice-server-ended")).toBeNull();
    expect(secureStore.has(SESSION_KEY)).toBe(false);
    expect(await AsyncStorage.getItem(SIGNED_OUT_FLAG)).toBeNull();
    expect(header(callsTo("/api/auth/logout")[0], "authorization")).toBe(`Bearer ${TOKEN}`);

    // Nothing can use the old token any more, even while the logout request is in flight.
    const before = calls.length;
    act(() => router.push(`/workspace/${ORG.id}`));
    expect(await screen.findByText("Sign in to see this workspace")).toBeTruthy();
    expect(calls.slice(before).some((call) => header(call, "authorization"))).toBe(false);

    act(() => router.back());
    await act(async () => logout.respond(204));
    expect(await screen.findByTestId("notice-server-ended")).toBeTruthy();

    renderRouter(APP_DIR, { initialUrl: "/saved" });
    expect(await screen.findByText(house.title)).toBeTruthy();
  });

  it("offline, signs out on this device only and says the server session is still valid", async () => {
    mockApi({ logout: offline });
    storeSession("2026-10-09T10:00:00.000Z");
    renderRouter(APP_DIR, { initialUrl: "/account" });
    await tapSignOut();

    expect(await screen.findByTestId("notice-server-not-confirmed")).toBeTruthy();
    expect(screen.getByText(/couldn’t reach NesAfric to end the session there\. It stays valid on our servers until 9 October 2026/)).toBeTruthy();
    expect(screen.queryByTestId("notice-server-ended")).toBeNull();
    expect(screen.getByText("Sign in to NesAfric")).toBeTruthy();
    expect(secureStore.has(SESSION_KEY)).toBe(false);
    expect(await asyncStorageHoldsToken()).toBe(false);

    // Back online: Try again revokes the same token on the server.
    mockApi();
    await act(async () => fireEvent.press(screen.getByTestId("retry-sign-out")));
    expect(await screen.findByTestId("notice-server-ended")).toBeTruthy();
    expect(header(callsTo("/api/auth/logout")[0], "authorization")).toBe(`Bearer ${TOKEN}`);

    // Restarting doesn't bring the session back.
    restartApp();
    expect(await screen.findByText("Sign in to NesAfric")).toBeTruthy();
    expect(callsTo("/api/account/profile")).toHaveLength(0);
  });

  it("never restores a credential whose deletion from secure storage failed", async () => {
    mockApi();
    storeSession();
    const deleteItem = SecureStore.deleteItemAsync as jest.Mock;
    const setItem = SecureStore.setItemAsync as jest.Mock;
    deleteItem.mockRejectedValueOnce(new Error("Keychain unavailable"));
    setItem.mockRejectedValueOnce(new Error("Keychain unavailable")); // the overwrite fails too
    renderRouter(APP_DIR, { initialUrl: "/account" });
    await tapSignOut();

    // The credential really is still in secure storage, and the app says so.
    expect(await screen.findByTestId("notice-device-pending")).toBeTruthy();
    expect(screen.getByText("Sign in to NesAfric")).toBeTruthy();
    expect(secureStore.get(SESSION_KEY)).toContain(TOKEN);
    expect(await AsyncStorage.getItem(SIGNED_OUT_FLAG)).toBe("1");
    expect(await asyncStorageHoldsToken()).toBe(false);

    // Next launch: not restored, deletion retried, flag cleared once it succeeds.
    deleteItem.mockClear();
    const before = calls.length;
    restartApp();
    expect(await screen.findByText("Sign in to NesAfric")).toBeTruthy();
    await waitFor(() => expect(secureStore.has(SESSION_KEY)).toBe(false));
    expect(deleteItem).toHaveBeenCalledWith(SESSION_KEY, expect.anything());
    await waitFor(async () => expect(await AsyncStorage.getItem(SIGNED_OUT_FLAG)).toBeNull());
    expect(calls.slice(before).some((call) => header(call, "authorization"))).toBe(false);
  });

  it("warns when nothing could be written on sign-out, and Try again finishes the job", async () => {
    mockApi();
    storeSession();
    (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValueOnce(new Error("Keychain unavailable"));
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error("Keychain unavailable"));
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk full")); // the signed-out flag
    renderRouter(APP_DIR, { initialUrl: "/account" });
    await tapSignOut();

    expect(await screen.findByTestId("notice-device-failed")).toBeTruthy();
    expect(screen.getByText("Sign in to NesAfric")).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByTestId("retry-sign-out")));
    await waitFor(() => expect(screen.queryByTestId("notice-device-failed")).toBeNull());
    expect(secureStore.has(SESSION_KEY)).toBe(false);
    restartApp();
    expect(await screen.findByText("Sign in to NesAfric")).toBeTruthy();
  });

  it("ignores account responses that arrive after sign-out", async () => {
    const workspaces = deferred();
    mockApi({ workspaces: () => workspaces.promise });
    storeSession();
    renderRouter(APP_DIR, { initialUrl: "/account" });
    await tapSignOut();
    expect(await screen.findByText("Sign in to NesAfric")).toBeTruthy();

    // A request sent before sign-out comes back 401: that's not a "session ended" surprise.
    await act(async () => workspaces.respond(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }));
    expect(screen.queryByTestId("notice-expired")).toBeNull();
    expect(await screen.findByTestId("notice-server-ended")).toBeTruthy();
    expect(screen.queryByText(ORG.name)).toBeNull();
  });

  it("does not let a slow revocation of the old session sign out a new one", async () => {
    const logout = deferred();
    mockApi({ logout: () => logout.promise });
    storeSession();
    renderRouter(APP_DIR, { initialUrl: "/account" });
    await tapSignOut();
    expect(await screen.findByText("Sign in to NesAfric")).toBeTruthy();

    const NEW_TOKEN = "tok_NEWsession_ZyXwVuTsRqPoNmLkJi";
    mockApi({
      logout: () => logout.promise,
      signIn: () => json(200, { token: NEW_TOKEN, tokenType: "Bearer", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: { id: "u1", email: "ama@example.com", displayName: "Ama Mensah" } }),
    });
    await signInThroughUi();
    await act(async () => logout.respond(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }));

    renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByLabelText("Signed in as Ama Mensah")).toBeTruthy();
    expect(screen.queryByTestId("notice-expired")).toBeNull();
    expect(secureStore.get(SESSION_KEY)).toContain(NEW_TOKEN);
    expect(header(callsTo("/api/workspaces").at(-1)!, "authorization")).toBe(`Bearer ${NEW_TOKEN}`);
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
