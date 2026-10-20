import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, forbidden } from "@/platform/errors";

/**
 * Edit-in-place for marketplace-native listings: same listing id and asset, moderation statuses
 * respected, ownership enforced, photos never rewritten by a details edit.
 */

const OWNER_PRO = "11111111-1111-4111-8111-111111111111";
const OTHER_PRO = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_ID = "44444444-4444-4444-8444-444444444444";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const MEDIA_A = "55555555-5555-4555-8555-555555555555";
const MEDIA_B = "66666666-6666-4666-8666-666666666666";

type Media = { id: string; listingId: string; type: string; storageKey: string | null; classification: string; isCover: boolean; sortOrder: number; createdAt: Date };

const state = vi.hoisted(() => ({
  listing: null as null | Record<string, unknown>,
  media: [] as Media[],
  calls: { assetUpdate: [] as unknown[], listingUpdate: [] as unknown[], listingCreate: 0, mediaDeleteMany: 0, mediaUpdates: [] as unknown[] },
  deletedObjects: [] as string[],
  memberOf: new Set<string>(),
}));

vi.mock("@/modules/marketplace-professionals/permissions", () => ({
  requireMarketplaceMember: vi.fn(async (_user: string, pro: string) => { if (!state.memberOf.has(pro)) throw forbidden(); }),
  requireMarketplaceRole: vi.fn(async (_user: string, pro: string) => { if (!state.memberOf.has(pro)) throw forbidden(); }),
}));

vi.mock("@/platform/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/platform/storage")>();
  return { ...original, getObjectStorageAdapter: () => ({ deleteObject: async (key: string) => { state.deletedObjects.push(key); } }) };
});

vi.mock("@/platform/database/client", () => {
  const byOwner = (where: { id?: string; marketplaceProfessionalId?: string }) =>
    state.listing && where.id === state.listing.id && where.marketplaceProfessionalId === state.listing.marketplaceProfessionalId ? state.listing : null;
  const sorted = () => [...state.media].sort((a, b) => a.sortOrder - b.sortOrder);
  const tx = {
    listing: {
      findFirst: vi.fn(async ({ where }) => {
        const found = byOwner(where);
        return found ? { ...found, media: sorted() } : null;
      }),
      update: vi.fn(async ({ where, data }) => { state.calls.listingUpdate.push(data); return { ...state.listing, ...data, id: where.id, media: sorted() }; }),
      create: vi.fn(async () => { state.calls.listingCreate += 1; return {}; }),
    },
    marketplaceAsset: { update: vi.fn(async ({ where, data }) => { state.calls.assetUpdate.push({ where, data }); return {}; }) },
    country: { findUnique: vi.fn(async () => ({ isActive: true })) },
    currency: { findUnique: vi.fn(async () => ({ isActive: true })) },
    listingAmenity: { deleteMany: vi.fn(async () => ({})) },
    listingMedia: {
      deleteMany: vi.fn(async () => { state.calls.mediaDeleteMany += 1; return {}; }),
      findFirst: vi.fn(async ({ where }) => state.media.find((m) => m.id === where.id && m.listingId === where.listingId) ?? null),
      findMany: vi.fn(async ({ where }) => sorted().filter((m) => m.listingId === where.listingId)),
      delete: vi.fn(async ({ where }) => { state.media = state.media.filter((m) => m.id !== where.id); return {}; }),
      update: vi.fn(async ({ where, data }) => { state.calls.mediaUpdates.push({ where, data }); state.media = state.media.map((m) => (m.id === where.id ? { ...m, ...data } : m)); return {}; }),
    },
    storageObject: { updateMany: vi.fn(async () => ({ count: 1 })), findFirst: vi.fn(async () => ({ id: "stored-object" })) },
    // Row lock taken before any photo change (see modules/listings/cover.ts).
    $queryRaw: vi.fn(async () => []),
    marketplaceProfessionalMember: { findUnique: vi.fn(async () => null) },
    auditEvent: { create: vi.fn(async () => ({})) },
    domainEvent: { create: vi.fn(async () => ({})) },
  };
  return { db: { ...tx, $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } };
});

const { updateMarketplaceNativeListing, removeMarketplaceListingMedia, setMarketplaceListingCoverMedia } = await import("@/modules/listings/service");

function draftListing(status = "DRAFT") {
  return {
    id: LISTING_ID, organisationId: ORG_ID, marketplaceProfessionalId: OWNER_PRO, marketplaceAssetId: ASSET_ID, status,
    listingAuthority: "OWNER_SELF", listingRepresentativeUserId: null, developmentId: null, developmentUnitId: null,
    marketplaceAsset: { id: ASSET_ID, developmentUnitId: null },
  };
}

function editPayload(overrides: Record<string, unknown> = {}) {
  return {
    asset: {
      name: "Edited 3-bed house, East Legon", category: "HOUSE", purpose: "RENT", currencyCode: "GHS", priceMinor: "950000",
      countryCode: "GH", city: "Accra", district: "Ayawaso West", locality: "East Legon", bedrooms: 3, bathrooms: 3,
      amenities: ["Parking", "Generator"], furnishing: "SEMI_FURNISHED", mediaUrls: [], availableFrom: "2026-10-01",
      authorityEvidenceReady: true,
    },
    listing: {
      listingType: "RENT", category: "HOUSE", title: "Edited 3-bed house, East Legon", publicDescription: "A bright family home close to schools and shops.",
      currencyCode: "GHS", rentAmountMinor: "950000", askingAmountMinor: null, frequency: "MONTHLY", availableFrom: "2026-10-01",
      bedrooms: 3, bathrooms: 3, toilets: 4, parkingSpaces: 2, furnishing: "SEMI_FURNISHED", propertyCondition: "EXCELLENT", negotiable: true, yearBuilt: 2019,
      countryCode: "GH", city: "Accra", district: "Ayawaso West", locality: "East Legon",
      contactName: "Ama", contactPhone: "+233200000000", showContactEmail: false, showContactPhone: true, enquiryEnabled: true,
      amenities: [{ key: "parking", label: "Parking" }, { key: "generator", label: "Generator" }], media: [],
    },
    listingAuthority: "MANAGING_AGENT",
    ...overrides,
  };
}

beforeEach(() => {
  state.listing = draftListing();
  state.media = [
    { id: MEDIA_A, listingId: LISTING_ID, type: "PHOTO", storageKey: "public/properties/org/listing/a.jpg", classification: "PUBLIC", isCover: true, sortOrder: 0, createdAt: new Date(1) },
    { id: MEDIA_B, listingId: LISTING_ID, type: "PHOTO", storageKey: "public/properties/org/listing/b.jpg", classification: "PUBLIC", isCover: false, sortOrder: 1, createdAt: new Date(2) },
  ];
  state.calls = { assetUpdate: [], listingUpdate: [], listingCreate: 0, mediaDeleteMany: 0, mediaUpdates: [] };
  state.deletedObjects = [];
  state.memberOf = new Set([OWNER_PRO]);
});

describe("updateMarketplaceNativeListing", () => {
  it("lets a professional edit their own draft in place — same listing, same asset, photos untouched", async () => {
    const updated = await updateMarketplaceNativeListing("user-1", OWNER_PRO, LISTING_ID, editPayload());

    expect(updated.id).toBe(LISTING_ID);
    expect(state.calls.listingCreate).toBe(0);
    expect(state.calls.mediaDeleteMany).toBe(0);
    expect(state.calls.assetUpdate).toHaveLength(1);
    expect((state.calls.assetUpdate[0] as { where: { id: string } }).where.id).toBe(ASSET_ID);
    const listingData = state.calls.listingUpdate[0] as Record<string, unknown>;
    expect(listingData.title).toBe("Edited 3-bed house, East Legon");
    expect(listingData.toilets).toBe(4);
    expect(listingData.parkingSpaces).toBe(2);
    expect(listingData.yearBuilt).toBe(2019);
    expect(listingData).not.toHaveProperty("media");
    expect(listingData).not.toHaveProperty("status");
    expect(listingData.attributionHistory).toBeDefined(); // authority changed OWNER_SELF → MANAGING_AGENT
  });

  it("does not let another professional edit the listing", async () => {
    state.memberOf.add(OTHER_PRO);
    await expect(updateMarketplaceNativeListing("user-2", OTHER_PRO, LISTING_ID, editPayload())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.calls.listingUpdate).toHaveLength(0);
  });

  it("requires membership of the professional", async () => {
    await expect(updateMarketplaceNativeListing("user-3", OTHER_PRO, LISTING_ID, editPayload())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each(["PENDING_REVIEW", "PUBLISHED", "RESERVED", "RENTED", "ARCHIVED"])("refuses to edit a %s listing", async (status) => {
    state.listing = draftListing(status);
    await expect(updateMarketplaceNativeListing("user-1", OWNER_PRO, LISTING_ID, editPayload())).rejects.toMatchObject({ code: "LISTING_NOT_EDITABLE" });
    expect(state.calls.listingUpdate).toHaveLength(0);
  });

  it.each(["REJECTED", "PAUSED"])("allows editing a %s listing", async (status) => {
    state.listing = draftListing(status);
    await expect(updateMarketplaceNativeListing("user-1", OWNER_PRO, LISTING_ID, editPayload())).resolves.toMatchObject({ id: LISTING_ID });
  });

  it("refuses to move the listing to a different development unit", async () => {
    const payload = editPayload();
    (payload.asset as Record<string, unknown>).developmentUnitId = "77777777-7777-4777-8777-777777777777";
    await expect(updateMarketplaceNativeListing("user-1", OWNER_PRO, LISTING_ID, payload)).rejects.toMatchObject({ code: "LISTING_SOURCE_IMMUTABLE" });
  });
});

describe("listing photo management", () => {
  it("removes a photo, promotes the next one to cover and deletes the stored file", async () => {
    await removeMarketplaceListingMedia("user-1", OWNER_PRO, LISTING_ID, MEDIA_A);

    expect(state.media.map((m) => m.id)).toEqual([MEDIA_B]);
    expect(state.media[0].isCover).toBe(true);
    expect(state.deletedObjects).toEqual(["public/properties/org/listing/a.jpg"]);
  });

  it("cannot remove a photo that belongs to another listing", async () => {
    state.media[1] = { ...state.media[1], listingId: "88888888-8888-4888-8888-888888888888" };
    await expect(removeMarketplaceListingMedia("user-1", OWNER_PRO, LISTING_ID, MEDIA_B)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.deletedObjects).toEqual([]);
  });

  it("another professional cannot remove photos", async () => {
    state.memberOf.add(OTHER_PRO);
    await expect(removeMarketplaceListingMedia("user-2", OTHER_PRO, LISTING_ID, MEDIA_A)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.media).toHaveLength(2);
  });

  it("does not change photos on a published listing", async () => {
    state.listing = draftListing("PUBLISHED");
    await expect(removeMarketplaceListingMedia("user-1", OWNER_PRO, LISTING_ID, MEDIA_A)).rejects.toMatchObject({ code: "LISTING_NOT_EDITABLE" });
    await expect(setMarketplaceListingCoverMedia("user-1", OWNER_PRO, LISTING_ID, MEDIA_B)).rejects.toMatchObject({ code: "LISTING_NOT_EDITABLE" });
    expect(state.media).toHaveLength(2);
  });

  it("makes a chosen photo the cover and moves it first", async () => {
    await setMarketplaceListingCoverMedia("user-1", OWNER_PRO, LISTING_ID, MEDIA_B);

    const byId = Object.fromEntries(state.media.map((m) => [m.id, m]));
    expect(byId[MEDIA_B]).toMatchObject({ isCover: true, sortOrder: 0 });
    expect(byId[MEDIA_A]).toMatchObject({ isCover: false, sortOrder: 1 });
  });

  it("rejects non-photo media as a cover", async () => {
    state.media[1] = { ...state.media[1], type: "VIDEO" };
    await expect(setMarketplaceListingCoverMedia("user-1", OWNER_PRO, LISTING_ID, MEDIA_B)).rejects.toBeInstanceOf(AppError);
  });
});
