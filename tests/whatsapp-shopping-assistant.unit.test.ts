import { describe, expect, it, vi } from "vitest";
import { advanceConversation } from "@/modules/whatsapp-assistant/engine";
import { interpretLocally } from "@/modules/whatsapp-assistant/interpret";
import { assistantStateSchema, initialState, type AssistantState } from "@/modules/whatsapp-assistant/schemas";
import { publicListingSearchSchema } from "@/modules/listings/schemas";
import { formatViewingTime, parseViewingTime } from "@/modules/whatsapp-assistant/viewing-time";

// Saturday 24 October 2026, 09:00 GMT.
const now = new Date("2026-10-24T09:00:00Z");
const listingIds = ["0b6f5f7e-8a7d-4c1b-9e3f-2a1b0c9d8e71", "0b6f5f7e-8a7d-4c1b-9e3f-2a1b0c9d8e72"];
const leadId = "4f1a7d2c-5b8e-4c3a-9d6f-1e2b3c4d5e61";
const viewingId = "4f1a7d2c-5b8e-4c3a-9d6f-1e2b3c4d5e62";

describe("WhatsApp shopping: viewing times", () => {
  it.each([
    ["tomorrow 2pm", "2026-10-25T14:00:00.000Z"],
    ["today at 4:30 pm", "2026-10-24T16:30:00.000Z"],
    ["Monday 10am", "2026-10-26T10:00:00.000Z"],
    ["saturday 11am", "2026-10-31T11:00:00.000Z"],
    ["this coming Saturday 11am", "2026-10-31T11:00:00.000Z"],
    ["20/12 14:00", "2026-12-20T14:00:00.000Z"],
    ["20/12/2026 2pm", "2026-12-20T14:00:00.000Z"],
    ["20.12.26 9.30am", "2026-12-20T09:30:00.000Z"],
    ["tomorrow 14.00", "2026-10-25T14:00:00.000Z"],
    ["20th December 3pm", "2026-12-20T15:00:00.000Z"],
    ["Dec 20 at 3:30pm", "2026-12-20T15:30:00.000Z"],
    ["2026-12-20 14:00", "2026-12-20T14:00:00.000Z"],
    ["2026-12-20T14:00:00+00:00", "2026-12-20T14:00:00.000Z"],
    ["5 jan noon", "2027-01-05T12:00:00.000Z"],
    ["1 oct 10am", "2027-10-01T10:00:00.000Z"],
  ])("reads %s as Ghana time", (text, expected) => {
    expect(parseViewingTime(text, now)?.toISOString()).toBe(expected);
  });

  it.each([
    "sometime next week", "tomorrow", "tomorrow evening", "maybe 2pm", "next month 2pm", "yesterday 2pm",
    "today 8am", "31/02 10am", "2027-02-31T10:00:00Z", "2026-11-31T10:00:00+00:00", "13pm tomorrow", "2025-01-01T10:00:00Z", "2028-12-20 14:00",
    "Saturday next week 10am", "next saturday 10am", "last Saturday 10am", "day after tomorrow 2pm", "monday after next 10am", "tomorrow week 2pm",
  ])("refuses %s", (text) => {
    expect(parseViewingTime(text, now)).toBeNull();
  });

  it("reads a yearless 29 February as next year's when this year has none", () => {
    expect(parseViewingTime("29/02 14:00", new Date("2027-03-01T09:00:00Z"))?.toISOString()).toBe("2028-02-29T14:00:00.000Z");
    expect(parseViewingTime("29/02/2027 14:00", new Date("2027-03-01T09:00:00Z"))).toBeNull();
  });

  it("shows a time the way a shopper reads it", () => {
    expect(formatViewingTime("2026-12-20T14:00:00.000Z")).toBe("Sun 20 Dec 2026, 2:00 pm GMT");
    expect(formatViewingTime(new Date("2026-10-26T00:05:00Z"))).toBe("Mon 26 Oct 2026, 12:05 am GMT");
  });
});

describe("WhatsApp shopping: reading requests without a model", () => {
  const read = (text: string, state: AssistantState = initialState()) => interpretLocally(text, state);

  it("reads a full rental request", () => {
    expect(read("3 bedroom house to rent in East Legon for 4000 cedis a month")).toEqual({
      intent: "property_search",
      property: { listingType: "RENT", category: "HOUSE", location: "east legon", bedroomsMin: 3, bedroomsMax: 3, maxPriceMinor: "400000", currencyCode: "GHS", frequency: "MONTHLY" },
    });
  });

  it.each([
    ["apartment for rent in osu under 5k", "500000"],
    ["flat in osu max ghs 4,500 monthly", "450000"],
    ["rent in tema ₵3000", "300000"],
    ["buy land in kasoa 2 million cedis", "200000000"],
    ["house for sale in accra budget is 800k", "80000000"],
  ])("reads the budget in %s", (text, minor) => {
    expect(read(text).property?.maxPriceMinor).toBe(minor);
  });

  it("never takes a room count or an amount for a place", () => {
    const parsed = read("looking for 2 bedrooms to rent around 4000");
    expect(parsed.property).toMatchObject({ listingType: "RENT", bedroomsMin: 2, maxPriceMinor: "400000" });
    expect(parsed.property?.location).toBeUndefined();
    expect(read("2br apartment in spintex").property).toMatchObject({ bedroomsMin: 2, category: "APARTMENT", location: "spintex" });
  });

  it("reads yearly rent", () => {
    expect(read("rent in airport residential 60000 cedis per annum").property).toMatchObject({ frequency: "ANNUAL", maxPriceMinor: "6000000" });
  });

  it("never reads a length of stay as a price", () => {
    expect(read("house to rent in accra for 1 year")).toEqual({ intent: "property_search", property: { listingType: "RENT", category: "HOUSE", location: "accra" } });
    expect(read("apartment to rent in osu for 6 months").property?.maxPriceMinor).toBeUndefined();
  });

  it("never takes a stay written in words for the price unit", () => {
    expect(read("house to rent in accra for one year").property?.frequency).toBeUndefined();
    expect(read("flat to rent in osu for a month").property?.frequency).toBeUndefined();
    expect(read("house to rent in accra for a 12-month lease").property?.frequency).toBeUndefined();
    expect(read("house to rent in accra on a one-year lease").property?.frequency).toBeUndefined();
    expect(read("house to rent in accra 2 years").property?.frequency).toBeUndefined();
    expect(read("flat to rent in osu 3000 cedis a year").property?.frequency).toBe("ANNUAL");
  });

  it("reads a price unit only where it prices something", () => {
    expect(read("house to rent in accra with daily cleaning").property?.frequency).toBeUndefined();
    expect(read("apartment in osu, monthly cleaning included").property?.frequency).toBeUndefined();
    expect(read("short stay in osu per night").property?.frequency).toBe("PER_NIGHT");
    expect(read("rent in osu 3000 cedis monthly").property?.frequency).toBe("MONTHLY");
    const asked = { ...initialState(), workflow: "property_search" as const, property: { listingType: "RENT" as const, location: "osu", maxPriceMinor: "300000" } };
    expect(read("monthly", asked).property?.frequency).toBe("MONTHLY");
    expect(read("yearly").property?.frequency).toBe("ANNUAL");
  });

  it("keeps a place name that starts with a number", () => {
    expect(read("rent near 37 military hospital").property?.location).toBe("37 military hospital");
    expect(read("rent around 4000").property?.location).toBeUndefined();
    expect(read("rent around 4000 cedis per month").property?.location).toBeUndefined();
    expect(read("flat in 2 bedrooms").property?.location).toBeUndefined();
    expect(read("rent in cantonments, 37 military hospital").property?.location).toBe("cantonments, 37 military hospital");
    expect(read("rent in east legon, 2nd circular road").property?.location).toBe("east legon, 2nd circular road");
    expect(read("rent in east legon, 4000 cedis per month").property).toMatchObject({ location: "east legon", maxPriceMinor: "400000" });
  });

  it("keeps a town after a comma in the area, and ends the area where a filter follows", () => {
    expect(read("rent in east legon, accra").property?.location).toBe("east legon, accra");
    expect(read("rent in east legon, under 5000").property).toMatchObject({ location: "east legon", maxPriceMinor: "500000" });
    expect(read("rent in east legon, ghs 4000 monthly").property).toMatchObject({ location: "east legon", maxPriceMinor: "400000" });
  });

  it.each([["apartment to rent in accra for 2 people", undefined], ["room to rent in osu for 3 adults", undefined], ["flat to rent in osu for 5k", "500000"], ["flat to rent in osu for 3000 a month", "300000"], ["flat to rent in osu for 3000 per month", "300000"], ["house for sale in tema for 1.2 million", "120000000"]])("reads a budget after for only when it is money: %s", (text, minor) => {
    expect(read(text).property?.maxPriceMinor).toBe(minor);
  });

  it.each(["rent in osu 2000 per annum", "rent in osu 2000 cedis monthly", "rent in osu 2000 cedis quarterly", "rent in osu 300 cedis daily", "rent in osu 300 cedis a night"])("produces filters the listing search accepts: %s", (text) => {
    const parsed = read(text);
    expect(publicListingSearchSchema.safeParse({ ...parsed.property, page: 1, pageSize: 3 }).success).toBe(true);
  });

  it("carries a conversation saved with the old yearly and weekly values", () => {
    expect(assistantStateSchema.parse({ property: { frequency: "YEARLY" } }).property.frequency).toBe("ANNUAL");
    expect(assistantStateSchema.parse({ property: { frequency: "WEEKLY" } }).property.frequency).toBeUndefined();
  });

  it("keeps business intents deterministic", () => {
    expect(read("support").intent).toBe("support");
    expect(read("I want to list my property").intent).toBe("listing");
    expect(read("plumber in madina")).toEqual({ intent: "service_search", service: { q: "plumber", city: "madina" } });
  });
});

function tools(overrides: Record<string, unknown> = {}) {
  return {
    searchProperties: vi.fn(async () => ({ ids: listingIds, hasMore: true, cards: ["1. Two bedroom flat, Osu", "2. Townhouse, Osu"] })),
    searchServices: vi.fn(async () => ({ ids: listingIds.slice(0, 1), hasMore: false, cards: ["1. Kofi Plumbing\nhttps://nesafric.com/marketplace/services/kofi"] })),
    propertyDetails: vi.fn(async () => ({ title: "Two bedroom flat, Osu", description: "Bright flat", enquiryEnabled: true, url: "https://nesafric.com/marketplace/properties/1" })),
    submitCustomerRequest: vi.fn(async () => ({ listingId: listingIds[0], leadId, viewingId })),
    customerRequestStatus: vi.fn(async () => "Viewing: REQUESTED."),
    ...overrides,
  };
}

describe("WhatsApp shopping: the conversation", () => {
  const input = (body: string, state: unknown) => ({ state, body, kind: "text", phone: "233241234567", conversationId: "c", messageId: `m-${body}`, defaultCountry: "GH", defaultCurrency: "GHS" });

  async function converse(messages: string[], deps = { tools: tools(), interpret: async (body: string, state: AssistantState) => interpretLocally(body, state) }) {
    let state: unknown = {};
    const replies: string[] = [];
    for (const message of messages) {
      const result = await advanceConversation(input(message, state), deps as never);
      state = result.state;
      replies.push(result.reply);
    }
    return { state: state as AssistantState, replies, deps };
  }

  it("asks for what is missing, searches, and books a viewing in plain language", async () => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    try {
      const { state, replies, deps } = await converse(["1", "rent", "Osu", "details 2", "view 1", "Ama Owusu", "tomorrow 2pm", "confirm"]);
      expect(replies[0]).toBe("Are you looking to rent or buy?");
      expect(replies[1]).toBe("Which area should I search?");
      expect(deps.tools.searchProperties).toHaveBeenCalledWith(expect.objectContaining({ listingType: "RENT", location: "osu", country: "GH", currencyCode: "GHS" }), 1);
      // "details 2" opens that result; a bare number stays a menu choice.
      expect(replies[3]).toContain("Bright flat");
      expect(deps.tools.propertyDetails).toHaveBeenCalledWith(listingIds[1]);
      expect(replies[5]).toContain("tomorrow 2pm");
      expect(replies[6]).toContain("Preferred one-hour slot starts: Sun 25 Oct 2026, 2:00 pm GMT");
      expect(replies[6]).toContain("Phone shared with the listing team: +233241234567");
      expect(deps.tools.submitCustomerRequest).toHaveBeenCalledTimes(1);
      expect(deps.tools.submitCustomerRequest.mock.calls[0]).toEqual([expect.objectContaining({ state: expect.objectContaining({ selectedListingId: listingIds[0], name: "Ama Owusu", startsAt: "2026-10-25T14:00:00.000Z" }) })]);
      expect(replies[7]).toContain(`Reference: ${viewingId}`);
      expect(state).toMatchObject({ workflow: "idle", lastRequest: { leadId, viewingId } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps asking until the viewing time can be read, and submits nothing before confirm", async () => {
    const { replies, deps } = await converse(["rent in osu", "view 1", "Ama", "sometime next week", "cancel"]);
    expect(replies[3]).toContain("I could not read that as a future date and time");
    expect(deps.tools.submitCustomerRequest).not.toHaveBeenCalled();
  });

  it("asks how often a rental budget is paid before searching", async () => {
    const { replies, deps } = await converse(["rent in osu under 4000", "monthly"]);
    expect(replies[0]).toBe("Is that rental budget per month, per year, per quarter or per night?");
    expect(deps.tools.searchProperties).toHaveBeenCalledTimes(1);
    expect(deps.tools.searchProperties).toHaveBeenCalledWith(expect.objectContaining({ maxPriceMinor: "400000", frequency: "MONTHLY" }), 1);
  });

  it("pages results and stops at the end", async () => {
    const searchProperties = vi.fn()
      .mockResolvedValueOnce({ ids: listingIds, hasMore: true, cards: ["1. A", "2. B"] })
      .mockResolvedValueOnce({ ids: listingIds.slice(0, 1), hasMore: false, cards: ["1. C"] });
    const { replies } = await converse(["buy a house in tema", "more", "more"], { tools: tools({ searchProperties }), interpret: async (body: string, state: AssistantState) => interpretLocally(body, state) });
    expect(searchProperties).toHaveBeenLastCalledWith(expect.objectContaining({ listingType: "SALE", category: "HOUSE", location: "tema" }), 2);
    expect(replies[2]).toContain("There are no more results");
  });

  it("refuses a number that is not in the latest results", async () => {
    const searchProperties = vi.fn(async () => ({ ids: listingIds.slice(0, 1), hasMore: false, cards: ["1. A"] }));
    const { replies } = await converse(["rent in osu", "details 3"], { tools: tools({ searchProperties }), interpret: async (body: string, state: AssistantState) => interpretLocally(body, state) });
    expect(replies[1]).toBe("Choose a property number from the most recent results.");
  });

  it("points provider results to their profiles instead of leaving the search", async () => {
    const { replies, state } = await converse(["plumber in madina", "details 1"]);
    expect(replies[1]).toContain("Open provider 1's profile link above");
    expect(state).toMatchObject({ workflow: "service_search", paused: false });
  });
});

describe("WhatsApp shopping: places next to prices", () => {
  it("ends the area where a trailing price starts", () => {
    expect(interpretLocally("buy land in kasoa 2 million cedis", initialState()).property).toMatchObject({ location: "kasoa", maxPriceMinor: "200000000" });
    expect(interpretLocally("rent in airport residential 60000 cedis per annum", initialState()).property).toMatchObject({ location: "airport residential" });
  });
});
