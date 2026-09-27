import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden, unauthenticated } from "@/platform/errors";

/** The provider logo route: anonymous callers are refused before any upload work, and the
 * provider id always comes from the URL, never from the request body. */

const state = vi.hoisted(() => ({ user: null as null | { id: string }, calls: [] as unknown[][] }));

vi.mock("@/platform/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!state.user) throw unauthenticated();
    return state.user;
  }),
}));

vi.mock("@/modules/documents/service", () => ({
  uploadServiceProviderLogo: vi.fn(async (...args: unknown[]) => {
    state.calls.push(["upload", ...args]);
    if (args[0] !== "owner") throw forbidden();
    return { id: args[1], displayName: "Kwame", logoUrl: "/api/public/media/logo.png" };
  }),
  removeServiceProviderLogo: vi.fn(async (...args: unknown[]) => {
    state.calls.push(["remove", ...args]);
    if (args[0] !== "owner") throw forbidden();
    return { id: args[1], logo: null };
  }),
}));

const route = await import("@/app/api/providers/[providerId]/logo/route");
const PROVIDER = "5c9e0a11-0000-4000-8000-000000000001";
const ctx = { params: Promise.resolve({ providerId: PROVIDER }) };
const post = (body: unknown) => new Request(`https://nesafric.test/api/providers/${PROVIDER}/logo`, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  state.user = null;
  state.calls = [];
});

describe("provider logo route", () => {
  it("refuses anonymous upload and removal without calling the upload pipeline", async () => {
    for (const response of [await route.POST(post({ fileName: "a.png" }), ctx), await route.DELETE(new Request("https://nesafric.test"), ctx)]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
    }
    expect(state.calls).toEqual([]);
  });

  it("passes the URL's provider id and the signed-in user, ignoring any id in the body", async () => {
    state.user = { id: "owner" };
    const response = await route.POST(post({ fileName: "a.png", contentType: "image/png", dataBase64: "AA==", targetId: "someone-else", providerId: "someone-else" }), ctx);
    expect(response.status).toBe(201);
    expect(state.calls[0].slice(0, 3)).toEqual(["upload", "owner", PROVIDER]);
    expect(await route.DELETE(new Request("https://nesafric.test"), ctx).then((r) => r.json())).toEqual({ id: PROVIDER, logo: null });
  });

  it("returns 403 for a signed-in user who doesn't own the provider", async () => {
    state.user = { id: "stranger" };
    expect((await route.POST(post({}), ctx)).status).toBe(403);
    expect((await route.DELETE(new Request("https://nesafric.test"), ctx)).status).toBe(403);
  });
});
