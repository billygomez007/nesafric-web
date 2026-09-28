/// <reference types="node" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { renderRouter } from "expo-router/testing-library";
import path from "path";

import { isStoredSession, setActiveToken } from "@/auth/token-store";
import { OTP_CHALLENGE } from "@/test-utils/otp";
import { setWorkspaceIntent } from "@/workspace/intent";
import { resetWorkspaceNavigator } from "@/workspace/navigator";

jest.mock("expo-web-browser", () => ({
  WebBrowserResultType: { CANCEL: "cancel", DISMISS: "dismiss", OPENED: "opened", LOCKED: "locked" },
  openBrowserAsync: jest.fn(async () => ({ type: "opened" })),
  openAuthSessionAsync: jest.fn(async () => ({ type: "cancel" })),
}));

const APP_DIR = path.join(__dirname, "../app");
const SESSION_KEY = "nesafric.session.v1";
const TOKEN = "tok_OtpMobile_abcdefghijklmnopqrstu";
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const ORG = { id: "0b8f6a52-5b0c-4a1e-9c1c-000000000001", name: "Golden Coast Properties" };
const PRO = { id: "0b8f6a52-5b0c-4a1e-9c1c-0000000000a1", displayName: "Accra Homes", type: "BROKERAGE", status: "ACTIVE", verificationStatus: "VERIFIED", slug: "accra-homes", myRole: "OWNER" };
const PROVIDER = { id: "0b8f6a52-5b0c-4a1e-9c1c-0000000000b1", displayName: "Kwame Plumbing", type: "PLUMBER", slug: "kwame", verificationStatus: "VERIFIED", availabilityStatus: "AVAILABLE", suspended: false };
const PHONE_USER = { id: "phone-user", email: null, phone: "+233241234567", displayName: "Kofi Mensah" };

type Call = { url: URL; init: RequestInit };
let calls: Call[];
let verify: (body: Record<string, unknown>) => Promise<Response>;

function json(status: number, body?: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}

function mockApi(workspaces: Record<string, unknown[]> = {}) {
  calls = [];
  verify = () => json(200, { token: TOKEN, tokenType: "Bearer", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: PHONE_USER });
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname.startsWith("/api/marketplace-professionals/") || url.pathname.startsWith("/api/providers/")) return json(200, {});
    switch (url.pathname) {
      case "/api/auth/otp/request": {
        const body = JSON.parse(String(init.body));
        return json(200, { ...OTP_CHALLENGE, channel: body.channel, destination: body.channel === "sms" ? "+233 24 *** 4567" : body.identifier });
      }
      case "/api/auth/mobile/otp/verify":
        return verify(JSON.parse(String(init.body)));
      case "/api/auth/logout":
        return json(204);
      case "/api/account/profile":
        return json(200, { id: PHONE_USER.id, displayName: PHONE_USER.displayName, email: null, emailVerified: false, phone: PHONE_USER.phone, phoneVerified: true, createdAt: "2026-09-01T00:00:00.000Z" });
      case "/api/workspaces":
        return json(200, { propertyOsOrganisations: [], marketplaceProfessionals: [], serviceProviders: [], ...workspaces });
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

const bodyOf = (pathname: string, index = 0) => JSON.parse(String(calls.filter((call) => call.url.pathname === pathname)[index]?.init.body));

async function sendAndVerify(code = "123456") {
  await act(async () => fireEvent.press(screen.getByTestId("sign-in-send-code")));
  fireEvent.changeText(await screen.findByTestId("sign-in-code"), code);
  await act(async () => fireEvent.press(screen.getByTestId("sign-in-verify")));
}

beforeEach(async () => {
  secureStore.clear();
  await AsyncStorage.clear();
  setActiveToken(null);
  setWorkspaceIntent(null);
  resetWorkspaceNavigator();
  jest.clearAllMocks();
});

describe("native passwordless sign-in", () => {
  it("offers Phone, Email and Google with no password field; SMS autofill needs no permission", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/sign-in" });
    expect(await screen.findByTestId("sign-in-google")).toBeTruthy();
    expect(screen.getByTestId("sign-in-method-sms")).toHaveProp("accessibilityState", expect.objectContaining({ selected: true }));
    expect(screen.getByTestId("sign-in-method-email")).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getByTestId("sign-in-phone")).toHaveProp("keyboardType", "phone-pad");
    fireEvent.changeText(screen.getByTestId("sign-in-phone"), "024 123 4567");
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-send-code")));
    const code = await screen.findByTestId("sign-in-code");
    expect(code).toHaveProp("textContentType", "oneTimeCode");
    expect(code).toHaveProp("keyboardType", "number-pad");
    expect(["one-time-code", "sms-otp"]).toContain(code.props.autoComplete);
    // app.json declares no SMS or phone-state permission.
    const appJson = jest.requireActual<{ expo: { android: { permissions?: string[] } } }>("../../app.json");
    expect(JSON.stringify(appJson.expo.android.permissions ?? [])).not.toMatch(/SMS|PHONE_STATE/);
  });

  it("phone sign-in: texts a code, verifies it and stores the session only in secure storage", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/sign-in" });
    fireEvent.changeText(await screen.findByTestId("sign-in-phone"), "024 123 4567");
    await sendAndVerify();
    await waitFor(() => expect(secureStore.get(SESSION_KEY)).toContain(TOKEN));
    expect(bodyOf("/api/auth/otp/request")).toEqual({ mode: "login", channel: "sms", identifier: "024 123 4567" });
    expect(bodyOf("/api/auth/mobile/otp/verify")).toEqual({ challengeId: OTP_CHALLENGE.challengeId, channel: "sms", identifier: "024 123 4567", code: "123456" });
    const stored = JSON.parse(secureStore.get(SESSION_KEY)!);
    expect(isStoredSession(stored)).toBe(true);
    expect(stored.user).toEqual(PHONE_USER);
    expect((await AsyncStorage.multiGet(await AsyncStorage.getAllKeys())).some(([, value]) => value?.includes(TOKEN))).toBe(false);

    // The Account screen shows the phone for a phone-only account; sign-out revokes as before.
    renderRouter(APP_DIR, { initialUrl: "/account" });
    expect(await screen.findByText("+233241234567")).toBeTruthy();
    await act(async () => fireEvent.press(await screen.findByTestId("sign-out")));
    await waitFor(() => expect(calls.some((call) => call.url.pathname === "/api/auth/logout" && (call.init.headers as Record<string, string>).authorization === `Bearer ${TOKEN}`)).toBe(true));
    await waitFor(() => expect(secureStore.has(SESSION_KEY)).toBe(false));
  });

  it("email sign-in works the same way", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/sign-in" });
    fireEvent.press(await screen.findByTestId("sign-in-method-email"));
    fireEvent.changeText(await screen.findByTestId("sign-in-email"), "ama@example.com");
    await sendAndVerify();
    await waitFor(() => expect(secureStore.get(SESSION_KEY)).toContain(TOKEN));
    expect(bodyOf("/api/auth/otp/request")).toEqual({ mode: "login", channel: "email", identifier: "ama@example.com" });
  });

  it.each([
    ["phone", "sign-in-phone", "0241234567", "sms"],
    ["email", "sign-in-email", "kofi@example.com", "email"],
  ])("%s sign-up creates the account natively (no website hand-off)", async (_label, field, value, channel) => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/sign-in" });
    fireEvent.press(await screen.findByTestId("sign-in-mode-register"));
    if (channel === "email") fireEvent.press(screen.getByTestId("sign-in-method-email"));
    fireEvent.changeText(await screen.findByTestId("sign-up-name"), "Kofi Mensah");
    fireEvent.changeText(screen.getByTestId(field), value);
    await sendAndVerify();
    await waitFor(() => expect(secureStore.get(SESSION_KEY)).toContain(TOKEN));
    expect(bodyOf("/api/auth/otp/request")).toEqual({ mode: "register", channel, identifier: value });
    expect(bodyOf("/api/auth/mobile/otp/verify")).toMatchObject({ channel, identifier: value, code: "123456", displayName: "Kofi Mensah" });
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });

  it("signing in with an address that has no account offers to create it with the same code", async () => {
    mockApi();
    verify = (body) =>
      body.displayName
        ? json(200, { token: TOKEN, tokenType: "Bearer", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: PHONE_USER })
        : json(409, { error: { code: "OTP_NO_ACCOUNT", message: "No NesAfric account uses this phone number yet. Create one to continue." } });
    renderRouter(APP_DIR, { initialUrl: "/sign-in" });
    fireEvent.changeText(await screen.findByTestId("sign-in-phone"), "0241234567");
    await sendAndVerify();
    expect(await screen.findByText("No NesAfric account uses this phone number yet. Create one to continue.")).toBeTruthy();
    expect(secureStore.has(SESSION_KEY)).toBe(false);
    fireEvent.changeText(screen.getByTestId("no-account-name"), "Kofi Mensah");
    await act(async () => fireEvent.press(screen.getByTestId("no-account-create")));
    await waitFor(() => expect(secureStore.get(SESSION_KEY)).toContain(TOKEN));
    expect(bodyOf("/api/auth/mobile/otp/verify", 1)).toMatchObject({ code: "123456", displayName: "Kofi Mensah" });
  });

  it("shows the expired-code message from the server", async () => {
    mockApi();
    verify = () => json(400, { error: { code: "OTP_EXPIRED", message: "That code has expired. Send a new code to try again." } });
    renderRouter(APP_DIR, { initialUrl: "/sign-in" });
    fireEvent.changeText(await screen.findByTestId("sign-in-phone"), "0241234567");
    await sendAndVerify();
    expect(await screen.findByText("That code has expired. Send a new code to try again.")).toBeTruthy();
    expect(screen.getByTestId("sign-in-code")).toBeTruthy();
  });

  it("explains a temporary SMS outage and stays on the number step", async () => {
    mockApi();
    const base = jest.mocked(globalThis.fetch).getMockImplementation()!;
    jest.mocked(globalThis.fetch).mockImplementation((input, init) =>
      new URL(String(input)).pathname === "/api/auth/otp/request"
        ? json(503, { error: { code: "OTP_SMS_UNAVAILABLE", message: "Text-message codes are temporarily unavailable. Please use email or try again later." } })
        : base(input, init),
    );
    renderRouter(APP_DIR, { initialUrl: "/sign-in" });
    fireEvent.changeText(await screen.findByTestId("sign-in-phone"), "0241234567");
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-send-code")));
    expect(await screen.findByText("Text-message codes are temporarily unavailable. Please use email or try again later.")).toBeTruthy();
    expect(screen.queryByTestId("sign-in-code")).toBeNull();
  });

  it("shows server errors (wrong code, rate limits, SMS unavailable) and stores nothing", async () => {
    mockApi();
    verify = () => json(400, { error: { code: "OTP_INVALID", message: "That code is incorrect or has expired. Check it, or send a new code." } });
    renderRouter(APP_DIR, { initialUrl: "/sign-in" });
    fireEvent.changeText(await screen.findByTestId("sign-in-phone"), "0241234567");
    await sendAndVerify("000000");
    expect(await screen.findByText("That code is incorrect or has expired. Check it, or send a new code.")).toBeTruthy();
    expect(secureStore.has(SESSION_KEY)).toBe(false);
  });
});

describe("the entry intent is preserved and never grants access", () => {
  async function signInFrom(card: string) {
    const app = renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId(card));
    fireEvent.changeText(await screen.findByTestId("sign-in-phone"), "0241234567");
    await sendAndVerify();
    await waitFor(() => expect(secureStore.get(SESSION_KEY)).toContain(TOKEN));
    return app;
  }

  it("landlord card + a property-management workspace opens that dashboard", async () => {
    mockApi({ propertyOsOrganisations: [ORG] });
    const app = await signInFrom("gateway-property_management");
    await waitFor(() => expect(app.getPathname()).toBe(`/workspace/${ORG.id}`));
  });

  it("professional card + a professional workspace opens it", async () => {
    mockApi({ marketplaceProfessionals: [PRO] });
    const app = await signInFrom("gateway-professional");
    await waitFor(() => expect(app.getPathname()).toContain(`/agent/${PRO.id}`));
  });

  it("service-provider card + a provider workspace opens it", async () => {
    mockApi({ serviceProviders: [PROVIDER] });
    const app = await signInFrom("gateway-service_provider");
    await waitFor(() => expect(app.getPathname()).toContain(`/provider/${PROVIDER.id}`));
  });

  it("landlord card without a workspace lands on set-up — the card grants nothing", async () => {
    mockApi();
    const app = await signInFrom("gateway-property_management");
    await waitFor(() => expect(app.getPathname()).toBe("/setup/property_management"));
  });

  it("tenant card keeps the tenant focus on Account and offers the access code", async () => {
    mockApi();
    await signInFrom("gateway-tenant");
    expect(await screen.findByTestId("tenant-intent-notice")).toBeTruthy();
    expect(screen.getByTestId("tenant-intent-access-code")).toBeTruthy();
  });

  it("customer sign-in stays in the marketplace, even with business workspaces", async () => {
    mockApi({ propertyOsOrganisations: [ORG] });
    const app = renderRouter(APP_DIR, { initialUrl: "/account" });
    fireEvent.press(await screen.findByTestId("open-sign-in"));
    fireEvent.changeText(await screen.findByTestId("sign-in-phone"), "0241234567");
    await sendAndVerify();
    await waitFor(() => expect(secureStore.get(SESSION_KEY)).toContain(TOKEN));
    await waitFor(() => expect(app.getPathname()).toBe("/account"));
    expect(calls.some((call) => call.url.pathname === "/api/dashboard")).toBe(false);
  });
});
