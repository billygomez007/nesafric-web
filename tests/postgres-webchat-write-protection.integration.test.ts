import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { POST as leadRoute } from "@/app/api/public/listings/[listingId]/leads/route";
import { POST as startChatRoute } from "@/app/api/public/webchat/conversations/route";
import { POST as chatViewingRoute } from "@/app/api/public/webchat/conversations/[conversationId]/viewing-requests/route";
import { createProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import { createListing, transitionListing, updateListingVerification } from "@/modules/listings/service";
import { createOrganisation } from "@/modules/organisations/service";
import { db } from "@/platform/database/client";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "PublicWriteCounter", "PublicIdempotencyRecord" CASCADE');
}

const ORIGINAL_VERCEL = process.env.VERCEL;

async function publishedListing() {
  const owner = await registerUser({ displayName: "Ama Owner", email: "owner@webchat-abuse.test", password: "secure-password-123" });
  const organisation = await createOrganisation(owner.id, { name: "Accra Estates", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
  const property = await createProperty(owner.id, organisation.id, { name: "Sunset Ridge", referenceNumber: "SR-WC", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
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

function jsonRequest(url: string, body: unknown, ip: string) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify(body) });
}

describe("public web chat cannot bypass guest enquiry / viewing limits", () => {
  beforeEach(async () => {
    await cleanDatabase();
    process.env.VERCEL = "1";
  });
  afterEach(() => {
    if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = ORIGINAL_VERCEL;
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("shares the per-contact enquiry budget between the listing form and web chat", async () => {
    const listing = await publishedListing();
    const phone = "+233 24 555 0101";
    for (let n = 0; n < 3; n++) {
      const response = await leadRoute(jsonRequest(`https://nesafric.test/api/public/listings/${listing.id}/leads`, { name: "Kofi", phone }, `41.66.3.${n}`), { params: Promise.resolve({ listingId: listing.id }) });
      expect(response.status).toBe(201);
    }
    const statuses: number[] = [];
    for (let n = 0; n < 3; n++) {
      const response = await startChatRoute(jsonRequest("https://nesafric.test/api/public/webchat/conversations", { listingId: listing.id, visitorName: "Kofi", visitorPhone: "0245550101", message: `Hello ${n}` }, `41.66.4.${n}`));
      statuses.push(response.status);
    }
    // 5 per contact per hour across both paths: 3 form + 2 chat pass, the 3rd chat is refused.
    expect(statuses).toEqual([201, 201, 429]);
    expect(await db.marketplaceLead.count({ where: { listingId: listing.id } })).toBe(5);
  });

  it("limits web chat viewing requests per lead, after verifying the chat token", async () => {
    const listing = await publishedListing();
    const start = await startChatRoute(jsonRequest("https://nesafric.test/api/public/webchat/conversations", { listingId: listing.id, visitorName: "Ama", visitorEmail: "ama@example.com", message: "Can I view it?" }, "41.66.5.1"));
    const conversation = await start.json();
    const chatToken: string = conversation.chatToken;
    expect(conversation.marketplaceLeadId).toBeTruthy();
    expect(typeof chatToken).toBe("string");
    const base = Date.now();
    const viewing = (n: number, token = chatToken) => ({
      chatToken: token,
      preferredTimes: [{ startsAt: new Date(base + (n + 1) * 86_400_000).toISOString(), endsAt: new Date(base + (n + 1) * 86_400_000 + 3_600_000).toISOString(), timezone: "Africa/Accra" }],
    });
    const call = (body: unknown, ip: string) =>
      chatViewingRoute(jsonRequest(`https://nesafric.test/api/public/webchat/conversations/${conversation.conversationId}/viewing-requests`, body, ip), { params: Promise.resolve({ conversationId: conversation.conversationId }) });

    // A caller without the chat token is refused before any budget is spent.
    for (let n = 0; n < 5; n++) expect((await call(viewing(n, "x".repeat(32)), "6.6.6.6")).status).toBe(401);
    const statuses = [];
    for (let n = 0; n < 4; n++) statuses.push((await call(viewing(n), `41.66.5.${10 + n}`)).status);
    expect(statuses).toEqual([201, 201, 201, 429]);
  });
});
