import { describe, expect, it, vi } from "vitest";
import { advanceConversation } from "@/modules/whatsapp-assistant/engine";
import { interpretLocally } from "@/modules/whatsapp-assistant/interpret";
import { describeFilters } from "@/modules/whatsapp-assistant/search-steps";
import { whatsappInteractiveSchema } from "@/modules/conversations/channels/whatsapp-interactive";

function setup(types = [{ category: "APARTMENT", count: 5 }, { category: "HOUSE", count: 2 }, { category: "Unknown Thing", count: 9 }]) {
  const tools = {
    propertyTypes: vi.fn(async () => types),
    searchProperties: vi.fn(async () => ({ ids: [], hasMore: false, cards: [] })),
    searchServices: vi.fn(), propertyDetails: vi.fn(), submitCustomerRequest: vi.fn(), customerRequestStatus: vi.fn(),
  };
  const dependencies = { tools: tools as never, interpret: (async (body: string, state: never) => interpretLocally(body, state)) as never };
  let state: unknown = {};
  const say = async (body: string) => { const result = await advanceConversation({ state, body, kind: "text", phone: "233241234567", conversationId: "c", messageId: "m", defaultCountry: "GH", defaultCurrency: "GHS" }, dependencies); state = result.state; return result; };
  return { tools, say, state: () => state as { property: Record<string, unknown>; searchStep?: string } };
}

describe("step-by-step property search", () => {
  it("asks type (from the published inventory), bedrooms, area and budget, then searches once", async () => {
    const { tools, say, state } = setup();
    const type = await say("rent");
    expect(type.reply).toContain("What type of property to rent?");
    expect(tools.propertyTypes).toHaveBeenCalledWith("RENT");
    expect(whatsappInteractiveSchema.safeParse(type.interactive).success).toBe(true);
    expect(type.interactive).toMatchObject({ type: "list", sections: [{ rows: [{ id: "type apartment", description: "5 published" }, { id: "type house" }, { id: "any type" }] }] });

    const bedrooms = await say("type apartment");
    expect(bedrooms.reply).toContain("How many bedrooms?");
    expect(whatsappInteractiveSchema.safeParse(bedrooms.interactive).success).toBe(true);
    const area = await say("2-3");
    expect(area.reply).toContain("Which area?");
    const budget = await say("North Dzorwulu");
    expect(budget.interactive).toMatchObject({ type: "list", sections: [{ rows: [{ id: "budget 0-2000" }, { id: "budget 2000-5000" }, { id: "budget 5000-10000" }, { id: "budget 10000+" }, { id: "any budget" }] }] });
    expect(tools.searchProperties).not.toHaveBeenCalled();

    const results = await say("budget 2000-5000");
    expect(tools.searchProperties).toHaveBeenCalledTimes(1);
    expect(tools.searchProperties).toHaveBeenCalledWith(expect.objectContaining({ listingType: "RENT", category: "APARTMENT", bedroomsMin: 2, bedroomsMax: 3, location: "North Dzorwulu", minPriceMinor: "200000", maxPriceMinor: "500000", frequency: "MONTHLY", country: "GH" }), 1);
    expect(results.reply).toContain("Filters: To rent, Apartment, 2–3 bedrooms, in North Dzorwulu, from GHS 2,000 up to GHS 5,000 a month.");
    expect(state().searchStep).toBeUndefined();
  });

  it("lets every step except the area be skipped", async () => {
    const { tools, say } = setup();
    await say("buy");
    await say("any type");
    await say("any bedrooms");
    await say("Kumasi");
    await say("any budget");
    expect(tools.searchProperties).toHaveBeenCalledWith(expect.objectContaining({ listingType: "SALE", location: "Kumasi" }), 1);
    const filters = (tools.searchProperties.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(filters.category).toBeUndefined();
    expect(filters.maxPriceMinor).toBeUndefined();
  });

  it("skips bedrooms for land and commercial, and the type step when it is already known", async () => {
    const { say } = setup();
    await say("land");
    const area = await say("buy");
    expect(area.reply).toContain("Which area?");
  });

  it("reads typed answers: a budget sentence, studio, 5+, and asks again for nonsense", async () => {
    const { tools, say, state } = setup();
    await say("rent");
    await say("apartment");
    expect(state().property.category).toBe("APARTMENT");
    await say("studio");
    expect(state().property).toMatchObject({ bedroomsMin: 0, bedroomsMax: 0 });
    await say("Osu");
    await say("under 4000 a month");
    expect(tools.searchProperties).toHaveBeenCalledWith(expect.objectContaining({ maxPriceMinor: "400000", frequency: "MONTHLY", bedroomsMin: 0 }), 1);

    const other = setup();
    await other.say("rent");
    await other.say("any");
    expect((await other.say("5+")).reply).toContain("Which area?");
    expect(other.state().property).toMatchObject({ bedroomsMin: 5 });
    expect(other.state().property.bedroomsMax).toBeUndefined();
    const again = await other.say("42");
    expect(again.reply).toContain("Which area?");
  });

  it("still answers a full sentence at once, without the steps", async () => {
    const { tools, say } = setup();
    await say("2 bedroom apartment to rent in Osu under 5000 a month");
    expect(tools.searchProperties).toHaveBeenCalledTimes(1);
    expect(tools.propertyTypes).not.toHaveBeenCalled();
  });

  it("offers typed types when nothing is published yet", async () => {
    const { say } = setup([]);
    const type = await say("rent");
    expect(type.reply).toContain("Reply apartment, house, land, office or shop.");
    expect(type.interactive).toBeUndefined();
  });

  it("describes filters in words", () => {
    expect(describeFilters({ listingType: "SALE", category: "HOUSE", bedroomsMin: 4, location: "Kumasi", maxPriceMinor: "300000000", currencyCode: "GHS" })).toBe("Filters: To buy, House, 4+ bedrooms, in Kumasi, up to GHS 3,000,000.");
  });
});

describe("no matching properties", () => {
  it("offers Change filters and New search buttons, and both work", async () => {
    const { say, tools } = setup();
    await say("2 bedroom apartment to rent in Osu under 5000 a month");
    const none = await advanceConversation({ state: { workflow: "property_search", property: { listingType: "RENT", location: "Osu", country: "GH", currencyCode: "GHS" } }, body: "search", kind: "text", phone: "233241234567", conversationId: "c", messageId: "m", defaultCountry: "GH", defaultCurrency: "GHS" }, { tools: tools as never, interpret: (async (body: string, state: never) => interpretLocally(body, state)) as never });
    expect(none.reply).toContain("No published, available properties match.");
    expect(none.interactive).toMatchObject({ type: "button", buttons: [{ id: "change filters", title: "Change filters" }, { id: "new search", title: "New search" }] });
    expect(whatsappInteractiveSchema.safeParse(none.interactive).success).toBe(true);

    const change = await advanceConversation({ state: none.state, body: "change filters", kind: "text", phone: "233241234567", conversationId: "c", messageId: "m", defaultCountry: "GH", defaultCurrency: "GHS" }, { tools: tools as never, interpret: vi.fn() as never });
    expect(change.reply).toContain("Tell me what to change");
    expect(change.state).toMatchObject({ workflow: "property_search", property: { location: "Osu" } });
    const fresh = await advanceConversation({ state: none.state, body: "new search", kind: "text", phone: "233241234567", conversationId: "c", messageId: "m", defaultCountry: "GH", defaultCurrency: "GHS" }, { tools: tools as never, interpret: vi.fn() as never });
    expect(fresh.state).toMatchObject({ workflow: "idle" });
  });
});
