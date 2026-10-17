import { describe, expect, it } from "vitest";
import {
  detectCommand, detectIntents, extractPropertyCriteria, matchOption, parseAreaSqm, parseBudget, parseDateTime,
  parseLocation, parseMoneyMinor,
} from "@/modules/whatsapp-assistant/nlu";
import { isFaithfulCopy } from "@/modules/whatsapp-assistant/ai";
import { choices, toCloudApiMessage } from "@/modules/whatsapp-assistant/messages";
import { parseWebhook, verifySignature, verifySubscription } from "@/modules/whatsapp-assistant/cloud-api";
import { matchesReference, parseReference, referenceFor } from "@/modules/whatsapp-assistant/references";
import { matchServiceCategory } from "@/modules/whatsapp-assistant/service-categories";
import { composeListingCopy } from "@/modules/whatsapp-assistant/workflows/listing";
import { describeCriteria, searchQuery } from "@/modules/whatsapp-assistant/workflows/property-search";
import { createHmac } from "node:crypto";

describe("intent detection", () => {
  it.each([
    ["I need a two-bedroom apartment in East Legon for rent.", ["property_search"]],
    ["Show me houses for sale in Accra under GHS 2 million.", ["property_search"]],
    ["I need land in Kumasi.", ["property_search"]],
    ["Find a reliable plumber near me.", ["service_search"]],
    ["My bathroom pipe is leaking", ["service_search"]],
    ["I need a plumber for my house", ["service_search"]],
    ["I want to register my real estate agency.", ["register_business"]],
    ["I am an agent and want to list a property.", ["register_agent"]],
    ["I want to register my property management company.", ["register_business"]],
    ["I want to advertise my construction services.", ["register_provider"]],
    ["I want to list my plumbing business", ["register_provider"]],
    ["I want to list a property", ["list_property"]],
    ["edit my listing", ["edit_listing"]],
    ["What's the status of NES-PR-1A2B3C4D?", ["status"]],
    ["I want to talk to a human", ["support"]],
    ["Hello", ["greeting"]],
  ])("%s", (message, expected) => {
    expect(detectIntents(message)).toEqual(expected);
  });

  it("splits a multi-intent message into separate tasks, in the order asked", () => {
    expect(detectIntents("I'm looking for an apartment in Osu and also need a plumber for my current home")).toEqual(["property_search", "service_search"]);
  });

  it("recognises universal commands", () => {
    expect(detectCommand("MENU")).toBe("menu");
    expect(detectCommand("cancel")).toBe("cancel");
    expect(detectCommand("Skip")).toBe("skip");
    expect(detectCommand("done!")).toBe("done");
    expect(detectCommand("I want to cancel my lease")).toBeNull();
  });
});

describe("property criteria", () => {
  it("extracts only what was said", () => {
    expect(extractPropertyCriteria("I need a two-bedroom apartment in East Legon")).toEqual({
      category: "APARTMENT", bedrooms: 2, location: { countryCode: "GH", area: "East Legon", city: "Accra", region: "Greater Accra", label: "East Legon, Accra" },
    });
    expect(extractPropertyCriteria("houses for sale in Accra under GHS 2 million")).toMatchObject({ listingType: "SALE", category: "HOUSE", maxBudgetMinor: "200000000", location: { city: "Accra" } });
    expect(extractPropertyCriteria("chamber and hall to let in Kasoa")).toMatchObject({ listingType: "RENT", category: "APARTMENT", bedrooms: 1, location: { city: "Kasoa", region: "Central" } });
  });

  it("does not mistake bedroom counts for a budget", () => {
    expect(extractPropertyCriteria("3 bedroom house under 5000").maxBudgetMinor).toBe("500000");
    expect(extractPropertyCriteria("3 bedroom house in Tema").maxBudgetMinor).toBeUndefined();
  });

  it("parses Ghanaian money formats", () => {
    expect(parseMoneyMinor("GHS 4,000")).toBe("400000");
    expect(parseMoneyMinor("₵4k")).toBe("400000");
    expect(parseMoneyMinor("1.5m")).toBe("150000000");
    expect(parseMoneyMinor("2 million cedis")).toBe("200000000");
    expect(parseMoneyMinor("nothing here")).toBeUndefined();
    expect(parseBudget("between 3k and 5k")).toEqual({ minMinor: "300000", maxMinor: "500000" });
    expect(parseBudget("at least 2000")).toEqual({ minMinor: "200000" });
  });

  it("keeps unknown places as free text and resolves known ones", () => {
    expect(parseLocation("Greater Accra region", true)).toMatchObject({ region: "Greater Accra" });
    expect(parseLocation("Ahodwo")).toMatchObject({ area: "Ahodwo", city: "Kumasi", region: "Ashanti" });
    expect(parseLocation("Oyibi", true)).toMatchObject({ area: "Oyibi" });
    expect(parseLocation("I need a house")).toBeUndefined();
  });

  it("builds a public search query, matching neighbourhoods across location fields", () => {
    expect(searchQuery({ listingType: "RENT", category: "APARTMENT", bedrooms: 2, location: { countryCode: "GH", area: "East Legon", city: "Accra", label: "East Legon, Accra" }, maxBudgetMinor: "400000" }, 1))
      .toEqual({ page: 1, pageSize: 3, listingType: "RENT", category: "APARTMENT", bedroomsMin: 2, bedroomsMax: 2, currencyCode: "GHS", maxPriceMinor: "400000", country: "GH", area: "East Legon" });
    expect(searchQuery({ category: "LAND", bedrooms: 3 }, 1)).not.toHaveProperty("bedroomsMin");
    expect(describeCriteria({ listingType: "RENT", category: "APARTMENT", bedrooms: 2, location: { countryCode: "GH", label: "East Legon" } })).toBe("2-bedroom apartments for rent in East Legon");
  });

  it("parses sizes and viewing times without guessing", () => {
    expect(parseAreaSqm("600 sqm")).toBe(600);
    expect(parseAreaSqm("2 acres")).toBeCloseTo(8093.71, 1);
    expect(parseAreaSqm("70x100 ft")).toBeCloseTo(650.32, 1);
    const now = new Date("2026-10-17T09:00:00Z"); // a Saturday
    expect(parseDateTime("tomorrow 10am", now)?.toISOString()).toBe("2026-10-18T10:00:00.000Z");
    expect(parseDateTime("Monday at 2:30pm", now)?.toISOString()).toBe("2026-10-19T14:30:00.000Z");
    expect(parseDateTime("25/10 15:00", now)?.toISOString()).toBe("2026-10-25T15:00:00.000Z");
    expect(parseDateTime("25 Oct 3pm", now)?.toISOString()).toBe("2026-10-25T15:00:00.000Z");
    expect(parseDateTime("tomorrow", now)).toBeUndefined();
  });

  it("maps typed numbers and titles onto offered options", () => {
    const options = [{ id: "a", title: "Rent" }, { id: "b", title: "Buy" }];
    expect(matchOption("2", options)?.id).toBe("b");
    expect(matchOption("rent", options)?.id).toBe("a");
    expect(matchOption("7", options)).toBeUndefined();
  });
});

describe("service categories", () => {
  const categories = [
    { id: "1", key: "plumbing", name: "Plumbing Repairs", parentName: "Repairs & Maintenance" },
    { id: "2", key: "pest_control", name: "Pest Control & Fumigation", parentName: "Cleaning & Property Care" },
    { id: "3", key: "property_lawyers", name: "Property Lawyers", parentName: "Legal" },
  ];
  it("maps everyday words onto real categories only", () => {
    expect(matchServiceCategory("my sink is leaking", categories)?.key).toBe("plumbing");
    expect(matchServiceCategory("I need fumigation for termites", categories)?.key).toBe("pest_control");
    expect(matchServiceCategory("a lawyer for land documents", categories)?.key).toBe("property_lawyers");
    // A synonym for a category that doesn't exist matches nothing rather than inventing one.
    expect(matchServiceCategory("electrician", categories)).toBeUndefined();
  });
});

describe("references", () => {
  it("derives references from real ids and matches them back", () => {
    const id = "1a2b3c4d-0000-4000-8000-000000000000";
    expect(referenceFor("PR", id)).toBe("NES-PR-1A2B3C4D");
    expect(parseReference("status nes-pr-1a2b3c4d please")).toEqual({ kind: "PR", prefix: "1a2b3c4d" });
    expect(matchesReference(id, "1a2b3c4d")).toBe(true);
    expect(parseReference("NES-XX-12345678")).toBeNull();
  });
});

describe("listing copy", () => {
  it("builds a title and description only from supplied facts", () => {
    const copy = composeListingCopy({ answered: [], listingType: "SALE", category: "HOUSE", bedrooms: 3, bathrooms: 3, location: { countryCode: "GH", area: "Adenta", city: "Accra", label: "Adenta, Accra" }, amenities: ["Parking"], notes: "Walled and gated." });
    expect(copy.title).toBe("3-Bedroom House for Sale in Adenta");
    expect(copy.description).toContain("Walled and gated.");
    expect(copy.description).toContain("• Parking");
    expect(copy.description).not.toMatch(/pool|school|title deed/i);
  });

  it("rejects AI copy that adds numbers or legal claims", () => {
    const facts = "Property type: House\nBedrooms: 3\nOwner/agent notes: Walled and gated.";
    expect(isFaithfulCopy({ title: "3-Bedroom House", description: "A walled and gated 3-bedroom home." }, facts)).toBe(true);
    expect(isFaithfulCopy({ title: "4-Bedroom House", description: "A walled and gated home." }, facts)).toBe(false);
    expect(isFaithfulCopy({ title: "3-Bedroom House", description: "Comes with a registered title deed." }, facts)).toBe(false);
  });
});

describe("WhatsApp Cloud API", () => {
  it("verifies signatures and the subscription handshake", () => {
    const body = JSON.stringify({ hello: "world" });
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifySignature(body, signature, "secret")).toBe(true);
    expect(verifySignature(body, signature, "other")).toBe(false);
    expect(verifySignature(body, signature, undefined)).toBe(false);
    expect(verifySubscription(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "t", "hub.challenge": "42" }), "t")).toBe("42");
    expect(verifySubscription(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "42" }), "t")).toBeNull();
  });

  it("parses text, interactive, media, location and status events", () => {
    const parsed = parseWebhook({ entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "PN" },
      contacts: [{ wa_id: "233241234567", profile: { name: "Ama" } }],
      messages: [
        { from: "233241234567", id: "m1", timestamp: "1700000000", type: "text", text: { body: "hi" } },
        { from: "233241234567", id: "m2", timestamp: "1700000001", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "ps:type:RENT", title: "Rent" } } },
        { from: "233241234567", id: "m3", timestamp: "1700000002", type: "image", image: { id: "media9", mime_type: "image/jpeg", caption: "Front" } },
        { from: "233241234567", id: "m4", timestamp: "1700000003", type: "location", location: { latitude: 5.6, longitude: -0.17, name: "East Legon" } },
        { id: "bad" },
      ],
      statuses: [{ id: "wamid.out", status: "failed", timestamp: "1700000004", errors: [{ code: 131047, title: "Re-engagement message" }] }],
    } }] }] });
    expect(parsed.messages.map(({ waMessageId }) => waMessageId)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(parsed.messages[0]).toMatchObject({ text: "hi", profileName: "Ama", phoneNumberId: "PN" });
    expect(parsed.messages[1]).toMatchObject({ choiceId: "ps:type:RENT" });
    expect(parsed.messages[2].media).toMatchObject({ id: "media9", kind: "image", caption: "Front" });
    expect(parsed.messages[3].location).toMatchObject({ latitude: 5.6, name: "East Legon" });
    expect(parsed.statuses).toEqual([expect.objectContaining({ providerMessageId: "wamid.out", status: "failed", errorCode: 131047 })]);
  });

  it("renders replies within WhatsApp's interactive limits", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ id: `o${index}`, title: `A very long option title number ${index}` }));
    expect(choices("Pick", many.slice(0, 2).map((option) => ({ ...option, title: "Short" }))).kind).toBe("buttons");
    expect(choices("Pick", many.slice(0, 8)).kind).toBe("list");
    expect(choices("Pick", many).kind).toBe("text");
    const list = toCloudApiMessage("233", choices("Pick", many.slice(0, 8)));
    const rows = (list.interactive as { action: { sections: Array<{ rows: Array<{ title: string }> }> } }).action.sections[0].rows;
    expect(rows.every(({ title }) => title.length <= 24)).toBe(true);
  });
});
