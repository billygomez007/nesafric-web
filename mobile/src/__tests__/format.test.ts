import { formatFacts, formatListingPrice, formatLocation, formatMoney, humanise, listingPhotos, resolveMediaUrl } from "@/marketplace/format";
import { listing } from "@/test-utils/fixtures";

describe("formatMoney", () => {
  it("formats minor units with the cedi symbol and thousands separators", () => {
    expect(formatMoney("850000", "GHS")).toBe("GH₵8,500");
    expect(formatMoney("85000000", "GHS")).toBe("GH₵850,000");
    expect(formatMoney("5", "GHS")).toBe("GH₵0.05");
    expect(formatMoney("123456", "USD")).toBe("US$1,234.56");
    expect(formatMoney("100", "XOF")).toBe("XOF 1");
  });
});

describe("formatListingPrice", () => {
  it("adds the rent frequency", () => {
    expect(formatListingPrice(listing())).toBe("GH₵8,500/month");
    expect(formatListingPrice(listing({ pricing: { askingAmountMinor: null, rentAmountMinor: "2400000", currencyCode: "USD", frequency: "ANNUAL" } }))).toBe("US$24,000/year");
  });

  it("uses the asking price for sales and returns null without a price", () => {
    expect(formatListingPrice(listing({ listingType: "SALE", pricing: { askingAmountMinor: "85000000", rentAmountMinor: null, currencyCode: "GHS", frequency: null } }))).toBe("GH₵850,000");
    expect(formatListingPrice(listing({ pricing: { askingAmountMinor: null, rentAmountMinor: null, currencyCode: "GHS", frequency: null } }))).toBeNull();
  });
});

describe("listing details formatting", () => {
  it("builds facts without inventing missing values", () => {
    expect(formatFacts({ bedrooms: 4, bathrooms: "4", sizeSqm: "320" })).toBe("4 Beds · 4 Baths · 320 m²");
    expect(formatFacts({ bedrooms: 1, bathrooms: "1.5", sizeSqm: null })).toBe("1 Bed · 1.5 Baths");
    expect(formatFacts({ bedrooms: null, bathrooms: null, sizeSqm: "1200" })).toBe("1,200 m²");
  });

  it("prefers the public location label", () => {
    expect(formatLocation(listing().location)).toBe("East Legon, Accra");
    expect(formatLocation({ ...listing().location, label: "Near A&C Mall" })).toBe("Near A&C Mall");
  });

  it("humanises enum values", () => {
    expect(humanise("GUEST_HOUSE")).toBe("Guest house");
  });

  it("returns public photos cover-first with absolute URLs", () => {
    const photos = listingPhotos(listing().media, "https://api.example.com");
    expect(photos.map((photo) => photo.id)).toEqual(["m1", "m2"]);
    expect(photos[1].url).toBe("https://api.example.com/api/public/media/b.jpg");
    expect(resolveMediaUrl("https://x.test/a.jpg", "https://api.example.com")).toBe("https://x.test/a.jpg");
  });
});
