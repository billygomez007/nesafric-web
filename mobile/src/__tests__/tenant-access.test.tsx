/// <reference types="node" />

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import * as SecureStore from "expo-secure-store";
import path from "path";

const SESSION_KEY = "nesafric.session.v1";

const APP_DIR = path.join(__dirname, "../app");
const API = "https://api.test";

const TOKEN = "tok_tenant_access_test_abcdefghijklmnopqrstuvwxyz";
const USER_ID = "tenant-user-1";
const CODE = "NT-ABCD2-EFGH3-JKLM4-NPQR5";
const TENANCY_ID = "tenant-org-link-1";

const USER = {
  id: USER_ID,
  email: "tenant@example.com",
  displayName: "Esi Tenant",
};

type Call = {
  url: URL;
  init: RequestInit;
};

let calls: Call[] = [];

const secureStore = (
  SecureStore as typeof SecureStore & {
    __store: Map<string, string>;
  }
).__store;

function json(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({
      "content-type": "application/json",
    }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

function storeSession() {
  secureStore.set(
    SESSION_KEY,
    JSON.stringify({
      token: TOKEN,
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: USER,
    }),
  );
}

function header(call: Call, name: string) {
  const headers = new Headers(call.init.headers);
  return headers.get(name);
}

function callsTo(pathname: string) {
  return calls.filter((call) => call.url.pathname === pathname);
}

type MockOptions = {
  validation?: () => Promise<Response>;
  redemption?: () => Promise<Response>;
  tenanciesBefore?: unknown[];
  tenanciesAfter?: unknown[];
};

function mockApi({
  validation = () =>
    json(200, {
      valid: true,
      expiresAt: "2026-10-04T10:00:00.000Z",
    }),
  redemption = () =>
    json(200, {
      tenantOrganisationId: TENANCY_ID,
      alreadyRedeemed: false,
    }),
  tenanciesBefore = [],
  tenanciesAfter = [
    {
      id: TENANCY_ID,
      tenantId: "tenant-1",
      organisationId: "org-1",
      status: "ACTIVE",
    },
  ],
}: MockOptions = {}) {
  calls = [];

  let redeemed = false;

  globalThis.fetch = jest.fn(
    (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));

      calls.push({
        url,
        init,
      });

      if (url.origin !== API) {
        return json(404, {
          error: {
            code: "NOT_FOUND",
            message: "Not found",
          },
        });
      }

      if (url.pathname === "/api/account/profile") {
        return json(200, {
          profile: USER,
        });
      }

      if (url.pathname === "/api/workspaces") {
        return json(200, {
          propertyOsOrganisations: [],
          marketplaceProfessionals: [],
          serviceProviders: [],
        });
      }

      if (url.pathname === "/api/account/tenancies") {
        return json(200, {
          tenancies: redeemed ? tenanciesAfter : tenanciesBefore,
        });
      }

      if (url.pathname === "/api/account/tenant-access/validate") {
        return validation();
      }

      if (url.pathname === "/api/account/tenant-access/redeem") {
        return redemption().then((response) => {
          if (response.ok) redeemed = true;
          return response;
        });
      }

      if (url.pathname === "/api/public/listings") {
        return json(200, {
          items: [],
          pagination: {
            page: 1,
            pageSize: 20,
            total: 0,
            totalPages: 0,
          },
        });
      }

      return json(404, {
        error: {
          code: "NOT_FOUND",
          message: "Not found",
        },
      });
    },
  ) as jest.Mock;
}

async function enterCodeAndSubmit(code = CODE) {
  const input = await screen.findByTestId("tenant-access-code");

  fireEvent.changeText(input, code);

  await act(async () => {
    fireEvent.press(screen.getByTestId("tenant-access-submit"));
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  secureStore.clear();
  await AsyncStorage.clear();
  calls = [];
});

describe("tenant access-code flow", () => {
  it("requires sign-in before a tenant code can be connected", async () => {
    mockApi();

    renderRouter(APP_DIR, {
      initialUrl: "/tenant-access",
    });

    expect(await screen.findByText("Sign in first")).toBeTruthy();
    expect(screen.getByTestId("tenant-access-sign-in")).toBeTruthy();

    expect(callsTo("/api/account/tenant-access/validate")).toHaveLength(0);
    expect(callsTo("/api/account/tenant-access/redeem")).toHaveLength(0);
  });

  it("validates, redeems and refreshes the tenancy using the bearer session", async () => {
    mockApi();
    storeSession();

    renderRouter(APP_DIR, {
      initialUrl: "/tenant-access",
    });

    expect(await screen.findByTestId("tenant-access-title")).toBeTruthy();

    await enterCodeAndSubmit();

    await waitFor(() => {
      expect(callsTo("/api/account/tenant-access/validate")).toHaveLength(1);
    });

    await waitFor(() => {
      expect(callsTo("/api/account/tenant-access/redeem")).toHaveLength(1);
    });

    const validate = callsTo("/api/account/tenant-access/validate")[0];
    const redeem = callsTo("/api/account/tenant-access/redeem")[0];

    expect(validate.init.method).toBe("POST");
    expect(redeem.init.method).toBe("POST");

    expect(header(validate, "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(header(redeem, "authorization")).toBe(`Bearer ${TOKEN}`);

    expect(JSON.parse(String(validate.init.body))).toEqual({
      code: CODE,
    });

    expect(JSON.parse(String(redeem.init.body))).toEqual({
      code: CODE,
    });

    expect(String(validate.init.body)).not.toContain("tenantOrganisationId");
    expect(String(redeem.init.body)).not.toContain("tenantOrganisationId");

    await waitFor(() => {
      expect(callsTo("/api/account/tenancies").length).toBeGreaterThanOrEqual(1);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("tenant-access-title")).toBeNull();
    });
  });

  it("does not redeem when validation says the code is invalid", async () => {
    mockApi({
      validation: () =>
        json(200, {
          valid: false,
        }),
    });

    storeSession();

    renderRouter(APP_DIR, {
      initialUrl: "/tenant-access",
    });

    await screen.findByTestId("tenant-access-title");

    await enterCodeAndSubmit();

    expect(
      await screen.findByText(
        "This tenant access code is invalid or is no longer available.",
      ),
    ).toBeTruthy();

    expect(callsTo("/api/account/tenant-access/validate")).toHaveLength(1);
    expect(callsTo("/api/account/tenant-access/redeem")).toHaveLength(0);
  });

  it("shows rate limiting and does not attempt redemption", async () => {
    mockApi({
      validation: () =>
        json(429, {
          error: {
            code: "TENANT_ACCESS_RATE_LIMITED",
            message: "Too many attempts.",
          },
        }),
    });

    storeSession();

    renderRouter(APP_DIR, {
      initialUrl: "/tenant-access",
    });

    await screen.findByTestId("tenant-access-title");

    await enterCodeAndSubmit();

    expect(
      await screen.findByText(
        "Too many access-code attempts. Please wait before trying again.",
      ),
    ).toBeTruthy();

    expect(callsTo("/api/account/tenant-access/redeem")).toHaveLength(0);
  });

  it("shows an invalid-code message when redemption loses a race or the invitation is unavailable", async () => {
    mockApi({
      redemption: () =>
        json(409, {
          error: {
            code: "TENANT_ACCESS_INVALID",
            message: "Tenant access invitation is no longer available.",
          },
        }),
    });

    storeSession();

    renderRouter(APP_DIR, {
      initialUrl: "/tenant-access",
    });

    await screen.findByTestId("tenant-access-title");

    await enterCodeAndSubmit();

    expect(
      await screen.findByText(
        "This tenant access code is invalid or is no longer available.",
      ),
    ).toBeTruthy();

    expect(callsTo("/api/account/tenant-access/validate")).toHaveLength(1);
    expect(callsTo("/api/account/tenant-access/redeem")).toHaveLength(1);
  });

  it("validates the access-code length locally without sending it", async () => {
    mockApi();
    storeSession();

    renderRouter(APP_DIR, {
      initialUrl: "/tenant-access",
    });

    await screen.findByTestId("tenant-access-title");

    await enterCodeAndSubmit("short");

    expect(
      await screen.findByText(
        "Enter the tenant access code you received.",
      ),
    ).toBeTruthy();

    expect(callsTo("/api/account/tenant-access/validate")).toHaveLength(0);
    expect(callsTo("/api/account/tenant-access/redeem")).toHaveLength(0);
  });

  it("never persists the raw tenant access code in device storage", async () => {
    mockApi();
    storeSession();

    renderRouter(APP_DIR, {
      initialUrl: "/tenant-access",
    });

    await screen.findByTestId("tenant-access-title");

    await enterCodeAndSubmit();

    await waitFor(() => {
      expect(callsTo("/api/account/tenant-access/redeem")).toHaveLength(1);
    });

    const asyncEntries = await AsyncStorage.multiGet(
      await AsyncStorage.getAllKeys(),
    );

    const asyncValues = asyncEntries
      .map(([, value]) => value ?? "")
      .join(" ");

    const secureValues = [...secureStore.values()].join(" ");

    expect(asyncValues).not.toContain(CODE);
    expect(secureValues).not.toContain(CODE);
  });
});
