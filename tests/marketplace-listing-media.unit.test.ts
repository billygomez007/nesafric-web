import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, notFound } from "@/platform/errors";

/**
 * Regression guard for professional listing photo uploads. A marketplace professional's listing
 * belongs to the professional's backing organisation, which by design has no
 * OrganisationSubscription — so the PropertyOS storage entitlement check must never run for this
 * path (it used to, and failed with a bare NOT_FOUND before anything reached storage).
 */

const PROFESSIONAL_ID = "11111111-1111-4111-8111-111111111111";
const LISTING_ID = "22222222-2222-4222-8222-222222222222";
const BACKING_ORG_ID = "33333333-3333-4333-8333-333333333333";
// 1×1 PNG
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const mocks = vi.hoisted(() => ({
  requireMarketplaceRole: vi.fn(),
  assertWritableMarketplaceProfessional: vi.fn(),
  // Mirrors the real behaviour for an organisation with no OrganisationSubscription.
  assertOperational: vi.fn(),
  recordIntegrationOutcome: vi.fn(),
  listing: null as null | { id: string; organisationId: string; marketplaceProfessionalId: string | null; _count?: { media: number } },
  mediaCreate: vi.fn(),
  storageObjectCreate: vi.fn(),
}));

vi.mock("@/modules/marketplace-professionals/permissions", () => ({ requireMarketplaceRole: mocks.requireMarketplaceRole }));
vi.mock("@/modules/marketplace-professionals/entitlements", () => ({
  assertWritableMarketplaceProfessional: mocks.assertWritableMarketplaceProfessional,
}));
vi.mock("@/modules/entitlements/service", () => ({ assertOperational: mocks.assertOperational }));
vi.mock("@/modules/integrations/service", () => ({ recordIntegrationOutcome: mocks.recordIntegrationOutcome }));
vi.mock("@/platform/database/client", () => {
  const tx = {
    listing: { findUnique: vi.fn(async () => mocks.listing) },
    storageObject: { create: mocks.storageObjectCreate },
    listingMedia: {
      aggregate: vi.fn(async () => ({ _max: { sortOrder: null } })),
      create: mocks.mediaCreate,
    },
    auditEvent: { create: vi.fn(async () => ({})) },
    domainEvent: { create: vi.fn(async () => ({})) },
  };
  return {
    db: {
      ...tx,
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
});

const { uploadMarketplaceListingMedia } = await import("@/modules/documents/service");

const upload = () =>
  uploadMarketplaceListingMedia("user-1", PROFESSIONAL_ID, LISTING_ID, {
    fileName: "front.png",
    contentType: "image/png",
    dataBase64: PNG_BASE64,
    mediaType: "PHOTO",
  });

describe("uploadMarketplaceListingMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMarketplaceRole.mockResolvedValue(undefined);
    mocks.assertWritableMarketplaceProfessional.mockResolvedValue(undefined);
    mocks.assertOperational.mockImplementation(async () => { throw notFound(); });
    mocks.listing = { id: LISTING_ID, organisationId: BACKING_ORG_ID, marketplaceProfessionalId: PROFESSIONAL_ID, _count: { media: 0 } };
    mocks.storageObjectCreate.mockImplementation(async ({ data }) => ({ id: "storage-1", ...data }));
    mocks.mediaCreate.mockImplementation(async ({ data }) => ({ id: "media-1", ...data }));
  });

  it("uploads and attaches a public photo without the PropertyOS organisation entitlement check", async () => {
    const result = await upload();

    expect(mocks.assertOperational).not.toHaveBeenCalled();
    expect(mocks.assertWritableMarketplaceProfessional).toHaveBeenCalledWith(PROFESSIONAL_ID);
    expect(mocks.requireMarketplaceRole).toHaveBeenCalledWith("user-1", PROFESSIONAL_ID, "AGENT");

    const stored = mocks.storageObjectCreate.mock.calls[0][0].data;
    expect(stored.classification).toBe("PUBLIC");
    expect(stored.targetType).toBe("LISTING_MEDIA");
    expect(stored.organisationId).toBe(BACKING_ORG_ID);
    expect(stored.storageKey).toMatch(new RegExp(`^public/properties/${BACKING_ORG_ID}/${LISTING_ID}/[0-9a-f-]{36}-`));

    const media = mocks.mediaCreate.mock.calls[0][0].data;
    expect(media.listingId).toBe(LISTING_ID);
    expect(media.type).toBe("PHOTO");
    expect(media.isCover).toBe(true);
    expect(media.storageKey).toBe(stored.storageKey);
    expect(result.attached.id).toBe("media-1");
  });

  it("still requires the professional role before anything else", async () => {
    mocks.requireMarketplaceRole.mockRejectedValue(new AppError("FORBIDDEN", 403, "Forbidden"));

    await expect(upload()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.storageObjectCreate).not.toHaveBeenCalled();
  });

  it("rejects a listing that belongs to a different professional", async () => {
    mocks.listing = { ...mocks.listing!, marketplaceProfessionalId: "99999999-9999-4999-8999-999999999999" };

    await expect(upload()).rejects.toMatchObject({ code: "MARKETPLACE_LISTING_PROFESSIONAL_MISMATCH" });
    expect(mocks.storageObjectCreate).not.toHaveBeenCalled();
  });

  it("stops at the marketplace subscription check when the professional is read-only", async () => {
    mocks.assertWritableMarketplaceProfessional.mockRejectedValue(new AppError("MARKETPLACE_PROFESSIONAL_READ_ONLY", 402, "Read only"));

    await expect(upload()).rejects.toMatchObject({ code: "MARKETPLACE_PROFESSIONAL_READ_ONLY" });
    expect(mocks.storageObjectCreate).not.toHaveBeenCalled();
  });

  it("enforces the 12-photo listing limit", async () => {
    mocks.listing = { ...mocks.listing!, _count: { media: 12 } };

    await expect(upload()).rejects.toMatchObject({ code: "LISTING_MEDIA_LIMIT_REACHED" });
    expect(mocks.storageObjectCreate).not.toHaveBeenCalled();
  });
});
