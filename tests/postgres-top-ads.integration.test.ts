import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void request.cookies.set(name, value),
    delete: (name: string) => void request.cookies.delete(name),
  }),
  headers: async () => request.headers,
}));

import { GET as adminList, POST as adminCreate } from "@/app/api/platform-admin/top-ads/route";
import { GET as publicListings } from "@/app/api/public/listings/route";
import { createProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import { createListing, searchPublicListings, transitionListing, updateListingVerification } from "@/modules/listings/service";
import {
  createTopAd,
  deleteTopAd,
  listTopAdsForPlatform,
  MAX_ACTIVE_TOP_ADS,
  reorderTopAds,
  searchTopAdCandidates,
  updateTopAd,
} from "@/modules/marketplace/top-ads";
import { createOrganisation } from "@/modules/organisations/service";
import { createSessionRecord } from "@/platform/auth/session";
import { db } from "@/platform/database/client";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const owner = await registerUser({ displayName: "Listing Owner", email: "owner@top-ads.test", password: "secure-password-123" });
  const organisation = await createOrganisation(owner.id, { name: "Top Ads Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
  const property = await createProperty(owner.id, organisation.id, { name: "Airport Hills", referenceNumber: "TOPADS-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
  const admin = await registerUser({ displayName: "Super Admin", email: "super@top-ads.test", password: "secure-password-123" });
  const principal = await db.platformPrincipal.create({ data: { userId: admin.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
  return { owner, organisation, property, admin, principal };
}

async function listing(fixture: Fixture, title: string, overrides: Record<string, unknown> = {}, publish = true) {
  const created = await createListing(fixture.owner.id, fixture.organisation.id, {
    propertyId: fixture.property.id,
    listingType: "RENT",
    category: "apartment",
    title,
    publicDescription: `${title} — a test listing for Top Ads.`,
    rentAmountMinor: "250000",
    currencyCode: "GHS",
    frequency: "MONTHLY",
    availableFrom: "2026-09-01",
    countryCode: "GH",
    region: "Greater Accra",
    city: "Accra",
    media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/listing/photo.jpg", mimeType: "image/jpeg" }],
    ...overrides,
  });
  if (!publish) return created;
  await updateListingVerification(fixture.owner.id, fixture.organisation.id, created.id, {
    status: "PENDING",
    evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/evidence/deed.pdf" }],
  });
  await updateListingVerification(fixture.owner.id, fixture.organisation.id, created.id, { status: "VERIFIED", note: "Checked." });
  await transitionListing(fixture.owner.id, fixture.organisation.id, created.id, { status: "PENDING_REVIEW" });
  await transitionListing(fixture.owner.id, fixture.organisation.id, created.id, { status: "PUBLISHED" });
  return created;
}

const titles = async (query: Record<string, unknown> = {}) => (await searchPublicListings(query)).items.map((item) => item.title);

function as(bearer?: string) {
  request.cookies = new Map();
  request.headers = new Headers(bearer ? { authorization: `Bearer ${bearer}` } : {});
}

const adminPost = (body: unknown) =>
  adminCreate(new Request("https://nesafric.test/api/platform-admin/top-ads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("Top Ads", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("pins live listings first, in admin order, without duplicating them further down", async () => {
    const fixture = await setup();
    const a = await listing(fixture, "Listing A");
    const b = await listing(fixture, "Listing B");
    await listing(fixture, "Listing C");
    // Organic order is newest first.
    expect(await titles()).toEqual(["Listing C", "Listing B", "Listing A"]);

    const pinA = await createTopAd(fixture.principal, fixture.admin.id, { listingId: a.id });
    await createTopAd(fixture.principal, fixture.admin.id, { listingId: b.id });
    expect(pinA.status).toBe("active");

    const result = await searchPublicListings({});
    expect(result.items.map((item) => [item.title, item.isTopAd])).toEqual([
      ["Listing A", true],
      ["Listing B", true],
      ["Listing C", false],
    ]);
    expect(result.pagination.total).toBe(3);

    const listed = await listTopAdsForPlatform(fixture.principal);
    await reorderTopAds(fixture.principal, fixture.admin.id, { ids: [listed.items[1].id, listed.items[0].id] });
    expect(await titles()).toEqual(["Listing B", "Listing A", "Listing C"]);
  });

  it("keeps pagination stable: every listing appears exactly once across pages", async () => {
    const fixture = await setup();
    const created = [];
    for (const name of ["Page 1", "Page 2", "Page 3", "Page 4", "Page 5"]) created.push(await listing(fixture, name));
    await createTopAd(fixture.principal, fixture.admin.id, { listingId: created[0].id });
    await createTopAd(fixture.principal, fixture.admin.id, { listingId: created[2].id });

    const pages = [];
    for (const page of [1, 2, 3]) pages.push(...(await titles({ page, pageSize: 2 })));
    expect(pages).toEqual(["Page 1", "Page 3", "Page 5", "Page 4", "Page 2"]);
    expect(new Set(pages).size).toBe(5);
    expect((await searchPublicListings({ page: 1, pageSize: 2 })).pagination).toMatchObject({ total: 5, totalPages: 3 });
  });

  it("applies the visitor's filters to Top Ads: a non-matching pin is never forced into the results", async () => {
    const fixture = await setup();
    const kumasi = await listing(fixture, "Kumasi Villa", { city: "Kumasi", region: "Ashanti", category: "villa" });
    await listing(fixture, "Accra Flat");
    await createTopAd(fixture.principal, fixture.admin.id, { listingId: kumasi.id });

    expect(await titles({ country: "GH", city: "Accra" })).toEqual(["Accra Flat"]);
    expect(await titles({ category: "apartment" })).toEqual(["Accra Flat"]);
    const matching = await searchPublicListings({ country: "GH", city: "Kumasi" });
    expect(matching.items.map((item) => [item.title, item.isTopAd])).toEqual([["Kumasi Villa", true]]);
    expect((await searchPublicListings({ maxPriceMinor: "100000" })).items).toEqual([]);
  });

  it("stops showing a pinned listing the moment it is no longer live, and can't be switched back on", async () => {
    const fixture = await setup();
    const pinned = await listing(fixture, "Pinned");
    await listing(fixture, "Organic");
    await createTopAd(fixture.principal, fixture.admin.id, { listingId: pinned.id });
    expect(await titles()).toEqual(["Pinned", "Organic"]);

    await transitionListing(fixture.owner.id, fixture.organisation.id, pinned.id, { status: "PAUSED" });
    expect(await titles()).toEqual(["Organic"]);
    const admin = await listTopAdsForPlatform(fixture.principal);
    expect(admin.items[0].status).toBe("unavailable");
    await updateTopAd(fixture.principal, fixture.admin.id, admin.items[0].id, { isActive: false });
    await expect(updateTopAd(fixture.principal, fixture.admin.id, admin.items[0].id, { isActive: true })).rejects.toMatchObject({ code: "TOP_AD_LISTING_INELIGIBLE" });
  });

  it("hides the pin when the property becomes unavailable (same eligibility as organic results)", async () => {
    const fixture = await setup();
    const pinned = await listing(fixture, "Pinned");
    await createTopAd(fixture.principal, fixture.admin.id, { listingId: pinned.id });
    await db.property.update({ where: { id: fixture.property.id }, data: { status: "INACTIVE" } });
    expect(await titles()).toEqual([]);
  });

  it("only allows live listings to be pinned: drafts, paused, archived and bad ids are refused", async () => {
    const fixture = await setup();
    const draft = await listing(fixture, "Draft", {}, false);
    await expect(createTopAd(fixture.principal, fixture.admin.id, { listingId: draft.id })).rejects.toMatchObject({ code: "TOP_AD_LISTING_INELIGIBLE" });

    const paused = await listing(fixture, "Paused");
    await transitionListing(fixture.owner.id, fixture.organisation.id, paused.id, { status: "PAUSED" });
    await expect(createTopAd(fixture.principal, fixture.admin.id, { listingId: paused.id })).rejects.toMatchObject({ code: "TOP_AD_LISTING_INELIGIBLE" });

    const archived = await listing(fixture, "Archived");
    await transitionListing(fixture.owner.id, fixture.organisation.id, archived.id, { status: "ARCHIVED" });
    await expect(createTopAd(fixture.principal, fixture.admin.id, { listingId: archived.id })).rejects.toMatchObject({ code: "TOP_AD_LISTING_INELIGIBLE" });

    await expect(createTopAd(fixture.principal, fixture.admin.id, { listingId: "not-a-uuid" })).rejects.toMatchObject({ code: "TOP_AD_LISTING_INELIGIBLE" });

    const live = await listing(fixture, "Live");
    await createTopAd(fixture.principal, fixture.admin.id, { listingId: live.id });
    await expect(createTopAd(fixture.principal, fixture.admin.id, { listingId: live.id })).rejects.toMatchObject({ code: "TOP_AD_DUPLICATE" });

    const candidates = await searchTopAdCandidates(fixture.principal, undefined);
    expect(candidates.items.map((item) => [item.title, item.isTopAd])).toEqual([["Live", true]]);
  });

  it("honours pause and the schedule: scheduled and ended Top Ads rank as ordinary listings", async () => {
    const fixture = await setup();
    const scheduled = await listing(fixture, "Scheduled");
    const ended = await listing(fixture, "Ended");
    const paused = await listing(fixture, "Paused pin");
    await listing(fixture, "Newest organic");
    const day = 86_400_000;
    await createTopAd(fixture.principal, fixture.admin.id, { listingId: scheduled.id, startsAt: new Date(Date.now() + day).toISOString() });
    await createTopAd(fixture.principal, fixture.admin.id, { listingId: ended.id, startsAt: new Date(Date.now() - 2 * day).toISOString(), endsAt: new Date(Date.now() - day).toISOString() });
    await createTopAd(fixture.principal, fixture.admin.id, { listingId: paused.id, isActive: false });

    const result = await searchPublicListings({});
    expect(result.items.every((item) => !item.isTopAd)).toBe(true);
    expect(result.items.map((item) => item.title)).toEqual(["Newest organic", "Paused pin", "Ended", "Scheduled"]);
    expect((await listTopAdsForPlatform(fixture.principal)).items.map((item) => item.status)).toEqual(["scheduled", "expired", "paused"]);

    const bad = await listing(fixture, "Bad schedule");
    await expect(createTopAd(fixture.principal, fixture.admin.id, { listingId: bad.id, startsAt: "2026-10-02T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it(`caps switched-on Top Ads at ${MAX_ACTIVE_TOP_ADS}`, async () => {
    const fixture = await setup();
    // Fill the switched-on slots directly with drafts spread over several organisations (a plan
    // limits how many listings one organisation may hold).
    for (let index = 0; index < MAX_ACTIVE_TOP_ADS; index += 1) {
      const organisation = await createOrganisation(fixture.owner.id, { name: `Filler Org ${index}`, type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
      const property = await createProperty(fixture.owner.id, organisation.id, { name: `Filler ${index}`, referenceNumber: `FILL-${index}`, category: "Residential", countryCode: "GH", currencyCode: "GHS" });
      const draft = await listing({ ...fixture, organisation, property }, `Slot filler ${index}`, {}, false);
      await db.marketplaceTopAd.create({ data: { listingId: draft.id, sortOrder: index, createdByUserId: fixture.admin.id, updatedByUserId: fixture.admin.id } });
    }
    const extra = await listing(fixture, "One too many");
    await expect(createTopAd(fixture.principal, fixture.admin.id, { listingId: extra.id })).rejects.toMatchObject({ code: "TOP_AD_LIMIT_REACHED" });
    const parked = await createTopAd(fixture.principal, fixture.admin.id, { listingId: extra.id, isActive: false });
    expect(parked.status).toBe("paused");
    await expect(updateTopAd(fixture.principal, fixture.admin.id, parked.id, { isActive: true })).rejects.toMatchObject({ code: "TOP_AD_LIMIT_REACHED" });
  }, 60_000);

  it("audits every change and never touches the listing itself", async () => {
    const fixture = await setup();
    const live = await listing(fixture, "Audited");
    const created = await createTopAd(fixture.principal, fixture.admin.id, { listingId: live.id });
    await updateTopAd(fixture.principal, fixture.admin.id, created.id, { isActive: false });
    await reorderTopAds(fixture.principal, fixture.admin.id, { ids: [created.id] });
    await deleteTopAd(fixture.principal, created.id);
    const events = await db.platformAuditEvent.findMany({ where: { entityType: "marketplace_top_ad" }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.action)).toEqual(["top_ad.added", "top_ad.paused", "top_ad.reordered", "top_ad.removed"]);
    expect(events.every((event) => event.platformPrincipalId === fixture.principal.id)).toBe(true);
    expect((await db.listing.findUnique({ where: { id: live.id } }))?.status).toBe("PUBLISHED");
  });

  it("only super admins can manage Top Ads; listing owners, other platform roles and guests are refused", async () => {
    const fixture = await setup();
    const live = await listing(fixture, "Owner wants to self-pin");

    as((await createSessionRecord(fixture.owner.id)).token);
    expect((await adminPost({ listingId: live.id })).status).toBe(403);
    expect((await adminList()).status).toBe(403);

    const billing = await registerUser({ displayName: "Billing", email: "billing@top-ads.test", password: "secure-password-123" });
    await db.platformPrincipal.create({ data: { userId: billing.id, role: "BILLING_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
    as((await createSessionRecord(billing.id)).token);
    expect((await adminPost({ listingId: live.id })).status).toBe(403);

    as();
    expect((await adminList()).status).toBe(401);
    expect(await db.marketplaceTopAd.count()).toBe(0);

    as((await createSessionRecord(fixture.admin.id)).token);
    expect((await adminPost({ listingId: live.id })).status).toBe(201);
    expect(await db.marketplaceTopAd.count()).toBe(1);
  });

  it("the public API exposes only the final state: an isTopAd flag on the ordinary listing shape", async () => {
    const fixture = await setup();
    const live = await listing(fixture, "Public pin");
    await createTopAd(fixture.principal, fixture.admin.id, { listingId: live.id });
    as();
    const body = await (await publicListings(new Request("https://nesafric.test/api/public/listings"))).json();
    expect(body.items[0]).toMatchObject({ id: live.id, isTopAd: true, title: "Public pin" });
    expect(JSON.stringify(body)).not.toMatch(/createdByUserId|updatedByUserId|"startsAt"|"endsAt"|"isActive"/);
  });

  it("scope=UNIT keeps every eligibility rule (the OR is parenthesised)", async () => {
    const fixture = await setup();
    await listing(fixture, "Whole property");
    const draft = await listing(fixture, "Draft unit", {}, false);
    // A draft with a marketplace-asset link used to satisfy `... AND unitId IS NOT NULL OR marketplaceAssetId IS NOT NULL AND ...`.
    const asset = await db.marketplaceAsset.findFirst();
    if (asset) await db.listing.update({ where: { id: draft.id }, data: { marketplaceAssetId: asset.id } });
    expect(await titles({ scope: "UNIT" })).toEqual([]);
  });
});
