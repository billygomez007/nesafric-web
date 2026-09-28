/// <reference types="node" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { createHash } from "crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { renderRouter } from "expo-router/testing-library";
import path from "path";

import { createApiClient } from "@/api/client";
import { completeGoogleRedirect, GOOGLE_REDIRECT_URL, GoogleSignInError, signInWithGoogle } from "@/auth/google";
import { setActiveToken } from "@/auth/token-store";
import { setWorkspaceIntent } from "@/workspace/intent";
import { resetWorkspaceNavigator } from "@/workspace/navigator";

jest.mock("expo-web-browser", () => ({
  WebBrowserResultType: { CANCEL: "cancel", DISMISS: "dismiss", OPENED: "opened", LOCKED: "locked" },
  openBrowserAsync: jest.fn(async () => ({ type: "opened" })),
  openAuthSessionAsync: jest.fn(),
}));

const API = "https://api.test";
const APP_DIR = path.join(__dirname, "../app");
const SESSION_KEY = "nesafric.session.v1";
const PENDING_KEY = "nesafric.google-pending.v1";
const TOKEN = "tok_GoogleMobile_abcdefghijklmnopqrs";
const HANDOFF = "handoff_code_abcdefghijklmnopqrstuvwxyz0123";
const USER = { id: "google-user", email: "kofi@example.com", displayName: "Kofi Mensah" };
const ORG = { id: "0b8f6a52-5b0c-4a1e-9c1c-000000000001", name: "Golden Coast Properties" };
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const openAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock;

type Call = { url: URL; init: RequestInit };
let calls: Call[];
let exchange: () => Promise<Response>;

function json(status: number, body?: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}

// One fixed expiry: a fresh `Date.now()` per call made equality checks flaky across a millisecond tick.
const EXPIRES_AT = new Date(Date.now() + 86_400_000).toISOString();
const session = () => ({ token: TOKEN, tokenType: "Bearer", expiresAt: EXPIRES_AT, user: USER });

function mockApi() {
  calls = [];
  exchange = () => json(200, session());
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    switch (url.pathname) {
      case "/api/auth/mobile/google/exchange":
        return exchange();
      case "/api/account/profile":
        return json(200, { ...USER, emailVerified: true, createdAt: "2026-09-01T00:00:00.000Z" });
      case "/api/workspaces":
        return json(200, { propertyOsOrganisations: [ORG], marketplaceProfessionals: [], serviceProviders: [] });
      case "/api/account/tenancies":
        return json(200, { tenancies: [] });
      case "/api/dashboard":
        return json(200, { organisation: { ...ORG, logoUrl: null }, properties: [], units: 0, members: 1 });
      case "/api/public/listings":
        return json(200, { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
      default:
        return json(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    }
  }) as jest.Mock;
}

/** Plays the part of nesafric.com + Google: answers the auth session with the app redirect. */
function googleAnswers(build: (start: URL) => WebBrowser.WebBrowserAuthSessionResult) {
  openAuthSession.mockImplementation(async (url: string, redirect: string) => {
    expect(redirect).toBe(GOOGLE_REDIRECT_URL);
    return build(new URL(url));
  });
}

const success = (params: Record<string, string>) => ({ type: "success" as const, url: `${GOOGLE_REDIRECT_URL}?${new URLSearchParams(params)}` });

const exchangeCalls = () => calls.filter((call) => call.url.pathname === "/api/auth/mobile/google/exchange");

beforeEach(async () => {
  secureStore.clear();
  await AsyncStorage.clear();
  setActiveToken(null);
  setWorkspaceIntent(null);
  resetWorkspaceNavigator();
  jest.clearAllMocks();
  mockApi();
});

describe("Google sign-in flow (auth/google)", () => {
  const api = () => createApiClient({ baseUrl: API });

  it("opens the NesAfric start route with a fresh state and an S256 challenge of the stored verifier", async () => {
    let start!: URL;
    googleAnswers((url) => {
      start = url;
      return success({ code: HANDOFF, state: url.searchParams.get("state")! });
    });
    const result = await signInWithGoogle(api(), API);
    expect(result).toEqual(session());
    expect(start.origin + start.pathname).toBe(`${API}/api/auth/mobile/google/start`);
    expect(start.searchParams.get("code_challenge_method")).toBe("S256");
    const body = JSON.parse(String(exchangeCalls()[0].init.body));
    expect(body.code).toBe(HANDOFF);
    const challenge = createHash("sha256").update(body.codeVerifier).digest("base64url");
    expect(start.searchParams.get("code_challenge")).toBe(challenge);
    // Never a session token in the browser URL, and the one-time flow is gone afterwards.
    expect(start.toString()).not.toContain(TOKEN);
    expect(secureStore.has(PENDING_KEY)).toBe(false);
  });

  it("treats a closed browser as a quiet cancellation", async () => {
    googleAnswers(() => ({ type: WebBrowser.WebBrowserResultType.CANCEL }));
    await expect(signInWithGoogle(api(), API)).rejects.toMatchObject({ reason: "cancelled" });
    expect(exchangeCalls()).toHaveLength(0);
  });

  it("reports Google's own cancellation page as cancelled", async () => {
    googleAnswers((url) => success({ error: "cancelled", state: url.searchParams.get("state")! }));
    await expect(signInWithGoogle(api(), API)).rejects.toMatchObject({ reason: "cancelled" });
    expect(exchangeCalls()).toHaveLength(0);
  });

  it("rejects a redirect whose state isn't the one this app started (injected link)", async () => {
    googleAnswers(() => success({ code: HANDOFF, state: "attacker-state-0123456789abcdef" }));
    await expect(signInWithGoogle(api(), API)).rejects.toMatchObject({ reason: "stateMismatch" });
    expect(exchangeCalls()).toHaveLength(0);
  });

  it("surfaces an expired or replayed handoff from the server", async () => {
    exchange = () => json(400, { error: { code: "INVALID_HANDOFF", message: "This Google sign-in has expired or was already used. Please try again." } });
    googleAnswers((url) => success({ code: HANDOFF, state: url.searchParams.get("state")! }));
    await expect(signInWithGoogle(api(), API)).rejects.toMatchObject({ code: "INVALID_HANDOFF" });
  });

  it("an unsolicited nesafric://auth/google link with no sign-in in progress does nothing", async () => {
    await expect(completeGoogleRedirect(api(), `${GOOGLE_REDIRECT_URL}?code=${HANDOFF}&state=whatever-state-1234567`)).resolves.toBeNull();
    expect(exchangeCalls()).toHaveLength(0);
  });

  it("redeems once when Android delivers the redirect to both the auth session and the router", async () => {
    let redirect = "";
    googleAnswers((url) => {
      redirect = success({ code: HANDOFF, state: url.searchParams.get("state")! }).url;
      return { type: "success", url: redirect };
    });
    const flow = signInWithGoogle(api(), API);
    await waitFor(() => expect(redirect).not.toBe(""));
    const [fromSession, fromRouter] = await Promise.all([flow, completeGoogleRedirect(api(), redirect)]);
    expect(fromSession.token).toBe(TOKEN);
    expect(fromRouter === null || fromRouter.token === TOKEN).toBe(true);
    expect(exchangeCalls()).toHaveLength(1);
  });

  it("is a GoogleSignInError for flow problems, so the UI can stay quiet on cancel", () => {
    expect(new GoogleSignInError("cancelled", "x")).toBeInstanceOf(Error);
  });
});

describe("Continue with Google on the sign-in screen", () => {
  it("is offered above the email form, separated by 'or'", async () => {
    renderRouter(APP_DIR, { initialUrl: "/sign-in" });
    expect(await screen.findByLabelText("Continue with Google")).toBeTruthy();
    expect(screen.getByText("or", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("stores the session securely and routes by the server's workspaces, like password sign-in", async () => {
    googleAnswers((url) => success({ code: HANDOFF, state: url.searchParams.get("state")! }));
    renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId("gateway-property_management"));
    await act(async () => fireEvent.press(await screen.findByTestId("sign-in-google")));

    await waitFor(() => expect(secureStore.get(SESSION_KEY)).toContain(TOKEN));
    // Same post-sign-in routing as password sign-in: the server lists a property-management workspace.
    await waitFor(() => expect(calls.some((call) => call.url.pathname === "/api/dashboard" && (call.init.headers as Record<string, string>)["x-organisation-id"] === ORG.id)).toBe(true));
    const authorised = calls.filter((call) => (call.init.headers as Record<string, string> | undefined)?.authorization === `Bearer ${TOKEN}`);
    expect(authorised.length).toBeGreaterThan(0);
    expect((await AsyncStorage.multiGet(await AsyncStorage.getAllKeys())).some(([, value]) => value?.includes(TOKEN))).toBe(false);
  });

  it("shows nothing alarming when the person closes the Google window", async () => {
    googleAnswers(() => ({ type: WebBrowser.WebBrowserResultType.CANCEL }));
    renderRouter(APP_DIR, { initialUrl: "/sign-in" });
    await act(async () => fireEvent.press(await screen.findByTestId("sign-in-google")));
    expect(screen.queryByText(/couldn’t be completed|went wrong/)).toBeNull();
    expect(secureStore.has(SESSION_KEY)).toBe(false);
    expect(screen.getByTestId("sign-in-google")).toBeTruthy();
  });

  it("explains a network failure without signing in", async () => {
    googleAnswers((url) => success({ code: HANDOFF, state: url.searchParams.get("state")! }));
    exchange = () => Promise.reject(new TypeError("Network request failed"));
    renderRouter(APP_DIR, { initialUrl: "/sign-in" });
    await act(async () => fireEvent.press(await screen.findByTestId("sign-in-google")));
    expect(await screen.findByText("Can’t reach NesAfric. Check your connection and try again.")).toBeTruthy();
    expect(secureStore.has(SESSION_KEY)).toBe(false);
  });

  it("finishes a sign-in reopened from the callback link after the app restarted", async () => {
    // The pending flow survived in secure storage; the in-memory auth session did not.
    const verifier = "a".repeat(64);
    secureStore.set(PENDING_KEY, JSON.stringify({ state: "restart-state-0123456789", verifier, createdAt: Date.now() }));
    renderRouter(APP_DIR, { initialUrl: `/auth/google?code=${HANDOFF}&state=restart-state-0123456789` });
    await waitFor(() => expect(secureStore.get(SESSION_KEY)).toContain(TOKEN));
    expect(JSON.parse(String(exchangeCalls()[0].init.body))).toEqual({ code: HANDOFF, codeVerifier: verifier });
    // Back on the signed-in Account screen.
    expect(await screen.findByTestId("tenant-access-section")).toBeTruthy();
  });
});
