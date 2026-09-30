import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Routes read the session through next/headers: a controllable jar (anonymous by default).
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => request.headers,
}));

import { PATCH as bookingStatusRoute } from "@/app/api/accommodation-bookings/[bookingId]/route";
import { GET as organisationBookingsRoute } from "@/app/api/accommodation-bookings/route";
import { GET as agencyBookingsRoute } from "@/app/api/marketplace-professionals/[professionalId]/bookings/route";
import { POST as bookingRoute } from "@/app/api/public/listings/[listingId]/bookings/route";
import { POST as leadRoute } from "@/app/api/public/listings/[listingId]/leads/route";
import { GET as searchRoute } from "@/app/api/public/listings/route";
import { createProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import { createListing, transitionListing, updateListingVerification } from "@/modules/listings/service";
import { addMarketplaceMember, createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createSessionRecord } from "@/platform/auth/session";
import { db } from "@/platform/database/client";

const ORIGIN = "https://nesafric.test";
let n = 0;

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "PublicWriteCounter", "PublicIdempotencyRecord" CASCADE');
  await db.backgroundJob.deleteMany({ where: { type: "account-email" } });
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

type ListingOverrides = Record<string, unknown>;

/** An operator, their organisation, and one published, verified listing. */
async function operatorWithListing(overrides: ListingOverrides, publish = true) {
  n += 1;
  const owner = await registerUser({ displayName: `Operator ${n}`, email: `operator-${n}@stay.test`, password: "secure-password-123" });
  const organisation = await createOrganisation(owner.id, { name: `Stay Co ${n}`, type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
  const property = await createProperty(owner.id, organisation.id, { name: `Place ${n}`, referenceNumber: `PL-${n}`, category: "Hospitality", countryCode: "GH", currencyCode: "GHS" });
  const listing = await createListing(owner.id, organisation.id, {
    propertyId: property.id, listingType: "RENT", category: "HOTEL", title: `Labadi Beach Suites ${n}`,
    publicDescription: "Sea-view suites with breakfast and airport pickup.", rentAmountMinor: "95000", currencyCode: "GHS",
    frequency: "PER_NIGHT", availableFrom: "2026-01-01", countryCode: "GH", city: "Accra", enquiryEnabled: true,
    maxGuests: 4, minimumNights: 2, checkInTime: "14:00", checkOutTime: "11:00",
    media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/listing/photo.jpg", mimeType: "image/jpeg", sortOrder: 1 }],
    ...overrides,
  });
  if (publish) {
    await updateListingVerification(owner.id, organisation.id, listing.id, { status: "PENDING", evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/deed.pdf", metadata: {} }] });
    await updateListingVerification(owner.id, organisation.id, listing.id, { status: "VERIFIED", note: "Checked." });
    await transitionListing(owner.id, organisation.id, listing.id, { status: "PENDING_REVIEW" });
    await transitionListing(owner.id, organisation.id, listing.id, { status: "PUBLISHED" });
  }
  const { token } = await createSessionRecord(owner.id);
  return { owner, organisation, listing, token };
}

const stay = (overrides: Record<string, unknown> = {}) => ({
  checkIn: inDays(10), checkOut: inDays(13), adults: 2, children: 1,
  name: "Efua Mensah", email: "Efua@Guest.test", phone: "+233241234567", specialRequest: "Late arrival, around 22:00.",
  ...overrides,
});

function as(token?: string, organisationId?: string) {
  request.headers = new Headers();
  if (token) request.headers.set("authorization", `Bearer ${token}`);
  if (organisationId) request.headers.set("x-organisation-id", organisationId);
}

async function book(listingId: string, body: unknown, headers: Record<string, string> = {}) {
  as();
  const response = await bookingRoute(
    new Request(`${ORIGIN}/api/public/listings/${listingId}/bookings`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": `41.66.2.${n}`, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ listingId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function inbox(token: string, organisationId: string) {
  as(token, organisationId);
  const response = await organisationBookingsRoute(new (await import("next/server")).NextRequest(`${ORIGIN}/api/accommodation-bookings`, { headers: request.headers }));
  return { status: response.status, body: await response.json() };
}

async function decide(token: string, bookingId: string, status: string) {
  as(token);
  const response = await bookingStatusRoute(new Request(`${ORIGIN}/api/accommodation-bookings/${bookingId}`, { method: "PATCH", body: JSON.stringify({ status }) }), { params: Promise.resolve({ bookingId }) });
  return { status: response.status, body: await response.json() };
}

async function emails() {
  const jobs = await db.backgroundJob.findMany({ where: { type: "account-email" }, orderBy: { createdAt: "asc" } });
  return jobs.map((job) => job.payload as { template: string; userId?: string; recipientEmail?: string });
}

describe("hotel and short-stay booking requests", () => {
  beforeEach(async () => {
    await cleanDatabase();
    process.env.VERCEL = "1";
    delete process.env.PUBLIC_WRITE_LIMITS;
  });
  afterEach(() => {
    delete process.env.VERCEL;
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it.each(["HOTEL", "SHORT_STAY"])("a %s listing takes a request, routed to its own organisation, and answers only safe fields", async (category) => {
    const { owner, organisation, listing } = await operatorWithListing({ category, title: `${category} place` });
    const result = await book(listing.id, stay());
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ status: "REQUESTED", listingTitle: `${category} place`, nights: 3, adults: 2, children: 1, checkIn: inDays(10), checkOut: inDays(13) });
    expect(result.body.reference).toMatch(/^NB-[A-Z2-9]{6}$/);
    // Nothing about the operator or anyone's contact details comes back.
    expect(JSON.stringify(result.body)).not.toMatch(/organisation|email|phone|Operator|specialRequest|userId/i);

    const stored = await db.accommodationBooking.findFirstOrThrow({ where: { reference: result.body.reference } });
    expect(stored).toMatchObject({ organisationId: organisation.id, accommodationType: category, guestEmail: "efua@guest.test", status: "REQUESTED", currencyCode: "GHS" });
    expect(stored.nightlyPriceMinor?.toString()).toBe("95000");

    // The operator (listing creator) is told; the guest gets a receipt at the address they gave.
    const sent = await emails();
    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ template: "ACCOMMODATION_BOOKING_REQUESTED", userId: owner.id }),
      expect.objectContaining({ template: "ACCOMMODATION_BOOKING_RECEIPT", recipientEmail: "efua@guest.test" }),
    ]));
    // The guest's receipt carries no phone number or special request.
    expect(JSON.stringify(sent.find((email) => email.template === "ACCOMMODATION_BOOKING_RECEIPT"))).not.toMatch(/233241234567|Late arrival/);
  });

  it("refuses bookings for warehouses, rentals and sales — they keep the ordinary enquiry", async () => {
    const { listing: warehouse } = await operatorWithListing({ category: "WAREHOUSE", title: "Tema warehouse", frequency: "MONTHLY", rentAmountMinor: "1500000", maxGuests: undefined, minimumNights: undefined, checkInTime: undefined, checkOutTime: undefined });
    const refused = await book(warehouse.id, stay());
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("LISTING_NOT_BOOKABLE");
    expect(await db.accommodationBooking.count()).toBe(0);
    const enquiry = await leadRoute(
      new Request(`${ORIGIN}/api/public/listings/${warehouse.id}/leads`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "41.66.3.1" }, body: JSON.stringify({ name: "Kwame", phone: "+233201234567", message: "Is the loading bay covered?" }) }),
      { params: Promise.resolve({ listingId: warehouse.id }) },
    );
    expect(enquiry.status).toBe(201);
  });

  it("refuses an unpublished listing as not found", async () => {
    const { listing } = await operatorWithListing({}, false);
    expect((await book(listing.id, stay())).status).toBe(404);
  });

  it.each([
    ["check-in in the past", { checkIn: inDays(-1), checkOut: inDays(2) }, "INVALID_BOOKING"],
    ["check-out before check-in", { checkIn: inDays(10), checkOut: inDays(9) }, "INVALID_BOOKING"],
    ["check-out on check-in", { checkIn: inDays(10), checkOut: inDays(10) }, "INVALID_BOOKING"],
    ["below the listing's minimum stay", { checkIn: inDays(10), checkOut: inDays(11) }, "INVALID_BOOKING"],
    ["more guests than the listing hosts", { adults: 4, children: 1 }, "INVALID_BOOKING"],
    ["longer than 90 nights", { checkIn: inDays(10), checkOut: inDays(101) }, "INVALID_BOOKING"],
    ["more than a year ahead", { checkIn: inDays(400), checkOut: inDays(403) }, "INVALID_BOOKING"],
    ["an impossible date", { checkIn: "2026-02-31", checkOut: "2026-03-03" }, "VALIDATION_ERROR"],
    ["no adults", { adults: 0 }, "VALIDATION_ERROR"],
    ["a bad email", { email: "not-an-email" }, "VALIDATION_ERROR"],
    ["an oversized request", { specialRequest: "x".repeat(1_001) }, "VALIDATION_ERROR"],
  ])("rejects %s", async (_case, overrides, code) => {
    const { listing } = await operatorWithListing({});
    const result = await book(listing.id, stay(overrides));
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body.error.code).toBe(code);
    expect(await db.accommodationBooking.count()).toBe(0);
  });

  it("can't be routed elsewhere: client-supplied recipient, category or price fields are refused", async () => {
    const { listing } = await operatorWithListing({});
    const { organisation: other } = await operatorWithListing({});
    for (const forged of [{ organisationId: other.id }, { accommodationType: "SHORT_STAY" }, { nightlyPriceMinor: "1" }, { listingId: "x" }]) {
      const result = await book(listing.id, stay(forged));
      expect(result.status).toBe(400);
    }
    expect(await db.accommodationBooking.count()).toBe(0);
    const malformed = await book(listing.id, "{not json");
    expect(malformed.status).toBe(400);
  });

  it("rate-limits requests per contact and doesn't send unlimited emails", async () => {
    const { listing } = await operatorWithListing({});
    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) statuses.push((await book(listing.id, stay({ checkIn: inDays(10 + i * 3), checkOut: inDays(12 + i * 3) }), { "x-real-ip": `41.66.9.${i}` })).status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(3);
    expect(await db.accommodationBooking.count()).toBe(5);
    // Two per accepted request (operator + guest receipt); none for the refused ones.
    expect((await emails()).filter((email) => email.template.startsWith("ACCOMMODATION_BOOKING_")).length).toBe(10);
  });

  it("an Idempotency-Key retry returns the same request, creating nothing new", async () => {
    const { listing } = await operatorWithListing({});
    const first = await book(listing.id, stay(), { "idempotency-key": "3f7c1c9e-5a55-4a1e-9f1c-0000000000aa" });
    const again = await book(listing.id, stay(), { "idempotency-key": "3f7c1c9e-5a55-4a1e-9f1c-0000000000aa" });
    expect(again.body.reference).toBe(first.body.reference);
    expect(await db.accommodationBooking.count()).toBe(1);
  });

  it("the operator sees and confirms its own bookings; another organisation can't see or change them", async () => {
    const mine = await operatorWithListing({});
    const other = await operatorWithListing({});
    const request1 = await book(mine.listing.id, stay());
    const booking = await db.accommodationBooking.findFirstOrThrow({ where: { reference: request1.body.reference } });

    const list = await inbox(mine.token, mine.organisation.id);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      reference: request1.body.reference, status: "REQUESTED", nights: 3, adults: 2, children: 1,
      guestName: "Efua Mensah", guestEmail: "efua@guest.test", guestPhone: "+233241234567", specialRequest: "Late arrival, around 22:00.",
      listing: { id: mine.listing.id, title: mine.listing.title },
    });

    // Organisation B: its own inbox is empty; asking for A's inbox or changing A's booking is refused.
    expect((await inbox(other.token, other.organisation.id)).body.items).toHaveLength(0);
    expect((await inbox(other.token, mine.organisation.id)).status).toBe(403);
    expect((await decide(other.token, booking.id, "CONFIRMED")).status).toBe(403);
    expect((await db.accommodationBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("REQUESTED");

    const confirmed = await decide(mine.token, booking.id, "CONFIRMED");
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe("CONFIRMED");
    // Idempotent: confirming again changes nothing and sends no second email.
    expect((await decide(mine.token, booking.id, "CONFIRMED")).status).toBe(200);
    const confirmations = (await emails()).filter((email) => email.template === "ACCOMMODATION_BOOKING_CONFIRMED");
    expect(confirmations).toEqual([expect.objectContaining({ recipientEmail: "efua@guest.test" })]);
    // A confirmed stay can be cancelled, but no longer declined.
    expect((await decide(mine.token, booking.id, "DECLINED")).status).toBe(409);
    expect((await decide(mine.token, booking.id, "CANCELLED")).body.status).toBe("CANCELLED");
  });

  it("the operator can decline a request, and the guest is told", async () => {
    const mine = await operatorWithListing({});
    const request1 = await book(mine.listing.id, stay());
    const booking = await db.accommodationBooking.findFirstOrThrow({ where: { reference: request1.body.reference } });
    expect((await decide(mine.token, booking.id, "DECLINED")).body.status).toBe("DECLINED");
    expect((await emails()).some((email) => email.template === "ACCOMMODATION_BOOKING_DECLINED")).toBe(true);
    expect((await decide(mine.token, booking.id, "CONFIRMED")).status).toBe(409);
  });

  it("an anonymous caller can't change a booking", async () => {
    const mine = await operatorWithListing({});
    const request1 = await book(mine.listing.id, stay());
    const booking = await db.accommodationBooking.findFirstOrThrow({ where: { reference: request1.body.reference } });
    as();
    const response = await bookingStatusRoute(new Request(`${ORIGIN}/api/accommodation-bookings/${booking.id}`, { method: "PATCH", body: JSON.stringify({ status: "CONFIRMED" }) }), { params: Promise.resolve({ bookingId: booking.id }) });
    expect(response.status).toBe(401);
  });

  it("search by category returns only that category, with per-night pricing and stay details", async () => {
    await operatorWithListing({ category: "HOTEL", title: "The Hotel" });
    await operatorWithListing({ category: "SHORT_STAY", title: "The Short Stay" });
    await operatorWithListing({ category: "WAREHOUSE", title: "The Warehouse", frequency: "MONTHLY", rentAmountMinor: "1500000", maxGuests: undefined, minimumNights: undefined, checkInTime: undefined, checkOutTime: undefined });
    for (const [category, title] of [["HOTEL", "The Hotel"], ["SHORT_STAY", "The Short Stay"], ["WAREHOUSE", "The Warehouse"]]) {
      const response = await searchRoute(new Request(`${ORIGIN}/api/public/listings?category=${category}`));
      const body = await response.json();
      expect(body.items.map((item: { title: string }) => item.title)).toEqual([title]);
      const item = body.items[0];
      if (category === "WAREHOUSE") {
        expect(item).toMatchObject({ bookable: false, stay: null });
      } else {
        expect(item).toMatchObject({ bookable: true, pricing: { frequency: "PER_NIGHT" }, stay: { maxGuests: 4, minimumNights: 2, checkInTime: "14:00", checkOutTime: "11:00" } });
      }
    }
  });

  it("listing rules: hotels and short stays are nightly rentals, and only they carry stay details", async () => {
    await expect(operatorWithListing({ category: "HOTEL", frequency: "MONTHLY" }, false)).rejects.toMatchObject({ name: "ZodError" });
    await expect(operatorWithListing({ category: "SHORT_STAY", listingType: "SALE", rentAmountMinor: null, askingAmountMinor: "100000000", frequency: null }, false)).rejects.toMatchObject({ name: "ZodError" });
    await expect(operatorWithListing({ category: "APARTMENT", frequency: "PER_NIGHT" }, false)).rejects.toMatchObject({ name: "ZodError" });
    await expect(operatorWithListing({ category: "APARTMENT", frequency: "MONTHLY" }, false)).rejects.toMatchObject({ name: "ZodError" });
    await expect(operatorWithListing({ category: "APARTMENT", frequency: "MONTHLY", maxGuests: undefined, minimumNights: undefined, checkInTime: undefined, checkOutTime: undefined }, false)).resolves.toBeTruthy();
  });

  describe("listings marketed by an agency (marketplace professional)", () => {
    /** Agency X (owner + agent + a removed agent), agency Y, and a stranger. */
    async function agencies() {
      n += 1;
      const xOwner = await registerUser({ displayName: "Xena Owner", email: `x-owner-${n}@agency.test`, password: "secure-password-123" });
      const xAgent = await registerUser({ displayName: "Kwesi Agent", email: `x-agent-${n}@agency.test`, password: "secure-password-123" });
      const xRemoved = await registerUser({ displayName: "Removed Agent", email: `x-removed-${n}@agency.test`, password: "secure-password-123" });
      const yOwner = await registerUser({ displayName: "Yaa Owner", email: `y-owner-${n}@agency.test`, password: "secure-password-123" });
      const stranger = await registerUser({ displayName: "Stranger", email: `stranger-${n}@agency.test`, password: "secure-password-123" });
      const x = await createMarketplaceProfessional(xOwner.id, { type: "BROKERAGE", displayName: `Xcel Stays ${n}`, countryCode: "GH" });
      const y = await createMarketplaceProfessional(yOwner.id, { type: "BROKERAGE", displayName: `Yield Stays ${n}`, countryCode: "GH" });
      await addMarketplaceMember(xOwner.id, x.id, { email: xAgent.email, role: "AGENT" });
      const removed = await addMarketplaceMember(xOwner.id, x.id, { email: xRemoved.email, role: "AGENT" });
      await db.marketplaceProfessionalMember.update({ where: { id: removed.id }, data: { status: "REMOVED" } });
      const token = async (userId: string) => (await createSessionRecord(userId)).token;
      return {
        x, y,
        xOwner: await token(xOwner.id), xAgent: await token(xAgent.id), xRemoved: await token(xRemoved.id),
        yOwner: await token(yOwner.id), stranger: await token(stranger.id),
      };
    }

    /** A landlord organisation's own listing, marketed by an agency (third-party attribution). */
    async function marketedBy(professionalId: string, overrides: ListingOverrides) {
      const landlord = await operatorWithListing(overrides);
      await db.listing.update({ where: { id: landlord.listing.id }, data: { marketplaceProfessionalId: professionalId } });
      return landlord;
    }

    async function agencyInbox(token: string, professionalId: string, query = "") {
      as(token);
      const { NextRequest } = await import("next/server");
      const response = await agencyBookingsRoute(new NextRequest(`${ORIGIN}/api/marketplace-professionals/${professionalId}/bookings${query}`, { headers: request.headers }), { params: Promise.resolve({ professionalId }) });
      return { status: response.status, body: await response.json() };
    }

    it.each(["HOTEL", "SHORT_STAY"])("a %s booking on an agency-marketed listing is stored once, routed to the landlord, and shown to that agency only", async (category) => {
      const team = await agencies();
      const landlord = await marketedBy(team.x.id, { category, title: `Marketed ${category}` });
      const result = await book(landlord.listing.id, stay());
      expect(result.status).toBe(201);
      // The public answer names neither the landlord nor the agency, and carries no guest contact details.
      expect(JSON.stringify(result.body)).not.toMatch(/organisation|professional|Xcel|Operator|efua@guest|233241234567|Late arrival/i);

      const bookings = await db.accommodationBooking.findMany({ where: { listingId: landlord.listing.id } });
      expect(bookings).toHaveLength(1);
      // Agency visibility never changes the recipient: the landlord organisation owns it.
      expect(bookings[0].organisationId).toBe(landlord.organisation.id);
      expect(bookings[0].organisationId).not.toBe(team.x.backingOrganisationId);
      expect(bookings[0].accommodationType).toBe(category);
      // And the operator email goes to the listing's creator (the landlord), not to the agency.
      const operatorEmails = (await emails()).filter((email) => email.template === "ACCOMMODATION_BOOKING_REQUESTED");
      expect(operatorEmails).toEqual([expect.objectContaining({ userId: landlord.owner.id })]);

      // Agency X (owner and agent) sees it, with the details it needs to act on it.
      for (const token of [team.xOwner, team.xAgent]) {
        const inbox = await agencyInbox(token, team.x.id);
        expect(inbox.status).toBe(200);
        expect(inbox.body.items).toEqual([expect.objectContaining({
          reference: result.body.reference, status: "REQUESTED", accommodationType: category,
          listing: expect.objectContaining({ id: landlord.listing.id }),
          guestName: "Efua Mensah", guestEmail: "efua@guest.test", guestPhone: "+233241234567",
        })]);
        // Nothing beyond the intended operator view: no idempotency binding, internal ids or responder.
        for (const internal of ["organisationId", "idempotencyKeyHash", "idempotencyFingerprint", "userId", "respondedByUserId"]) {
          expect(inbox.body.items[0]).not.toHaveProperty(internal);
        }
      }
      // The landlord organisation still sees it in its own inbox.
      expect((await inbox(landlord.token, landlord.organisation.id)).body.items).toHaveLength(1);
      // Agency Y sees nothing in its own inbox, and can't open X's.
      expect((await agencyInbox(team.yOwner, team.y.id)).body.items).toHaveLength(0);
      expect((await agencyInbox(team.yOwner, team.x.id)).status).toBe(403);
    });

    it("a non-member, a removed member and an anonymous caller can't read an agency's bookings", async () => {
      const team = await agencies();
      const landlord = await marketedBy(team.x.id, {});
      await book(landlord.listing.id, stay());
      expect((await agencyInbox(team.stranger, team.x.id)).status).toBe(403);
      expect((await agencyInbox(team.xRemoved, team.x.id)).status).toBe(403);
      as();
      const { NextRequest } = await import("next/server");
      const anonymous = await agencyBookingsRoute(new NextRequest(`${ORIGIN}/api/marketplace-professionals/${team.x.id}/bookings`), { params: Promise.resolve({ professionalId: team.x.id }) });
      expect(anonymous.status).toBe(401);
    });

    it("an authorised agency member confirms and cancels within the status rules; another agency and non-members can't", async () => {
      const team = await agencies();
      const landlord = await marketedBy(team.x.id, {});
      const sent = await book(landlord.listing.id, stay());
      const booking = await db.accommodationBooking.findFirstOrThrow({ where: { reference: sent.body.reference } });

      for (const outsider of [team.yOwner, team.stranger, team.xRemoved]) {
        for (const status of ["CONFIRMED", "DECLINED", "CANCELLED"]) expect((await decide(outsider, booking.id, status)).status).toBe(403);
      }
      expect((await db.accommodationBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("REQUESTED");

      // The agency's agent lists it (with its full details) and confirms it…
      expect((await agencyInbox(team.xAgent, team.x.id, "?status=REQUESTED")).body.items.map((item: { id: string }) => item.id)).toEqual([booking.id]);
      const confirmed = await decide(team.xAgent, booking.id, "CONFIRMED");
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.status).toBe("CONFIRMED");
      expect((await agencyInbox(team.xAgent, team.x.id, "?status=CONFIRMED")).body.items).toHaveLength(1);
      // …the usual rules still apply: a confirmed stay can't be declined, but can be cancelled.
      expect((await decide(team.xAgent, booking.id, "DECLINED")).status).toBe(409);
      expect((await decide(team.xOwner, booking.id, "CANCELLED")).body.status).toBe("CANCELLED");
      // Deciding never moves the booking: it still belongs to the landlord organisation.
      expect((await db.accommodationBooking.findUniqueOrThrow({ where: { id: booking.id } })).organisationId).toBe(landlord.organisation.id);
      expect((await emails()).filter((email) => email.template === "ACCOMMODATION_BOOKING_CONFIRMED" || email.template === "ACCOMMODATION_BOOKING_CANCELLED")).toHaveLength(2);
    });

    it("an agency member can decline a request", async () => {
      const team = await agencies();
      const landlord = await marketedBy(team.x.id, { category: "SHORT_STAY" });
      const sent = await book(landlord.listing.id, stay());
      const booking = await db.accommodationBooking.findFirstOrThrow({ where: { reference: sent.body.reference } });
      expect((await decide(team.xAgent, booking.id, "DECLINED")).body.status).toBe("DECLINED");
      expect((await decide(team.xAgent, booking.id, "CONFIRMED")).status).toBe(409);
    });

    it("an agency can't reach bookings on a listing it no longer markets", async () => {
      const team = await agencies();
      const landlord = await marketedBy(team.x.id, {});
      const sent = await book(landlord.listing.id, stay());
      const booking = await db.accommodationBooking.findFirstOrThrow({ where: { reference: sent.body.reference } });
      // Attribution moves to agency Y.
      await db.listing.update({ where: { id: landlord.listing.id }, data: { marketplaceProfessionalId: team.y.id } });
      expect((await agencyInbox(team.xOwner, team.x.id)).body.items).toHaveLength(0);
      expect((await decide(team.xOwner, booking.id, "CONFIRMED")).status).toBe(403);
      expect((await agencyInbox(team.yOwner, team.y.id)).body.items).toHaveLength(1);
    });
  });
});
