import { describe, expect, it } from "vitest";
import { isLeaseRentPeriod, LISTING_PRICE_UNITS, PRICE_UNIT_LABELS, priceUnitsFor, priceUnitSuffix } from "@/lib/price-units";
import { priceUnitText, specLine } from "@/lib/listing-display";
import { createListingSchema, publicListingSearchSchema } from "@/modules/listings/schemas";

const listing = (listingType: "RENT" | "SALE", frequency: string | null) => ({
  propertyId: "6e2d1c4b-0000-4000-8000-000000000001", listingType, category: "LAND", title: "Serviced plot", publicDescription: "A serviced plot close to the main road in Oyarifa.",
  ...(listingType === "SALE" ? { askingAmountMinor: "120000" } : { rentAmountMinor: "120000" }), currencyCode: "GHS", frequency, availableFrom: "2026-10-01", countryCode: "GH",
});

describe("listing price units", () => {
  it("supports per day, month, year, square metre and kilometre with customer-facing labels, keeping quarterly and custom", () => {
    expect(LISTING_PRICE_UNITS).toEqual(["DAILY", "MONTHLY", "QUARTERLY", "ANNUAL", "PER_SQM", "PER_KM", "CUSTOM"]);
    expect([PRICE_UNIT_LABELS.DAILY, PRICE_UNIT_LABELS.MONTHLY, PRICE_UNIT_LABELS.ANNUAL, PRICE_UNIT_LABELS.PER_SQM, PRICE_UNIT_LABELS.PER_KM])
      .toEqual(["Per day", "Per month", "Per year", "Per square metre (m²)", "Per kilometre (km)"]);
    expect(priceUnitsFor("SALE")).toEqual(["PER_SQM", "PER_KM"]);
  });

  it("formats the unit after the price, never confusing it with area", () => {
    expect(priceUnitSuffix("RENT", "DAILY")).toBe("/day");
    expect(priceUnitSuffix("RENT", "MONTHLY")).toBe("/month");
    expect(priceUnitSuffix("RENT", "ANNUAL")).toBe("/year");
    expect(priceUnitSuffix("SALE", "PER_SQM")).toBe("/m²");
    expect(priceUnitSuffix("SALE", "PER_KM")).toBe("/km");
    expect(priceUnitSuffix("SALE", null)).toBe("");
    expect(priceUnitSuffix("SALE", "MONTHLY")).toBe("");
    expect(priceUnitSuffix("RENT", "CUSTOM")).toBe("");
    expect(priceUnitText("SALE", "PER_SQM")).toBe("m²");
    // Area is still shown separately as area.
    expect(specLine({ bedrooms: null, bathrooms: null, sizeSqm: "750" })).toEqual(["750 m²"]);
  });

  it("validates units per listing type in the API schema", () => {
    for (const unit of LISTING_PRICE_UNITS) expect(createListingSchema.safeParse(listing("RENT", unit)).success).toBe(true);
    expect(createListingSchema.safeParse(listing("RENT", null)).success).toBe(false);
    expect(createListingSchema.safeParse(listing("SALE", null)).success).toBe(true);
    expect(createListingSchema.safeParse(listing("SALE", "PER_SQM")).success).toBe(true);
    expect(createListingSchema.safeParse(listing("SALE", "PER_KM")).success).toBe(true);
    expect(createListingSchema.safeParse(listing("SALE", "DAILY")).success).toBe(false);
    expect(createListingSchema.safeParse(listing("SALE", "ANNUAL")).success).toBe(false);
    expect(createListingSchema.safeParse(listing("RENT", "HOURLY")).success).toBe(false);
    expect(publicListingSearchSchema.parse({ frequency: "PER_KM" }).frequency).toBe("PER_KM");
  });

  it("only rent periods can seed a lease", () => {
    expect(["MONTHLY", "QUARTERLY", "ANNUAL", "CUSTOM"].every(isLeaseRentPeriod)).toBe(true);
    expect(["DAILY", "PER_SQM", "PER_KM", null].some(isLeaseRentPeriod)).toBe(false);
  });
});
