import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Routes read the session cookie through next/headers: a controllable jar lets the test call the
// real routes as a given user (or as nobody).
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

import { DELETE as removeRoute, PUT as saveRoute } from "@/app/api/account/saved-listings/[listingId]/route";
import { GET as idsRoute } from "@/app/api/account/saved-listings/ids/route";
import { POST as importRoute } from "@/app/api/account/saved-listings/import/route";
import { GET as listRoute } from "@/app/api/account/saved-listings/route";
import { createProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import { createListing, transitionListing, updateListingVerification } from "@/modules/listings/service";
import { createOrganisation } from "@/modules/organisations/service";
import { MAX_SAVED_LISTINGS } from "@/modules/saved-listings/service";
import { createSession } from "@/platform/auth/session";
import { db } from "@/platform/database/client";

// Assertions compare ids, key names, counts and statuses only; no listing or user record is printed.
const PASSWORD = "secure-password-123";
const MISSING = "00000000-0000-4000-8000-000000000000";
const BASE = "https://nesafric.test/api/account/saved-listings";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
}

async function signInAs(userId: string | null) {
  jar.clear();
  if (userId) await createSession(userId);
}

const params = (listingId: string) => ({ params: Promise.resolve({ listingId }) });
const save = (listingId: string) => saveRoute(new Request(`${BASE}/${listingId}`, { method: "PUT" }), params(listingId));
const remove = (listingId: string) => removeRoute(new Request(`${BASE}/${listingId}`, { method: "DELETE" }), params(listingId));
const list = (query = "") => listRoute(new Request(`${BASE}${query}`));
const importIds = (body: unknown) => importRoute(new Request(`${BASE}/import`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

let sequence = 0;
/**
 * A listing on its own unit of the organisation's one test property (the default plan allows only
 * a few properties). "published" is public: verified, published and the unit available.
 */
async function makeListing(ownerId: string, organisationId: string, state: "published" | "draft" = "published") {
  sequence += 1;
  let property = await db.property.findFirst({ where: { organisationId } });
  if (!property) {
    property = await createProperty(ownerId, organisationId, {
      name: "Saved House", referenceNumber: `SAVED-${sequence}`, category: "Residential", countryCode: "GH", currencyCode: "GHS",
      units: Array.from({ length: 8 }, (_, index) => ({ name: `U${index + 1}` })),
    });
  }
  const used = await db.listing.findMany({ where: { propertyId: property.id }, select: { unitId: true } });
  const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id, id: { notIn: used.map((row) => row.unitId!).filter(Boolean) } }, orderBy: { name: "asc" } });
  const listing = await createListing(ownerId, organisationId, {
    propertyId: property.id, unitId: unit.id, listingType: "RENT", category: "apartment", title: `Saved flat ${sequence}`,
    publicDescription: "A listing used by the saved listings tests.", rentAmountMinor: "250000", currencyCode: "GHS",
    frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH", city: "Accra", enquiryEnabled: true,
    media: [{ type: "PHOTO", publicUrl: `https://cdn.example.com/saved-${sequence}.jpg` }], amenities: [],
  });
  if (state === "published") {
    await updateListingVerification(ownerId, organisationId, listing.id, { status: "PENDING", evidence: [{ type: "MANAGEMENT_AUTHORITY", privateReference: `saved-evidence-${sequence}` }] });
    await updateListingVerification(ownerId, organisationId, listing.id, { status: "VERIFIED" });
    await transitionListing(ownerId, organisationId, listing.id, { status: "PENDING_REVIEW" });
    await transitionListing(ownerId, organisationId, listing.id, { status: "PUBLISHED" });
  }
  return listing.id;
}

async function setup() {
  const owner = await registerUser({ displayName: "Saved Owner", email: "owner@saved.test", password: PASSWORD });
  const ama = await registerUser({ displayName: "Ama", email: "ama@saved.test", password: PASSWORD });
  const kofi = await registerUser({ displayName: "Kofi", email: "kofi@saved.test", password: PASSWORD });
  const organisation = await createOrganisation(owner.id, { name: "Saved Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
  return { owner, ama, kofi, organisation };
}

describe("saved listings API", () => {
  beforeEach(async () => {
    await cleanDatabase();
    jar.clear();
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("requires a signed-in user on every route", async () => {
    await signInAs(null);
    for (const response of [await list(), await idsRoute(), await save(MISSING), await remove(MISSING), await importIds({ listingIds: [] })]) {
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("saves idempotently, lists newest first with public data, and removes idempotently", async () => {
    const { owner, ama, organisation } = await setup();
    const first = await makeListing(owner.id, organisation.id);
    const second = await makeListing(owner.id, organisation.id);
    await signInAs(ama.id);

    const created = await save(first);
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const createdBody = await created.json();
    expect(Object.keys(createdBody).sort()).toEqual(["created", "listingId", "savedAt"]);
    expect(createdBody.created).toBe(true);

    const again = await save(first);
    expect(again.status).toBe(200);
    expect((await again.json()).created).toBe(false);
    expect(await db.savedListing.count({ where: { userId: ama.id } })).toBe(1);

    expect((await save(second)).status).toBe(201);
    const page = await (await list()).json();
    expect(page.pagination).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
    expect(page.items.map((item: { listingId: string }) => item.listingId)).toEqual([second, first]);
    expect(Object.keys(page.items[0]).sort()).toEqual(["available", "listing", "listingId", "savedAt"]);
    expect(page.items.every((item: { listingId: string; available: boolean; listing: { id: string } | null }) => item.available && item.listing?.id === item.listingId)).toBe(true);

    const small = await (await list("?pageSize=1&page=2")).json();
    expect(small.items.map((item: { listingId: string }) => item.listingId)).toEqual([first]);
    expect(small.pagination).toEqual({ page: 2, pageSize: 1, total: 2, totalPages: 2 });

    expect(await (await idsRoute()).json()).toEqual({ listingIds: [second, first] });

    expect((await remove(first)).status).toBe(204);
    expect((await remove(first)).status).toBe(204);
    expect(await (await idsRoute()).json()).toEqual({ listingIds: [second] });
  });

  it("only saves listings the public marketplace shows, and hides data once a listing leaves it", async () => {
    const { owner, ama, organisation } = await setup();
    const draft = await makeListing(owner.id, organisation.id, "draft");
    const live = await makeListing(owner.id, organisation.id);
    await signInAs(ama.id);

    for (const id of [draft, MISSING]) {
      const refused = await save(id);
      expect(refused.status).toBe(404);
      expect((await refused.json()).error.code).toBe("NOT_FOUND");
    }
    expect(await db.savedListing.count()).toBe(0);

    expect((await save(live)).status).toBe(201);
    // The lister pauses it: still saved, but reported unavailable with no listing data.
    await db.listing.update({ where: { id: live }, data: { status: "PAUSED" } });
    const page = await (await list()).json();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ listingId: live, available: false, listing: null });
    // Saving it again is a harmless no-op (it's already saved), not a way to probe it.
    expect((await save(live)).status).toBe(200);
  });

  it("keeps each user's saves private", async () => {
    const { owner, ama, kofi, organisation } = await setup();
    const listingId = await makeListing(owner.id, organisation.id);
    await signInAs(ama.id);
    expect((await save(listingId)).status).toBe(201);

    await signInAs(kofi.id);
    expect(await (await idsRoute()).json()).toEqual({ listingIds: [] });
    expect((await (await list()).json()).pagination.total).toBe(0);
    // Kofi "removing" the listing cannot touch Ama's save.
    expect((await remove(listingId)).status).toBe(204);
    expect(await db.savedListing.count({ where: { userId: ama.id } })).toBe(1);
  });

  it("merges a device list: eligible, new ids only, in order, and safely repeatable", async () => {
    const { owner, ama, organisation } = await setup();
    const [newest, middle, oldest] = [await makeListing(owner.id, organisation.id), await makeListing(owner.id, organisation.id), await makeListing(owner.id, organisation.id)];
    const draft = await makeListing(owner.id, organisation.id, "draft");
    await signInAs(ama.id);
    expect((await save(middle)).status).toBe(201);

    // Device order is newest first; it includes a duplicate, an ineligible and an unknown id.
    const response = await importIds({ listingIds: [newest, middle, draft, oldest, newest, MISSING] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ imported: 2, skipped: 4, total: 3 });
    const ids = (await (await idsRoute()).json()).listingIds as string[];
    expect(ids.indexOf(newest)).toBeLessThan(ids.indexOf(oldest));
    expect(new Set(ids)).toEqual(new Set([newest, middle, oldest]));

    expect(await (await importIds({ listingIds: [newest, oldest] })).json()).toEqual({ imported: 0, skipped: 2, total: 3 });
  });

  it("validates input", async () => {
    const { ama } = await setup();
    await signInAs(ama.id);
    for (const response of [await save("not-a-uuid"), await remove("not-a-uuid"), await list("?pageSize=500"), await list("?unknown=1"), await importIds({ listingIds: ["nope"] }), await importIds({ listingIds: Array(201).fill(MISSING) })]) {
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    }
    const badJson = await importIds("{not json");
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).error.code).toBe("INVALID_JSON");
  });

  it("enforces the per-user limit on saves and on imports", async () => {
    const { owner, ama, organisation } = await setup();
    const extra = await makeListing(owner.id, organisation.id);
    const another = await makeListing(owner.id, organisation.id);
    const filler = await makeListing(owner.id, organisation.id);
    // Fill Ama's account to the limit: one real save plus copies of a draft listing row (created
    // in SQL; going through the full listing workflow 500 times would make the test very slow).
    const draft = await makeListing(owner.id, organisation.id, "draft");
    await db.savedListing.create({ data: { userId: ama.id, listingId: filler } });
    await db.$executeRawUnsafe(
      `INSERT INTO "Listing" SELECT (jsonb_populate_record(NULL::"Listing", to_jsonb(l) || jsonb_build_object('id', gen_random_uuid()))).* FROM "Listing" l, generate_series(1, $2::int) WHERE l.id = $1::uuid`,
      draft, MAX_SAVED_LISTINGS - 1,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "SavedListing" ("id", "userId", "listingId") SELECT gen_random_uuid(), $1::uuid, l.id FROM "Listing" l WHERE l."organisationId" = $2::uuid AND l.id NOT IN ($3::uuid, $4::uuid, $5::uuid, $6::uuid)`,
      ama.id, organisation.id, filler, draft, extra, another,
    );
    expect(await db.savedListing.count({ where: { userId: ama.id } })).toBe(MAX_SAVED_LISTINGS);

    await signInAs(ama.id);
    const refused = await save(extra);
    expect(refused.status).toBe(422);
    const body = await refused.json();
    expect(body.error.code).toBe("SAVED_LISTINGS_LIMIT");
    expect(body.error.details).toEqual({ limit: MAX_SAVED_LISTINGS });
    expect(await (await importIds({ listingIds: [extra, another] })).json()).toEqual({ imported: 0, skipped: 2, total: MAX_SAVED_LISTINGS });

    expect((await remove(filler)).status).toBe(204);
    expect(await (await importIds({ listingIds: [extra, another] })).json()).toEqual({ imported: 1, skipped: 1, total: MAX_SAVED_LISTINGS });
  });
});
