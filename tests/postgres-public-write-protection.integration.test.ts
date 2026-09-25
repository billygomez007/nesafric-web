import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The public routes call getOptionalUser(), which reads next/headers; outside a Next request
// scope we stand in an anonymous (no cookie, no bearer) request.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { POST as leadRoute } from "@/app/api/public/listings/[listingId]/leads/route";
import { POST as viewingRoute } from "@/app/api/public/listings/[listingId]/viewings/route";
import { createProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import { createListing, transitionListing, updateListingVerification } from "@/modules/listings/service";
import { createOrganisation } from "@/modules/organisations/service";
import { db } from "@/platform/database/client";
import { assertPublicWriteAllowed, PublicWriteRateLimitError } from "@/platform/security/public-write-limit";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "PublicWriteCounter", "PublicIdempotencyRecord" CASCADE');
  await db.backgroundJob.deleteMany({ where: { type: "account-email" } });
}

const ORIGINAL_ENV = { VERCEL: process.env.VERCEL, PUBLIC_WRITE_LIMITS: process.env.PUBLIC_WRITE_LIMITS };

async function publishedListing(tag: string) {
  const owner = await registerUser({ displayName: "Ama Owner", email: `owner-${tag}@abuse.test`, password: "secure-password-123" });
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
  return { owner, listing };
}

function post(route: typeof leadRoute, listingId: string, body: unknown, headers: Record<string, string> = {}) {
  const request = new Request(`https://nesafric.test/api/public/listings/${listingId}/x`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return route(request, { params: Promise.resolve({ listingId }) });
}

const enquiry = (n: number) => ({ name: `Prospect ${n}`, phone: `+23324${String(1000000 + n).padStart(7, "0")}`, message: "Is it available?" });
const leadCount = (listingId: string) => db.marketplaceLead.count({ where: { listingId } });
const leadEmails = () => db.backgroundJob.count({ where: { type: "account-email" } });

describe("public enquiry / viewing abuse protection", () => {
  beforeEach(async () => {
    await cleanDatabase();
    process.env.VERCEL = "1";
    delete process.env.PUBLIC_WRITE_LIMITS;
  });
  afterEach(() => {
    process.env.VERCEL = ORIGINAL_ENV.VERCEL;
    process.env.PUBLIC_WRITE_LIMITS = ORIGINAL_ENV.PUBLIC_WRITE_LIMITS;
    if (ORIGINAL_ENV.VERCEL === undefined) delete process.env.VERCEL;
    if (ORIGINAL_ENV.PUBLIC_WRITE_LIMITS === undefined) delete process.env.PUBLIC_WRITE_LIMITS;
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("lets exactly the limit through when many identical-identity requests arrive simultaneously", async () => {
    const { listing } = await publishedListing("concurrent");
    // 20 parallel enquiries from the same phone: the contact limit is 5/hour.
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => post(leadRoute, listing.id, enquiry(1), { "x-real-ip": "41.66.1.10" })),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(15);
    expect(await leadCount(listing.id)).toBe(5);
    const limited = responses.find((response) => response.status === 429)!;
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await limited.json()).error.code).toBe("PUBLIC_WRITE_RATE_LIMITED");
  });

  it("counts atomically at the limiter level under heavy concurrency", async () => {
    process.env.PUBLIC_WRITE_LIMITS = JSON.stringify({ "enquiry.ip.10m": 10 });
    const attempts = await Promise.allSettled(
      Array.from({ length: 60 }, (_, n) =>
        assertPublicWriteAllowed(new Headers({ "x-real-ip": "41.66.1.20" }), { kind: "enquiry", listingId: `listing-${n}`, contact: { phone: `024${1000000 + n}` } }),
      ),
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(10);
    expect(attempts.filter((attempt) => attempt.status === "rejected" && attempt.reason instanceof PublicWriteRateLimitError)).toHaveLength(50);
  });

  it("does not let forged IP headers change the rate-limit identity", async () => {
    process.env.PUBLIC_WRITE_LIMITS = JSON.stringify({ "enquiry.ip.10m": 3 });
    const { listing } = await publishedListing("spoof");
    const statuses: number[] = [];
    for (let n = 0; n < 5; n++) {
      // Same Vercel-observed peer; the caller rotates every header it controls.
      const response = await post(leadRoute, listing.id, enquiry(100 + n), {
        "x-real-ip": "41.66.1.30",
        "cf-connecting-ip": `9.9.9.${n}`,
        "true-client-ip": `8.8.8.${n}`,
        "x-client-ip": `7.7.7.${n}`,
      });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([201, 201, 201, 429, 429]);
    // A genuinely different client (different Vercel-observed address) is unaffected.
    expect((await post(leadRoute, listing.id, enquiry(200), { "x-real-ip": "41.66.1.31" })).status).toBe(201);
  });

  it("does not block many different people sharing one carrier-NAT address", async () => {
    // 30 distinct subscribers behind one IP, each enquiring about a different listing.
    const headers = new Headers({ "x-real-ip": "102.176.0.1" });
    for (let n = 0; n < 30; n++) {
      await expect(
        assertPublicWriteAllowed(headers, { kind: "enquiry", listingId: `listing-${n}`, contact: { phone: `+23355${1000000 + n}` } }),
      ).resolves.toBeUndefined();
    }
    // The 31st in the same 10 minutes hits the (adjustable) IP ceiling…
    await expect(assertPublicWriteAllowed(headers, { kind: "enquiry", listingId: "listing-x", contact: { phone: "+233551999999" } })).rejects.toBeInstanceOf(PublicWriteRateLimitError);
    // …and raising it via PUBLIC_WRITE_LIMITS takes effect without a deploy.
    const env = { ...process.env, PUBLIC_WRITE_LIMITS: JSON.stringify({ "enquiry.ip.10m": 100 }) };
    await expect(assertPublicWriteAllowed(headers, { kind: "enquiry", listingId: "listing-y", contact: { phone: "+233551888888" } }, { env })).resolves.toBeUndefined();
  });

  it("treats phone formatting variants as one contact", async () => {
    const { listing } = await publishedListing("phone-format");
    const formats = ["024 123 4567", "+233 24 123 4567", "0241234567", "233241234567", "+233-24-123-4567", "(024) 1234567"];
    const statuses: number[] = [];
    for (const [n, phone] of formats.entries()) {
      statuses.push((await post(leadRoute, listing.id, { name: "Kofi", phone }, { "x-real-ip": `41.66.2.${n}` })).status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it("replays an idempotent submission once, without a second lead or notification", async () => {
    const { listing } = await publishedListing("idem");
    const headers = { "x-real-ip": "41.66.1.40", "idempotency-key": "b9f6a1c2-4d3e-4f5a-8b7c-000000000001" };
    const emailsBefore = await leadEmails();
    const first = await post(leadRoute, listing.id, enquiry(300), headers);
    const second = await post(leadRoute, listing.id, enquiry(300), headers);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(await second.json()).toEqual(await first.json());
    expect(await leadCount(listing.id)).toBe(1);
    expect((await leadEmails()) - emailsBefore).toBe(1);
  });

  it("refuses to reuse an idempotency key for different form contents", async () => {
    const { listing } = await publishedListing("idem-mismatch");
    const headers = { "x-real-ip": "41.66.1.41", "idempotency-key": "b9f6a1c2-4d3e-4f5a-8b7c-000000000002" };
    expect((await post(leadRoute, listing.id, enquiry(400), headers)).status).toBe(201);
    const changed = await post(leadRoute, listing.id, { ...enquiry(400), message: "Different message" }, headers);
    expect(changed.status).toBe(422);
    expect((await changed.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    // Property order alone is not a different submission.
    const reordered = await post(leadRoute, listing.id, { message: "Is it available?", phone: enquiry(400).phone, name: enquiry(400).name }, headers);
    expect(reordered.status).toBe(201);
    expect(reordered.headers.get("idempotent-replayed")).toBe("true");
    expect(await leadCount(listing.id)).toBe(1);
  });

  it("creates one lead when the same idempotent submission is sent concurrently", async () => {
    const { listing } = await publishedListing("idem-concurrent");
    const headers = { "x-real-ip": "41.66.1.42", "idempotency-key": "b9f6a1c2-4d3e-4f5a-8b7c-000000000003" };
    const emailsBefore = await leadEmails();
    const responses = await Promise.all(Array.from({ length: 8 }, () => post(leadRoute, listing.id, enquiry(500), headers)));
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
    expect(await leadCount(listing.id)).toBe(1);
    expect((await leadEmails()) - emailsBefore).toBe(1);
  });

  it("releases the key after a failed attempt so the same submission can be retried", async () => {
    const { listing } = await publishedListing("idem-retry");
    const missing = "3f1c2a9e-5a55-4a1e-9f1c-0000000000ff";
    const headers = { "x-real-ip": "41.66.1.43", "idempotency-key": "b9f6a1c2-4d3e-4f5a-8b7c-000000000004" };
    expect((await post(leadRoute, missing, enquiry(600), headers)).status).toBe(404);
    expect(await db.publicIdempotencyRecord.count()).toBe(0);
    expect((await post(leadRoute, listing.id, enquiry(600), { ...headers, "idempotency-key": "b9f6a1c2-4d3e-4f5a-8b7c-000000000005" })).status).toBe(201);
  });

  it("validates input before charging any rate-limit budget", async () => {
    process.env.PUBLIC_WRITE_LIMITS = JSON.stringify({ "enquiry.ip.10m": 1 });
    const { listing } = await publishedListing("validate-first");
    for (let n = 0; n < 3; n++) {
      expect((await post(leadRoute, listing.id, { name: "K" }, { "x-real-ip": "41.66.1.44" })).status).toBe(400);
    }
    expect((await post(leadRoute, listing.id, enquiry(700), { "x-real-ip": "41.66.1.44" })).status).toBe(201);
  });

  it("limits viewing requests per lead and makes them idempotent", async () => {
    const { listing } = await publishedListing("viewing");
    const lead = await (await post(leadRoute, listing.id, enquiry(800), { "x-real-ip": "41.66.1.50" })).json();
    const base = Date.now();
    const viewing = (n: number) => ({
      leadId: lead.id,
      preferredTimes: [{ startsAt: new Date(base + (n + 1) * 86_400_000).toISOString(), endsAt: new Date(base + (n + 1) * 86_400_000 + 3_600_000).toISOString(), timezone: "Africa/Accra" }],
    });
    const key = { "x-real-ip": "41.66.1.50", "idempotency-key": "c0ffee00-4d3e-4f5a-8b7c-000000000001" };
    expect((await post(viewingRoute, listing.id, viewing(0), key)).status).toBe(201);
    const replay = await post(viewingRoute, listing.id, viewing(0), key);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect((await post(viewingRoute, listing.id, viewing(1), { "x-real-ip": "41.66.1.51" })).status).toBe(201);
    expect((await post(viewingRoute, listing.id, viewing(2), { "x-real-ip": "41.66.1.52" })).status).toBe(201);
    expect((await post(viewingRoute, listing.id, viewing(3), { "x-real-ip": "41.66.1.53" })).status).toBe(429);
    expect(await db.viewingRequest.count({ where: { leadId: lead.id } })).toBe(3);
  });
});
