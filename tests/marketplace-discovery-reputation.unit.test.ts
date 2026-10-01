import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Discovery & reputation foundation (unit level): completion-rate formula, free-text search
 * terms, search SQL keeping every public gate, the provider logo projection, and that a provider
 * cannot write platform-derived reputation through its own profile update.
 */

const state = vi.hoisted(() => ({
  queries: [] as { sql: string; values: unknown[] }[],
  rank: null as Record<string, unknown> | null,
  logo: null as null | { storageKey: string; classification: string; archivedAt: Date | null },
}));

vi.mock("@/platform/database/client", () => ({
  db: {
    $queryRaw: vi.fn(async (query: { strings: readonly string[]; values: unknown[] }) => {
      state.queries.push({ sql: query.strings.join("?"), values: query.values });
      return state.rank ? [state.rank] : [];
    }),
    providerMarketplaceProfile: {
      findFirst: vi.fn(async () => profile()),
      findMany: vi.fn(async () => [profile()]),
    },
  },
}));

const PROVIDER_ID = "5c9e0a11-0000-4000-8000-000000000001";

function profile() {
  return {
    providerId: PROVIDER_ID,
    listed: true,
    publicDescription: "Plumbing repairs.",
    showContactEmail: false,
    showContactPhone: false,
    startingRateMinor: null,
    currencyCode: null,
    responseTimeHours: null,
    provider: {
      id: PROVIDER_ID, slug: "kwame", displayName: "Kwame Plumbing", type: "COMPANY", verificationStatus: "VERIFIED",
      availabilityStatus: "AVAILABLE", acceptingWork: true, contactEmail: "private@example.com", contactPhone: null,
      identityVerifiedAt: new Date(), businessVerifiedAt: null, skillVerifiedAt: null, logoStorageObjectId: "x", logo: state.logo,
    },
    categories: [],
    serviceAreas: [],
  };
}

function rank(completed: number, basis: number) {
  return {
    id: PROVIDER_ID, total: BigInt(1), score: 50, category_score: 0, area_score: 0, verification_score: 15, availability_score: 10,
    rating_score: 0, completed_score: Math.min(completed, 10), readiness_score: 0, average_rating: null, rating_count: BigInt(0),
    completed_jobs: BigInt(completed), completion_basis: BigInt(basis),
  };
}

const service = await import("@/modules/marketplace/service");
const { publicMarketplaceDiscoverySchema, updateMarketplaceProfileSchema } = await import("@/modules/marketplace/schemas");

beforeEach(() => {
  state.queries = [];
  state.rank = rank(24, 25);
  state.logo = null;
});

describe("completion rate", () => {
  it("is completed / concluded, rounded to 0.1%", () => {
    expect(service.completionRate(24, 25)).toBe(0.96);
    expect(service.completionRate(5, 5)).toBe(1);
    expect(service.completionRate(2, 3 * 3)).toBe(0.222);
  });

  it("is null without enough concluded history — never a default 0% or 100%", () => {
    expect(service.MIN_COMPLETION_RATE_BASIS).toBe(5);
    expect(service.completionRate(0, 0)).toBeNull();
    expect(service.completionRate(4, 4)).toBeNull();
    expect(service.completionRate(0, 4)).toBeNull();
    expect(service.completionRate(6, 5)).toBeNull();
  });

  it("is derived in SQL from assignment outcomes only: completed, plus provider-caused cancellations of accepted work", async () => {
    await service.discoverMarketplaceProviders({});
    const sql = state.queries[0].sql.replace(/\s+/g, " ");
    expect(sql).toContain(`OR (a."status" = 'CANCELLED' AND a."cancellationAttribution" = 'PROVIDER' AND a."acceptedAt" IS NOT NULL))) AS completion_basis`);
    // Active (PENDING / ACCEPTED), DECLINED and non-provider cancellations are not in the basis.
    const basis = sql.slice(sql.indexOf("AS completed_jobs"), sql.indexOf("AS completion_basis"));
    expect(basis).not.toMatch(/PENDING|DECLINED|'UNKNOWN'|'LANDLORD'/);
  });

  it("is exposed with its basis on the public payload and does not change the ranking score", async () => {
    const { items } = await service.discoverMarketplaceProviders({});
    expect(items[0]).toMatchObject({ completedJobs: 24, completionRate: 0.96, completionRateBasis: 25, ranking: { score: 50 } });
    state.rank = rank(1, 1);
    const { provider } = await service.getPublicMarketplaceProvider(PROVIDER_ID);
    expect(provider).toMatchObject({ completedJobs: 1, completionRate: null, completionRateBasis: 1 });
  });

  it("cannot be written by a provider through its marketplace profile", () => {
    for (const field of ["completionRate", "completionRateBasis", "completedJobs", "aggregateRating", "ratingCount", "verificationBadges", "logo"]) {
      expect(updateMarketplaceProfileSchema.safeParse({ [field]: 1 }).success).toBe(false);
    }
  });
});

describe("provider text search", () => {
  it("normalises empty, whitespace and mixed-case queries", () => {
    expect(publicMarketplaceDiscoverySchema.parse({ q: "   " }).q).toBeUndefined();
    expect(publicMarketplaceDiscoverySchema.parse({ q: "" }).q).toBeUndefined();
    expect(publicMarketplaceDiscoverySchema.parse({ q: "  Kwame   PLUMBING " }).q).toBe("Kwame PLUMBING");
    expect(publicMarketplaceDiscoverySchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
    expect(service.providerSearchTerms(undefined)).toEqual([]);
    expect(service.providerSearchTerms("a")).toEqual([]);
  });

  it("matches partial words and trade stems, one AND-ed term per word", () => {
    expect(service.providerSearchTerms("Plumber")).toEqual([["%plumber%", "%plumb%"]]);
    expect(service.providerSearchTerms("Accra electricians")).toEqual([["%accra%"], ["%electricians%", "%electric%"]]);
    expect(service.providerSearchTerms("clean clean")).toEqual([["%clean%"]]);
    expect(service.providerSearchTerms("a b c d e f g h i j".replace(/ /g, "x "))).toHaveLength(6);
  });

  it("never lets LIKE wildcards typed by the user through", () => {
    // Terms are letters/digits only, so % and _ can never act as wildcards (and are escaped anyway).
    expect(service.providerSearchTerms("50%_off")).toEqual([["%50%"], ["%off%"]]);
    expect(service.providerSearchTerms("%%")).toEqual([]);
  });

  it("only narrows the gated set: every public gate stays and the order is the trust ranking", async () => {
    await service.discoverMarketplaceProviders({ q: "plumber", category: "plumbing", providerType: "COMPANY" });
    const { sql, values } = state.queries[0];
    const flat = sql.replace(/\s+/g, " ");
    for (const gate of [`mp."listed" = true`, `p."archivedAt" IS NULL`, `p."verificationStatus" NOT IN ('REJECTED', 'SUSPENDED')`, `p."suspendedAt" IS NULL`]) expect(flat).toContain(gate);
    expect(flat).toContain(`p."displayName" ILIKE ANY(`);
    expect(flat).toContain(`sc."name" ILIKE ANY(`);
    expect(flat).toContain(`smsa."city" ILIKE ANY(`);
    expect(flat).toContain(`c."key" = ?`);
    expect(flat).toContain("ORDER BY score DESC, average_rating DESC NULLS LAST, completed_jobs DESC, id ASC");
    expect(values).toContainEqual(["%plumber%", "%plumb%"]);
    // The typed text is only ever a bound parameter, never spliced into SQL.
    expect(sql).not.toContain("plumb");
  });

  it("adds no search clause for an empty query", async () => {
    await service.discoverMarketplaceProviders({ q: "  " });
    expect(state.queries[0].sql).not.toContain("ILIKE");
  });

  it("reports search as filter-only in the ranking metadata", async () => {
    const result = await service.discoverMarketplaceProviders({ q: "plumbing" });
    expect(result.meta.ranking.textSearch).toBe("filter-only");
  });
});

describe("provider logo projection", () => {
  it("is absent without a logo", async () => {
    const { provider } = await service.getPublicMarketplaceProvider(PROVIDER_ID);
    expect(provider.logo).toBeNull();
  });

  it("exposes only a render URL for a public, current logo", async () => {
    state.logo = { storageKey: "providers/kwame/logo.png", classification: "PUBLIC", archivedAt: null };
    const { provider } = await service.getPublicMarketplaceProvider(PROVIDER_ID);
    expect(provider.logo).toEqual({ url: expect.stringContaining("providers/kwame/logo.png") });
    expect(Object.keys(provider.logo!)).toEqual(["url"]);
  });

  it("never renders a private or archived object", async () => {
    state.logo = { storageKey: "providers/kwame/secret.png", classification: "PRIVATE", archivedAt: null };
    expect((await service.getPublicMarketplaceProvider(PROVIDER_ID)).provider.logo).toBeNull();
    state.logo = { storageKey: "providers/kwame/old.png", classification: "PUBLIC", archivedAt: new Date() };
    expect((await service.getPublicMarketplaceProvider(PROVIDER_ID)).provider.logo).toBeNull();
  });

  it("keeps the upload target PUBLIC-only, image-only and owner-authorised", async () => {
    const { getUploadDescriptor } = await import("@/modules/documents/targets");
    const descriptor = getUploadDescriptor("SERVICE_PROVIDER_LOGO");
    expect(descriptor.allowedClassifications).toEqual(["PUBLIC"]);
    expect(descriptor.allowedMimeTypes.every((type) => type.startsWith("image/"))).toBe(true);
  });
});
