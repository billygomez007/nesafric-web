import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import { createMarketplaceNativeListing, submitMarketplaceListingForReview } from "@/modules/listings/service";
import { verifyAndPublishListingForPlatform } from "@/modules/platform-admin/service";
import { allText, configureAssistantEnv, converse, FakeGraphApi, optionIds, textOf } from "./helpers/whatsapp-assistant";

/**
 * Customer journeys on the NesAfric WhatsApp assistant, end to end: signed webhook → durable
 * inbound record → conversation engine → existing listing/lead/viewing services → outbound queue.
 */

const CUSTOMER = "233241111111";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "WhatsAppContact", "WhatsAppAction", "WhatsAppAssistantEvent", "BackgroundJob" CASCADE');
}

const PHOTO = "https://images.nesafric.com/public/properties/test/cover.jpg";

async function publishedListing(input: { title: string; locality: string; city: string; bedrooms: number; rentMinor: string; category?: string }) {
  const owner = await registerUser({ displayName: "Agent Owner", email: `owner-${input.title.length}-${Date.now()}@example.com`, password: "secure-password-123" });
  const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: `Brokerage ${input.title}`, countryCode: "GH" });
  const listing = await createMarketplaceNativeListing(owner.id, professional.id, {
    asset: {
      name: input.title, category: input.category ?? "APARTMENT", purpose: "RENT", bedrooms: input.bedrooms, bathrooms: 2, currencyCode: "GHS", priceMinor: input.rentMinor,
      countryCode: "GH", city: input.city, locality: input.locality, amenities: [], mediaUrls: [], availableFrom: "2026-01-01", authorityEvidenceReady: true,
    },
    listing: {
      listingType: "RENT", category: input.category ?? "APARTMENT", title: input.title, publicDescription: "A bright, secure apartment close to shops and schools.",
      rentAmountMinor: input.rentMinor, currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-01-01",
      countryCode: "GH", city: input.city, locality: input.locality, media: [{ type: "PHOTO", publicUrl: PHOTO }],
      amenities: [{ key: "parking", label: "Parking" }],
    },
    listingAuthority: "MANAGING_AGENT",
  });
  await submitMarketplaceListingForReview(owner.id, professional.id, listing.id, { evidence: { type: "owner_mandate", reference: "Mandate on file" } });
  const adminUser = await registerUser({ displayName: "Admin", email: `admin-${Date.now()}-${input.bedrooms}@example.com`, password: "secure-password-123" });
  const admin = await db.platformPrincipal.create({ data: { userId: adminUser.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
  const fresh = await db.listing.findUniqueOrThrow({ where: { id: listing.id } });
  await verifyAndPublishListingForPlatform(admin, listing.id, { expectedUpdatedAt: fresh.updatedAt });
  return { listing, owner, professional };
}

describe("WhatsApp assistant — customer property journeys", () => {
  const api = new FakeGraphApi();
  beforeAll(() => { configureAssistantEnv(); api.install(); });
  beforeEach(async () => { await cleanDatabase(); api.take(); });
  afterAll(async () => { api.uninstall(); await cleanDatabase(); await db.$disconnect(); });

  it("greets a new contact with the main menu", async () => {
    const replies = await converse(api, CUSTOMER, { text: "Hi" });
    expect(replies).toHaveLength(1);
    expect(textOf(replies[0])).toContain("Welcome to NesAfric");
    expect(optionIds(replies[0])).toEqual(expect.arrayContaining(["menu:property_search", "menu:service_search", "menu:list_property", "menu:support"]));
  });

  it("searches real published listings from a natural-language request and never invents results", async () => {
    const { listing } = await publishedListing({ title: "Two-bedroom apartment, East Legon", locality: "East Legon", city: "Accra", bedrooms: 2, rentMinor: "400000" });
    await publishedListing({ title: "Three-bedroom house, Kumasi", locality: "Ahodwo", city: "Kumasi", bedrooms: 3, rentMinor: "300000" });

    const first = await converse(api, CUSTOMER, { text: "I need a two-bedroom apartment in East Legon" });
    expect(allText(first)).toMatch(/rent or buy/i);

    await converse(api, CUSTOMER, { text: "Rent" });
    const results = await converse(api, CUSTOMER, { text: "Around GHS 4,000" });
    const text = allText(results);
    expect(text).toContain("Two-bedroom apartment, East Legon");
    expect(text).not.toContain("Kumasi");
    expect(text).toContain(`/marketplace/properties/${listing.id}`);
    expect(text).toContain("✅ Verified by NesAfric");
    // Photo cards use the listing's stored public image.
    expect(results.some((message) => message.type === "image" && (message.image as { link: string }).link === PHOTO)).toBe(true);
    const menu = results.at(-1)!;
    expect(optionIds(menu)).toContain(`ps:ask:${listing.id}`);
    expect(await db.whatsAppAssistantEvent.count({ where: { name: "property_search" } })).toBe(1);
  });

  it("reports a genuine zero-result search and offers to broaden it", async () => {
    await publishedListing({ title: "Two-bedroom apartment, East Legon", locality: "East Legon", city: "Accra", bedrooms: 2, rentMinor: "400000" });
    await converse(api, CUSTOMER, { text: "3 bedroom house for rent in Adenta" });
    const replies = await converse(api, CUSTOMER, { text: "skip" });
    expect(allText(replies)).toMatch(/couldn't find any verified, published/i);
    expect(optionIds(replies.at(-1)!)).toEqual(expect.arrayContaining(["ps:widen", "ps:new"]));
    expect(await db.whatsAppAssistantEvent.count({ where: { name: "property_search_zero" } })).toBe(1);
  });

  it("sends an inquiry and a viewing request through the existing lead and viewing services", async () => {
    const { listing, owner } = await publishedListing({ title: "Two-bedroom apartment, East Legon", locality: "East Legon", city: "Accra", bedrooms: 2, rentMinor: "400000" });
    await converse(api, CUSTOMER, { text: "apartment for rent in East Legon" });
    await converse(api, CUSTOMER, { text: "skip" });
    const opened = await converse(api, CUSTOMER, { choice: `ps:ask:${listing.id}` });
    expect(allText(opened)).toMatch(/What would you like to know/);

    const answered = await converse(api, CUSTOMER, { text: "Is there parking and how much is it?" });
    const answer = allText(answered);
    expect(answer).toContain("Parking");
    expect(answer).toMatch(/GH₵4,000\/month/);

    await converse(api, CUSTOMER, { choice: "pi:send" });
    const sent = await converse(api, CUSTOMER, { text: "Kofi Boateng" });
    expect(allText(sent)).toMatch(/NES-IQ-[0-9A-F]{8}/);
    const leads = await db.marketplaceLead.findMany({ where: { listingId: listing.id } });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ name: "Kofi Boateng", phone: "+233241111111", source: "whatsapp" });
    // The listing's agent is notified through the existing notification pipeline.
    expect(await db.backgroundJob.count({ where: { idempotencyKey: `account-email:MARKETPLACE_LEAD_CREATED:${leads[0].id}` } })).toBe(1);
    expect(owner.id).toBe((await db.listing.findUniqueOrThrow({ where: { id: listing.id } })).createdByUserId);

    await converse(api, CUSTOMER, { choice: `pi:viewing:${listing.id}` });
    const confirm = await converse(api, CUSTOMER, { text: "tomorrow 10am" });
    expect(optionIds(confirm.at(-1)!)).toContain("pi:time:yes");
    const requested = await converse(api, CUSTOMER, { choice: "pi:time:yes" });
    const requestedText = allText(requested);
    expect(requestedText).toMatch(/Viewing \*requested\*/);
    expect(requestedText).toMatch(/not confirmed yet/);
    const viewings = await db.viewingRequest.findMany({ where: { listingId: listing.id } });
    expect(viewings).toHaveLength(1);
    expect(viewings[0]).toMatchObject({ status: "REQUESTED", leadId: leads[0].id });
    // The viewing reused the existing lead instead of creating a second one.
    expect(await db.marketplaceLead.count({ where: { listingId: listing.id } })).toBe(1);
  });

  it("does not process a duplicate webhook delivery twice", async () => {
    const { listing } = await publishedListing({ title: "Two-bedroom apartment, East Legon", locality: "East Legon", city: "Accra", bedrooms: 2, rentMinor: "400000" });
    await converse(api, CUSTOMER, { text: "apartment for rent in East Legon" });
    await converse(api, CUSTOMER, { text: "skip" });
    await converse(api, CUSTOMER, { choice: `ps:ask:${listing.id}` });
    await converse(api, CUSTOMER, { text: "Is it still available?" });
    await converse(api, CUSTOMER, { choice: "pi:send" });
    const first = await converse(api, CUSTOMER, { text: "Kofi" }, { messageId: "wamid.duplicate-1" });
    expect(first.length).toBeGreaterThan(0);
    const repeat = await converse(api, CUSTOMER, { text: "Kofi" }, { messageId: "wamid.duplicate-1" });
    expect(repeat).toHaveLength(0);
    expect(await db.marketplaceLead.count()).toBe(1);
    expect(await db.whatsAppInboundMessage.count({ where: { waMessageId: "wamid.duplicate-1" } })).toBe(1);
  });
});
