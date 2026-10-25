import { deflateSync } from "node:zlib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import { uploadMarketplaceListingMedia } from "@/modules/documents/service";
import {
  createMarketplaceNativeListing,
  getMarketplaceProfessionalListing,
  getPublicListing,
  removeMarketplaceListingMedia,
  searchPublicListings,
  setMarketplaceListingCoverMedia,
  submitMarketplaceListingForReview,
} from "@/modules/listings/service";
import { verifyAndPublishListingForPlatform } from "@/modules/platform-admin/service";

/**
 * Property photos and the cover image, end to end against PostgreSQL: the first photo becomes
 * the cover, the professional can choose another, there is only ever one, deleting keeps it
 * deterministic, concurrent uploads can't produce two, and the public listing leads with it.
 */

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
}

/** A real PNG of the given size and colour (optionally padded with uncompressed rows to be large). */
function png(rgb: [number, number, number], width = 240, height = 240, compress = true) {
  const crc32 = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.from(type, "ascii");
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head, data])));
    return Buffer.concat([length, head, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const idat = deflateSync(raw, { level: compress ? 9 : 0 });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

const photo = (name: string, rgb: [number, number, number]) => ({ fileName: name, contentType: "image/png", dataBase64: png(rgb), mediaType: "PHOTO" as const, altText: name });

function nativeInput(title = "Two-bedroom apartment, East Legon") {
  return {
    asset: {
      name: title, category: "APARTMENT", purpose: "RENT", bedrooms: 2, bathrooms: 2, currencyCode: "GHS", priceMinor: "450000",
      countryCode: "GH", city: "Accra", district: "Ayawaso West", locality: "East Legon", amenities: [], mediaUrls: [],
      availableFrom: "2026-10-01", authorityEvidenceReady: true,
    },
    listing: {
      listingType: "RENT", category: "APARTMENT", title, publicDescription: "A bright two-bedroom apartment close to shops and schools.",
      rentAmountMinor: "450000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-10-01",
      countryCode: "GH", city: "Accra", district: "Ayawaso West", locality: "East Legon", media: [], amenities: [],
    },
    listingAuthority: "BROKERAGE_AUTHORIZED",
  };
}

async function setup() {
  const owner = await registerUser({ displayName: "Photo Owner", email: "photos-owner@example.com", password: "secure-password-123" });
  const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Photo Brokerage", countryCode: "GH" });
  const listing = await createMarketplaceNativeListing(owner.id, professional.id, nativeInput());
  return { owner, professional, listing };
}

async function media(listingId: string) {
  return db.listingMedia.findMany({ where: { listingId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
}

describe("PostgreSQL listing photos and cover", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("makes the first photo the cover, keeps it for later uploads, and lets the professional choose another", async () => {
    const { owner, professional, listing } = await setup();
    const first = await uploadMarketplaceListingMedia(owner.id, professional.id, listing.id, photo("front.png", [10, 60, 50]));
    expect(first.attached.isCover).toBe(true);
    await uploadMarketplaceListingMedia(owner.id, professional.id, listing.id, photo("living.png", [200, 190, 170]));
    const third = await uploadMarketplaceListingMedia(owner.id, professional.id, listing.id, photo("pool.png", [80, 160, 200]));
    expect(third.attached.isCover).toBe(false);
    expect((await media(listing.id)).filter((item) => item.isCover).map((item) => item.id)).toEqual([first.attached.id]);

    const updated = await setMarketplaceListingCoverMedia(owner.id, professional.id, listing.id, third.attached.id);
    expect(updated.media.find((item: { isCover: boolean }) => item.isCover)?.id).toBe(third.attached.id);

    // Persisted, single, and no media or listing duplicated.
    const after = await media(listing.id);
    expect(after).toHaveLength(3);
    expect(after.filter((item) => item.isCover).map((item) => item.id)).toEqual([third.attached.id]);
    expect(after[0].id).toBe(third.attached.id);
    expect(await db.listing.count({ where: { marketplaceProfessionalId: professional.id } })).toBe(1);
    const reloaded = await getMarketplaceProfessionalListing(owner.id, professional.id, listing.id);
    expect(reloaded.media.filter((item: { isCover: boolean }) => item.isCover).map((item: { id: string }) => item.id)).toEqual([third.attached.id]);
  });

  it("deleting a photo keeps the cover; deleting the cover promotes the next photo; deleting all leaves none", async () => {
    const { owner, professional, listing } = await setup();
    const a = await uploadMarketplaceListingMedia(owner.id, professional.id, listing.id, photo("a.png", [1, 2, 3]));
    const b = await uploadMarketplaceListingMedia(owner.id, professional.id, listing.id, photo("b.png", [4, 5, 6]));
    const c = await uploadMarketplaceListingMedia(owner.id, professional.id, listing.id, photo("c.png", [7, 8, 9]));

    await removeMarketplaceListingMedia(owner.id, professional.id, listing.id, b.attached.id);
    expect((await media(listing.id)).filter((item) => item.isCover).map((item) => item.id)).toEqual([a.attached.id]);

    await removeMarketplaceListingMedia(owner.id, professional.id, listing.id, a.attached.id);
    expect((await media(listing.id)).map((item) => [item.id, item.isCover])).toEqual([[c.attached.id, true]]);

    await removeMarketplaceListingMedia(owner.id, professional.id, listing.id, c.attached.id);
    expect(await media(listing.id)).toEqual([]);
  });

  it("never produces two covers when two first photos upload at the same time", async () => {
    const { owner, professional, listing } = await setup();
    await Promise.all([
      uploadMarketplaceListingMedia(owner.id, professional.id, listing.id, photo("left.png", [20, 20, 20])),
      uploadMarketplaceListingMedia(owner.id, professional.id, listing.id, photo("right.png", [220, 220, 220])),
    ]);
    const after = await media(listing.id);
    expect(after).toHaveLength(2);
    expect(after.filter((item) => item.isCover)).toHaveLength(1);
  });

  it("only the listing's own professional can upload, remove, or change the cover", async () => {
    const { owner, professional, listing } = await setup();
    const own = await uploadMarketplaceListingMedia(owner.id, professional.id, listing.id, photo("own.png", [9, 9, 9]));
    const stranger = await registerUser({ displayName: "Stranger", email: "photos-stranger@example.com", password: "secure-password-123" });
    const rival = await createMarketplaceProfessional(stranger.id, { type: "BROKERAGE", displayName: "Rival Brokerage", countryCode: "GH" });

    await expect(setMarketplaceListingCoverMedia(stranger.id, professional.id, listing.id, own.attached.id)).rejects.toMatchObject({ status: 403 });
    await expect(removeMarketplaceListingMedia(stranger.id, professional.id, listing.id, own.attached.id)).rejects.toMatchObject({ status: 403 });
    await expect(uploadMarketplaceListingMedia(stranger.id, professional.id, listing.id, photo("x.png", [1, 1, 1]))).rejects.toMatchObject({ status: 403 });
    // Through their own professional account, another professional's listing doesn't exist.
    await expect(setMarketplaceListingCoverMedia(stranger.id, rival.id, listing.id, own.attached.id)).rejects.toMatchObject({ status: 404 });
    await expect(uploadMarketplaceListingMedia(stranger.id, rival.id, listing.id, photo("y.png", [2, 2, 2]))).rejects.toMatchObject({ status: 409 });
    expect((await media(listing.id)).map((item) => [item.id, item.isCover])).toEqual([[own.attached.id, true]]);
  });

  it("rejects a photo over the upload limit and a file that isn't an image, with clear JSON errors", async () => {
    const { owner, professional, listing } = await setup();
    const big = png([120, 130, 140], 1100, 1000, false); // ~3.3 MB of real, uncompressed PNG
    await expect(uploadMarketplaceListingMedia(owner.id, professional.id, listing.id, { fileName: "big.png", contentType: "image/png", dataBase64: big, mediaType: "PHOTO" }))
      .rejects.toMatchObject({ status: 413, code: "PHOTO_TOO_LARGE" });
    await expect(uploadMarketplaceListingMedia(owner.id, professional.id, listing.id, { fileName: "notes.png", contentType: "image/png", dataBase64: Buffer.from("not an image at all").toString("base64"), mediaType: "PHOTO" }))
      .rejects.toMatchObject({ status: 422, code: "UNSUPPORTED_FILE_TYPE" });
    expect(await media(listing.id)).toEqual([]);
  });

  it("publishes with the chosen cover leading the public listing and search, and no private evidence", async () => {
    const { owner, professional, listing } = await setup();
    await uploadMarketplaceListingMedia(owner.id, professional.id, listing.id, photo("front.png", [10, 60, 50]));
    const chosen = await uploadMarketplaceListingMedia(owner.id, professional.id, listing.id, photo("pool.png", [80, 160, 200]));
    await setMarketplaceListingCoverMedia(owner.id, professional.id, listing.id, chosen.attached.id);
    await submitMarketplaceListingForReview(owner.id, professional.id, listing.id, { evidence: { type: "listing_authority", reference: "PRIVATE-MANDATE-REF-123" } });
    const adminUser = await registerUser({ displayName: "Admin", email: "photos-admin@example.com", password: "secure-password-123" });
    const admin = await db.platformPrincipal.create({ data: { userId: adminUser.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
    const pending = await db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    await verifyAndPublishListingForPlatform(admin, listing.id, { expectedUpdatedAt: pending.updatedAt.toISOString() });

    const { listing: detail } = await getPublicListing(listing.id);
    const photos = detail.media.filter((item: { type: string }) => item.type === "PHOTO");
    expect(photos[0]).toMatchObject({ id: chosen.attached.id, isCover: true });
    expect(photos.filter((item: { isCover: boolean }) => item.isCover)).toHaveLength(1);
    const search = await searchPublicListings({});
    const card = search.items.find((item: { id: string }) => item.id === listing.id);
    expect(card?.media[0]).toMatchObject({ id: chosen.attached.id, isCover: true });
    expect(JSON.stringify([detail, card])).not.toMatch(/PRIVATE-MANDATE-REF-123|privateReference/);
    expect(await db.listing.count()).toBe(1);
  });
});
