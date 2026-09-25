import { createHash } from "crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { GET as jobsRoute } from "@/app/api/jobs/run/route";
import { POST as leadRoute } from "@/app/api/public/listings/[listingId]/leads/route";
import { POST as viewingRoute } from "@/app/api/public/listings/[listingId]/viewings/route";
import { createProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import { createListing, transitionListing, updateListingVerification } from "@/modules/listings/service";
import { createOrganisation } from "@/modules/organisations/service";
import { db } from "@/platform/database/client";
import { STALE_PENDING_MS } from "@/platform/security/idempotency";
import { PublicWriteRateLimitError, reservePublicWrite, sweepExpiredPublicWriteRecords } from "@/platform/security/public-write-limit";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "PublicWriteCounter", "PublicIdempotencyRecord" CASCADE');
}

const ORIGINAL = { VERCEL: process.env.VERCEL, PUBLIC_WRITE_LIMITS: process.env.PUBLIC_WRITE_LIMITS, JOBS_RUN_SECRET: process.env.JOBS_RUN_SECRET, CRON_SECRET: process.env.CRON_SECRET };

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function publishedListing(tag: string) {
  const owner = await registerUser({ displayName: "Ama Owner", email: `owner-${tag}@hardening.test`, password: "secure-password-123" });
  const organisation = await createOrganisation(owner.id, { name: `Accra Estates ${tag}`, type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
  const property = await createProperty(owner.id, organisation.id, { name: "Sunset Ridge", referenceNumber: `SR-${tag}`, category: "Residential", countryCode: "GH", currencyCode: "GHS" });
  const listing = await createListing(owner.id, organisation.id, {
    propertyId: property.id, listingType: "RENT", category: "apartment", title: "Sunset Ridge Apartment",
    publicDescription: "A well-maintained two-bedroom apartment.", rentAmountMinor: "250000", currencyCode: "GHS",
    frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH", enquiryEnabled: true,
    media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/listing/photo.jpg", mimeType: "image/jpeg", sortOrder: 1 }],
  });
  await updateListingVerification(owner.id, organisation.id, listing.id, { status: "PENDING", evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/deed.pdf", metadata: {} }] });
  await updateListingVerification(owner.id, organisation.id, listing.id, { status: "VERIFIED", note: "Checked." });
  await transitionListing(owner.id, organisation.id, listing.id, { status: "PENDING_REVIEW" });
  await transitionListing(owner.id, organisation.id, listing.id, { status: "PUBLISHED" });
  return listing;
}

function post(route: typeof leadRoute, listingId: string, body: unknown, headers: Record<string, string> = {}) {
  return route(
    new Request(`https://nesafric.test/api/public/listings/${listingId}/x`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ listingId }) },
  );
}

async function charged(bucket: string) {
  const rows = await db.publicWriteCounter.findMany({ where: { bucket } });
  return rows.reduce((sum, row) => sum + row.count, 0);
}

const ipHeaders = (ip: string) => new Headers({ "x-real-ip": ip });
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("guest write protection hardening", () => {
  beforeEach(async () => {
    await cleanDatabase();
    restoreEnv();
    process.env.VERCEL = "1";
    delete process.env.PUBLIC_WRITE_LIMITS;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    restoreEnv();
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("charges nothing when a later rule rejects the request (all-or-nothing)", async () => {
    process.env.PUBLIC_WRITE_LIMITS = JSON.stringify({ "enquiry.contact.hour": 1 });
    const subject = { kind: "enquiry" as const, listingId: "listing-a", contact: { phone: "0241234567" } };
    await reservePublicWrite(ipHeaders("41.66.9.1"), subject);
    expect(await charged("enquiry.ip.10m")).toBe(1);
    for (let n = 0; n < 5; n++) {
      await expect(reservePublicWrite(ipHeaders("41.66.9.1"), subject)).rejects.toBeInstanceOf(PublicWriteRateLimitError);
    }
    // The IP (shared carrier-NAT) budget was not spent by the five rejected attempts.
    expect(await charged("enquiry.ip.10m")).toBe(1);
    expect(await charged("enquiry.contact.hour")).toBe(1);
    expect(await charged("enquiry.listing.hour")).toBe(1);
  });

  it("stays exact under concurrency with the all-or-nothing transaction", async () => {
    process.env.PUBLIC_WRITE_LIMITS = JSON.stringify({ "enquiry.contact.hour": 4 });
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, n) => reservePublicWrite(ipHeaders(`41.66.10.${n}`), { kind: "enquiry", listingId: `l-${n}`, contact: { phone: "0247654321" } })),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(4);
    expect(await charged("enquiry.contact.hour")).toBe(4);
    // Only the 4 accepted requests charged the per-IP rules.
    expect(await charged("enquiry.ip.10m")).toBe(4);
  });

  it("refunds a reservation exactly once", async () => {
    const reservation = await reservePublicWrite(ipHeaders("41.66.9.2"), { kind: "enquiry", listingId: "listing-b", contact: { email: "a@example.com" } });
    expect(await charged("enquiry.ip.10m")).toBe(1);
    await reservation.release();
    await reservation.release();
    expect(await charged("enquiry.ip.10m")).toBe(0);
  });

  it("does not spend quota on submissions that fail after passing the limiter", async () => {
    process.env.PUBLIC_WRITE_LIMITS = JSON.stringify({ "enquiry.ip.10m": 1 });
    const missing = "3f1c2a9e-5a55-4a1e-9f1c-0000000000aa";
    for (let n = 0; n < 3; n++) {
      expect((await post(leadRoute, missing, { name: "Kofi", phone: `02412345${60 + n}` }, { "x-real-ip": "41.66.9.3" })).status).toBe(404);
    }
    const listing = await publishedListing("refund");
    expect((await post(leadRoute, listing.id, { name: "Kofi", phone: "0241234599" }, { "x-real-ip": "41.66.9.3" })).status).toBe(201);
  });

  it("does not spend a lead's viewing budget on rejected viewing times", async () => {
    const listing = await publishedListing("viewing-refund");
    const lead = await (await post(leadRoute, listing.id, { name: "Ama", phone: "0551234567" }, { "x-real-ip": "41.66.9.4" })).json();
    const past = { leadId: lead.id, preferredTimes: [{ startsAt: "2020-01-01T09:00:00.000Z", endsAt: "2020-01-01T10:00:00.000Z", timezone: "Africa/Accra" }] };
    for (let n = 0; n < 4; n++) expect((await post(viewingRoute, listing.id, past, { "x-real-ip": "41.66.9.4" })).status).toBe(422);
    const future = { ...past, preferredTimes: [{ startsAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: new Date(Date.now() + 90_000_000).toISOString(), timezone: "Africa/Accra" }] };
    expect((await post(viewingRoute, listing.id, future, { "x-real-ip": "41.66.9.4" })).status).toBe(201);
    expect(await charged("viewing.lead.day")).toBe(1);
  });

  it("sweeps only expired counters and idempotency records", async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 60_000);
    const future = new Date(now.getTime() + 60_000);
    await db.publicWriteCounter.createMany({
      data: [
        { bucket: "enquiry.ip.10m", keyHash: "old", windowStart: new Date(now.getTime() - 700_000), count: 3, expiresAt: past },
        { bucket: "enquiry.ip.10m", keyHash: "live", windowStart: now, count: 1, expiresAt: future },
      ],
    });
    await db.publicIdempotencyRecord.createMany({
      data: [
        { scope: "lead:x", keyHash: "old", fingerprint: "f", status: "COMPLETED", responseStatus: 201, responseBody: {}, expiresAt: past },
        { scope: "lead:x", keyHash: "live", fingerprint: "f", status: "COMPLETED", responseStatus: 201, responseBody: {}, expiresAt: future },
      ],
    });
    expect(await sweepExpiredPublicWriteRecords(now)).toEqual({ counters: 1, idempotency: 1 });
    expect((await db.publicWriteCounter.findMany()).map((row) => row.keyHash)).toEqual(["live"]);
    expect((await db.publicIdempotencyRecord.findMany()).map((row) => row.keyHash)).toEqual(["live"]);
  });

  it("runs the sweep from the scheduled jobs endpoint", async () => {
    delete process.env.JOBS_RUN_SECRET;
    delete process.env.CRON_SECRET;
    await db.publicWriteCounter.create({ data: { bucket: "enquiry.ip.10m", keyHash: "old", windowStart: new Date(0), count: 1, expiresAt: new Date(1000) } });
    expect((await jobsRoute(new Request("https://nesafric.test/api/jobs/run"))).status).toBe(200);
    expect(await db.publicWriteCounter.count()).toBe(0);
  });

  it("lets a retry through after an interrupted submission left a stale claim, but not a fresh one", async () => {
    const listing = await publishedListing("stale");
    const key = "d00dfeed-0000-4000-8000-000000000001";
    const body = { name: "Yaw", phone: "0209876543" };
    const claim = (createdAt: Date) =>
      db.publicIdempotencyRecord.create({ data: { scope: `lead:${listing.id}`, keyHash: sha256(key), fingerprint: "crashed", status: "PENDING", createdAt, expiresAt: new Date(Date.now() + 86_400_000) } });

    await claim(new Date());
    expect((await post(leadRoute, listing.id, body, { "x-real-ip": "41.66.9.5", "idempotency-key": key })).status).toBe(422);
    await db.publicIdempotencyRecord.deleteMany();

    await claim(new Date(Date.now() - STALE_PENDING_MS - 1000));
    const retried = await post(leadRoute, listing.id, body, { "x-real-ip": "41.66.9.5", "idempotency-key": key });
    expect(retried.status).toBe(201);
    expect(await db.marketplaceLead.count({ where: { listingId: listing.id } })).toBe(1);
  });

  it("keeps the claim when the lead was created but the result could not be stored", async () => {
    const listing = await publishedListing("completion-failure");
    const key = "d00dfeed-0000-4000-8000-000000000002";
    const body = { name: "Esi", email: "esi@example.com" };
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const update = vi.spyOn(db.publicIdempotencyRecord, "update").mockRejectedValueOnce(new Error("connection reset"));

    const first = await post(leadRoute, listing.id, body, { "x-real-ip": "41.66.9.6", "idempotency-key": key });
    expect(first.status).toBe(201);
    expect(update).toHaveBeenCalledTimes(1);
    expect((await db.publicIdempotencyRecord.findFirstOrThrow()).status).toBe("PENDING");

    // An immediate retry must not create a duplicate lead.
    const retry = await post(leadRoute, listing.id, body, { "x-real-ip": "41.66.9.6", "idempotency-key": key });
    expect(retry.status).toBe(409);
    expect(await db.marketplaceLead.count({ where: { listingId: listing.id } })).toBe(1);
    // Nothing identifying is logged.
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).not.toContain("esi@example.com");
    expect(logged).not.toContain(key);
  });

  it("allows a new submission once an old idempotency record has expired", async () => {
    const listing = await publishedListing("expired-key");
    const key = "d00dfeed-0000-4000-8000-000000000003";
    await db.publicIdempotencyRecord.create({
      data: { scope: `lead:${listing.id}`, keyHash: sha256(key), fingerprint: "old", status: "COMPLETED", responseStatus: 201, responseBody: { id: "old" }, expiresAt: new Date(Date.now() - 1000) },
    });
    const response = await post(leadRoute, listing.id, { name: "Kojo", phone: "0271112222" }, { "x-real-ip": "41.66.9.7", "idempotency-key": key });
    expect(response.status).toBe(201);
    expect(response.headers.get("idempotent-replayed")).toBeNull();
  });
});
