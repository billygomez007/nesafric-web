import { describe, expect, it, vi } from "vitest";
import { coverPhoto, formatAmount, priceLabel, propertyCard, propertyDetailsMessage, resultsNavigation, type PublicListing } from "@/modules/whatsapp-assistant/property-cards";
import { advanceConversation } from "@/modules/whatsapp-assistant/engine";
import { graphInteractive, whatsappInteractiveSchema } from "@/modules/conversations/channels/whatsapp-interactive";

const ID = "2c7e1b3a-4d5f-4a6b-8c9d-0e1f2a3b4c5d";

function listing(overrides: Partial<PublicListing> = {}): PublicListing {
  return {
    id: ID, isTopAd: false, listingType: "RENT", scope: "UNIT", source: "PROPERTY_OS", category: "APARTMENT",
    title: "1-Bedroom Apartment in North Dzorwulu", description: "Bright apartment with a balcony, fitted kitchen and backup water.",
    pricing: { askingAmountMinor: null, rentAmountMinor: "125000", currencyCode: "GHS", frequency: "PER_NIGHT" },
    availability: { availableFrom: new Date("2026-11-01"), actual: true },
    attributes: { bedrooms: 1, bathrooms: "1", sizeSqm: "64" },
    bookable: false, stay: null,
    location: { countryCode: "GH", region: "Greater Accra", city: "Accra", district: null, locality: "North Dzorwulu", label: "North Dzorwulu, Accra", map: {} },
    amenities: [{ key: "parking", label: "Parking", category: null, metadata: null }, { key: "water", label: "Backup water", category: null, metadata: null }],
    media: [
      { id: "m1", type: "PHOTO", url: "https://storage.googleapis.com/nesafric-public/a.jpg", isCover: false, sortOrder: 0 },
      { id: "m2", type: "PHOTO", url: "https://storage.googleapis.com/nesafric-public/cover.jpg", isCover: true, sortOrder: 1 },
    ],
    contact: { name: "Owusu Realty", email: null, phone: null, enquiryEnabled: true },
    verification: { status: "VERIFIED" },
    ...overrides,
  } as unknown as PublicListing;
}

describe("property card details come from the listing record", () => {
  it("formats prices with grouping, the period for rent, and a sale price for sales", () => {
    expect(formatAmount("125000", "GHS")).toBe("GHS 1,250");
    expect(formatAmount("123456789", "GHS")).toBe("GHS 1,234,567.89");
    expect(formatAmount("99999999999999999900", "GHS")).toBe("GHS 999,999,999,999,999,999");
    expect(priceLabel(listing())).toBe("GHS 1,250 per night");
    expect(priceLabel(listing({ pricing: { askingAmountMinor: null, rentAmountMinor: "450000", currencyCode: "GHS", frequency: "MONTHLY" } }))).toBe("GHS 4,500 per month");
    expect(priceLabel(listing({ listingType: "SALE", pricing: { askingAmountMinor: "95000000", rentAmountMinor: null, currencyCode: "GHS", frequency: null } }))).toBe("GHS 950,000 sale price");
    expect(priceLabel(listing({ pricing: { askingAmountMinor: null, rentAmountMinor: null, currencyCode: "GHS", frequency: null } }))).toBe("Price on request");
  });

  it("shows the cover photo above the details with View, Ask and Book buttons", () => {
    const card = propertyCard(listing(), 1, 7);
    expect(whatsappInteractiveSchema.safeParse(card.interactive).success).toBe(true);
    expect(card.interactive).toMatchObject({
      type: "button", header: { type: "image", link: "https://storage.googleapis.com/nesafric-public/cover.jpg" }, footer: "Property 1 of 7",
      buttons: [{ id: `details ${ID}`, title: "View property" }, { id: `inquire ${ID}`, title: "Ask a question" }, { id: `view ${ID}`, title: "Book a viewing" }],
    });
    const body = card.interactive!.body;
    expect(body).toContain("*1-Bedroom Apartment in North Dzorwulu*");
    expect(body).toContain("🏠 Apartment for rent");
    expect(body).toContain("📍 North Dzorwulu, Accra");
    expect(body).toContain("🛏️ 1 bedroom | 🚿 1 bathroom");
    expect(body).toContain("💰 GHS 1,250 per night");
    expect(body).toContain("Bright apartment with a balcony");
    expect(card.body).toContain(`/marketplace/properties/${ID}`);
    expect(graphInteractive(card.interactive!)).toMatchObject({ type: "button", header: { type: "image", image: { link: "https://storage.googleapis.com/nesafric-public/cover.jpg" } } });
  });

  it("sends the card without an image when there is no usable public photo", () => {
    expect(coverPhoto([{ type: "PHOTO", url: "http://insecure.example/a.jpg", isCover: true }] as never)).toBeUndefined();
    expect(coverPhoto([{ type: "VIDEO", url: "https://x.example/v.mp4", isCover: true }] as never)).toBeUndefined();
    const card = propertyCard(listing({ media: [] }), 2, 2);
    expect(card.interactive).not.toHaveProperty("header");
    expect(whatsappInteractiveSchema.safeParse(card.interactive).success).toBe(true);
  });

  it("offers only View property for a listing that takes requests on its page only", () => {
    expect(propertyCard(listing({ contact: { name: null, email: null, phone: null, enquiryEnabled: false } } as never), 1, 1).interactive).toMatchObject({ buttons: [{ id: `details ${ID}` }] });
    expect(propertyCard(listing({ bookable: true, category: "SHORT_STAY" }), 1, 1).interactive).toMatchObject({ buttons: [{ id: `details ${ID}` }] });
  });

  it("stays within Meta's limits for long titles and descriptions", () => {
    const card = propertyCard(listing({ title: "T".repeat(300), description: "D".repeat(5000) }), 3, 30);
    expect(whatsappInteractiveSchema.safeParse(card.interactive).success).toBe(true);
    expect(card.interactive!.body.length).toBeLessThanOrEqual(1024);
  });

  it("describes studios and missing rooms correctly", () => {
    expect(propertyCard(listing({ attributes: { bedrooms: 0, bathrooms: "1", sizeSqm: null } }), 1, 1).interactive!.body).toContain("🛏️ Studio | 🚿 1 bathroom");
    expect(propertyCard(listing({ category: "LAND", attributes: { bedrooms: null, bathrooms: null, sizeSqm: null } }), 1, 1).interactive!.body).not.toContain("🛏️");
  });

  it("gives the full details with amenities, size and the listing link", () => {
    const details = propertyDetailsMessage(listing());
    expect(details.interactive).toMatchObject({ type: "button", header: { type: "image" }, buttons: [{ id: `inquire ${ID}` }, { id: `view ${ID}` }] });
    expect(details.body).toContain("✨ Parking, Backup water");
    expect(details.body).toContain("📐 64 m²");
    expect(details.body).toContain(`Full listing and photos: `);
  });

  it("pages on with Show more only when there is more", () => {
    expect(resultsNavigation({ from: 1, to: 3, total: 7 }, true).interactive).toMatchObject({ buttons: [{ id: "more" }, { id: "change filters" }, { id: "new search" }] });
    expect(resultsNavigation({ from: 7, to: 7, total: 7 }, false).interactive).toMatchObject({ buttons: [{ id: "change filters" }, { id: "new search" }] });
  });
});

describe("search replies send property cards in order", () => {
  const input = (body: string, state: unknown = {}) => ({ state, body, kind: "text", phone: "233241234567", conversationId: "c", messageId: "m", defaultCountry: "GH", defaultCurrency: "GHS" });

  it("returns the filters, then one card per listing, then the paging buttons", async () => {
    const listings = [listing(), listing({ id: "3d8f2c4b-5e6a-4b7c-9d0e-1f2a3b4c5d6e", title: "Second" })];
    const tools = { searchProperties: vi.fn(async () => ({ ids: listings.map((item) => item.id), hasMore: false, listings, total: 2, cards: [] })), propertyDetails: vi.fn(), searchServices: vi.fn(), submitCustomerRequest: vi.fn(), customerRequestStatus: vi.fn() };
    const interpret = vi.fn(async () => ({ intent: "property_search", property: { listingType: "RENT", location: "dzorwulu" } }));
    const result = await advanceConversation(input("rent in dzorwulu"), { tools: tools as never, interpret: interpret as never });
    expect(result.reply).toContain("Filters: RENT, dzorwulu");
    expect(result.extras).toHaveLength(3);
    expect(result.extras![0].interactive).toMatchObject({ header: { type: "image" }, footer: "Property 1 of 2" });
    expect(result.extras![1].interactive).toMatchObject({ footer: "Property 2 of 2" });
    expect(result.extras![2].interactive).toMatchObject({ buttons: [{ id: "change filters" }, { id: "new search" }] });
  });

  it("opens a card's property by its id, even from an earlier page", async () => {
    const tools = { propertyDetails: vi.fn(async () => ({ title: "x", description: "", enquiryEnabled: true, url: "u", listing: listing() })), searchProperties: vi.fn(), searchServices: vi.fn(), submitCustomerRequest: vi.fn(), customerRequestStatus: vi.fn() };
    const state = { workflow: "property_search", results: ["3d8f2c4b-5e6a-4b7c-9d0e-1f2a3b4c5d6e"], property: { listingType: "RENT", location: "osu" } };
    const details = await advanceConversation(input(`details ${ID}`, state), { tools: tools as never, interpret: vi.fn() as never });
    expect(tools.propertyDetails).toHaveBeenCalledWith(ID);
    expect(details.interactive).toMatchObject({ buttons: [{ id: `inquire ${ID}` }, { id: `view ${ID}` }] });
    const booking = await advanceConversation(input(`view ${ID}`, state), { tools: tools as never, interpret: vi.fn() as never });
    expect(booking.state).toMatchObject({ workflow: "viewing", step: "name", selectedListingId: ID });
  });
});
