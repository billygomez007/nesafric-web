import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The public provider projection exposes each verification level (identity, business, skill) as
 * a boolean derived only from the reviewer-set timestamps on `ServiceProvider`. The native app
 * shows a badge per level, so a level must never read as verified unless NesAfric approved it,
 * and the timestamps themselves must not leak into the public payload.
 */

const PROVIDER_ID = "5c9e0a11-0000-4000-8000-000000000001";

const state = vi.hoisted(() => ({
  provider: {} as Record<string, unknown>,
}));

vi.mock("@/platform/database/client", () => ({
  db: {
    $queryRaw: vi.fn(async () => [{
      id: "5c9e0a11-0000-4000-8000-000000000001",
      total: BigInt(1),
      score: 70,
      category_score: 0,
      area_score: 0,
      verification_score: 15,
      availability_score: 10,
      rating_score: 19,
      completed_score: 10,
      readiness_score: 10,
      average_rating: 4.8,
      rating_count: BigInt(84),
      completed_jobs: BigInt(127),
      completion_basis: BigInt(132),
    }]),
    providerMarketplaceProfile: {
      findFirst: vi.fn(async () => ({
        providerId: "5c9e0a11-0000-4000-8000-000000000001",
        listed: true,
        publicDescription: "Plumbing repairs.",
        showContactEmail: false,
        showContactPhone: false,
        startingRateMinor: null,
        currencyCode: null,
        responseTimeHours: 4,
        provider: state.provider,
        categories: [],
        serviceAreas: [],
      })),
    },
  },
}));

const { getPublicMarketplaceProvider } = await import("@/modules/marketplace/service");

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: PROVIDER_ID,
    slug: "kwame-plumbing",
    displayName: "Kwame Plumbing Services",
    type: "COMPANY",
    verificationStatus: "VERIFIED",
    availabilityStatus: "AVAILABLE",
    acceptingWork: true,
    contactEmail: "kwame@example.com",
    contactPhone: null,
    identityVerifiedAt: null,
    businessVerifiedAt: null,
    skillVerifiedAt: null,
    ...overrides,
  };
}

describe("public marketplace provider verification badges", () => {
  beforeEach(() => {
    state.provider = provider();
  });

  it("reports only the levels a reviewer has approved", async () => {
    state.provider = provider({ identityVerifiedAt: new Date("2026-09-01T00:00:00Z"), businessVerifiedAt: new Date("2026-09-02T00:00:00Z") });
    const { provider: result } = await getPublicMarketplaceProvider(PROVIDER_ID);
    expect(result.verificationBadges).toEqual({ identity: true, business: true, skill: false });
  });

  it("reports no levels when none are approved, even for a VERIFIED provider", async () => {
    const { provider: result } = await getPublicMarketplaceProvider(PROVIDER_ID);
    expect(result.verification).toBe("VERIFIED");
    expect(result.verificationBadges).toEqual({ identity: false, business: false, skill: false });
  });

  it("keeps rating, review count and completed jobs server-derived and never leaks review timestamps", async () => {
    state.provider = provider({ skillVerifiedAt: new Date("2026-09-03T00:00:00Z") });
    const { provider: result } = await getPublicMarketplaceProvider(PROVIDER_ID);
    expect(result).toMatchObject({ aggregateRating: 4.8, ratingCount: 84, completedJobs: 127, responseTimeHours: 4 });
    expect(result.verificationBadges.skill).toBe(true);
    const serialised = JSON.stringify(result, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
    expect(serialised).not.toContain("VerifiedAt");
    expect(serialised).not.toContain("2026-09-03");
    expect(result.contact).toEqual({ email: null, phone: null });
  });
});
