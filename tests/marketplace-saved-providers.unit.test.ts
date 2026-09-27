import { beforeEach, describe, expect, it, vi } from "vitest";
import { unauthenticated } from "@/platform/errors";

/**
 * Saved service providers: authentication on every route, per-user scoping, idempotent save and
 * remove, and that the saved list never re-publishes a provider that has left the marketplace.
 * The in-memory table enforces the same (userId, providerId) uniqueness as the database.
 */

const LISTED = "5c9e0a11-0000-4000-8000-000000000001";
const HIDDEN = "5c9e0a11-0000-4000-8000-000000000002";

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  rows: [] as { id: string; userId: string; providerId: string; createdAt: Date }[],
  publicIds: new Set<string>(),
  queries: [] as unknown[][],
}));

vi.mock("@/platform/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!state.user) throw unauthenticated();
    return state.user;
  }),
}));

vi.mock("@/platform/database/client", () => {
  const matches = (where: { userId?: string; providerId?: string }) => (row: { userId: string; providerId: string }) =>
    (where.userId === undefined || row.userId === where.userId) && (where.providerId === undefined || row.providerId === where.providerId);
  return {
    db: {
      // The ranking query returns only providers that pass the public gates.
      $queryRaw: vi.fn(async (query: { values: unknown[] }) => {
        state.queries.push(query.values);
        const ids = query.values.find((value): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string" && item.includes("-")));
        return (ids ?? []).filter((id) => state.publicIds.has(id)).map((id) => ({
          id, total: BigInt(1), score: 0, category_score: 0, area_score: 0, verification_score: 15, availability_score: 10, rating_score: 0,
          completed_score: 0, readiness_score: 0, average_rating: null, rating_count: BigInt(0), completed_jobs: BigInt(0), completion_basis: BigInt(0),
        }));
      }),
      providerMarketplaceProfile: {
        findMany: vi.fn(async ({ where }: { where: { providerId: { in: string[] } } }) => where.providerId.in.map((providerId) => ({
          providerId, listed: true, publicDescription: null, showContactEmail: false, showContactPhone: false, startingRateMinor: null, currencyCode: null, responseTimeHours: null,
          provider: { id: providerId, slug: null, displayName: `Provider ${providerId.slice(-1)}`, type: "INDIVIDUAL", verificationStatus: "VERIFIED", availabilityStatus: "AVAILABLE",
            acceptingWork: true, contactEmail: "private@example.com", contactPhone: "+233200000000", identityVerifiedAt: new Date(), businessVerifiedAt: null, skillVerifiedAt: null, logo: null },
          categories: [], serviceAreas: [],
        }))),
      },
      savedServiceProvider: {
        findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
          state.rows.filter(matches(where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
        upsert: vi.fn(async ({ where, create }: { where: { userId_providerId: { userId: string; providerId: string } }; create: { userId: string; providerId: string } }) => {
          const existing = state.rows.find(matches(where.userId_providerId));
          if (existing) return existing;
          const row = { id: `row-${state.rows.length + 1}`, ...create, createdAt: new Date(Date.now() + state.rows.length) };
          state.rows.push(row);
          return row;
        }),
        findUniqueOrThrow: vi.fn(async ({ where }: { where: { userId_providerId: { userId: string; providerId: string } } }) => state.rows.find(matches(where.userId_providerId))),
        deleteMany: vi.fn(async ({ where }: { where: { userId: string; providerId: string } }) => {
          const before = state.rows.length;
          state.rows = state.rows.filter((row) => !matches(where)(row));
          return { count: before - state.rows.length };
        }),
      },
    },
  };
});

const listRoute = await import("@/app/api/marketplace/saved-providers/route");
const itemRoute = await import("@/app/api/marketplace/saved-providers/[providerId]/route");

const ctx = (providerId: string) => ({ params: Promise.resolve({ providerId }) });
const request = (method: string) => new Request("https://nesafric.test/api/marketplace/saved-providers", { method });
const body = async (response: Response) => ({ status: response.status, json: await response.json() });

beforeEach(() => {
  state.user = { id: "user-a" };
  state.rows = [];
  state.publicIds = new Set([LISTED]);
  state.queries = [];
});

describe("saved providers API", () => {
  it("requires authentication for list, save and remove", async () => {
    state.user = null;
    for (const response of [
      await listRoute.GET(),
      await itemRoute.POST(request("POST"), ctx(LISTED)),
      await itemRoute.DELETE(request("DELETE"), ctx(LISTED)),
    ]) {
      expect(await body(response)).toEqual({ status: 401, json: { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } } });
    }
    expect(state.rows).toHaveLength(0);
  });

  it("saves a listed provider once, however many times it is saved", async () => {
    const first = await body(await itemRoute.POST(request("POST"), ctx(LISTED)));
    const second = await body(await itemRoute.POST(request("POST"), ctx(LISTED)));
    expect(first).toMatchObject({ status: 200, json: { providerId: LISTED, saved: true } });
    expect(second.json.savedAt).toBe(first.json.savedAt);
    expect(state.rows).toHaveLength(1);
  });

  it("refuses to save a provider that isn't publicly listed, without saying why", async () => {
    expect(await body(await itemRoute.POST(request("POST"), ctx(HIDDEN)))).toMatchObject({ status: 404, json: { error: { code: "NOT_FOUND" } } });
    expect(await body(await itemRoute.POST(request("POST"), ctx("not-a-uuid")))).toMatchObject({ status: 404 });
    expect(state.rows).toHaveLength(0);
  });

  it("removes idempotently", async () => {
    await itemRoute.POST(request("POST"), ctx(LISTED));
    expect(await body(await itemRoute.DELETE(request("DELETE"), ctx(LISTED)))).toEqual({ status: 200, json: { providerId: LISTED, saved: false } });
    expect(await body(await itemRoute.DELETE(request("DELETE"), ctx(LISTED)))).toEqual({ status: 200, json: { providerId: LISTED, saved: false } });
    expect(state.rows).toHaveLength(0);
  });

  it("lists only the signed-in user's saves, and one user can't remove another's", async () => {
    await itemRoute.POST(request("POST"), ctx(LISTED));
    state.user = { id: "user-b" };
    expect((await body(await listRoute.GET())).json).toEqual({ items: [] });
    await itemRoute.DELETE(request("DELETE"), ctx(LISTED));
    expect(state.rows).toEqual([expect.objectContaining({ userId: "user-a", providerId: LISTED })]);
    state.user = { id: "user-a" };
    const { json } = await body(await listRoute.GET());
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toMatchObject({ providerId: LISTED, available: true, provider: { id: LISTED, displayName: "Provider 1", contact: { email: null, phone: null } } });
  });

  it("reports a provider that left the marketplace as unavailable, with no details", async () => {
    await itemRoute.POST(request("POST"), ctx(LISTED));
    state.publicIds.clear(); // unlisted, unverified or suspended since it was saved
    const { json } = await body(await listRoute.GET());
    expect(json.items).toEqual([{ providerId: LISTED, savedAt: expect.any(String), available: false, provider: null }]);
    expect(JSON.stringify(json)).not.toContain("Provider 1");
  });

  it("loads every saved card with one ranking query and one profile query (no N+1)", async () => {
    state.publicIds.add(HIDDEN);
    await itemRoute.POST(request("POST"), ctx(LISTED));
    await itemRoute.POST(request("POST"), ctx(HIDDEN));
    state.queries = [];
    const { json } = await body(await listRoute.GET());
    expect(json.items.map((item: { providerId: string }) => item.providerId)).toEqual([HIDDEN, LISTED]);
    expect(state.queries).toHaveLength(1);
  });
});
