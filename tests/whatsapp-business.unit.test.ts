import { describe, expect, it, vi } from "vitest";
import { advanceBusiness, businessTrigger, matchServiceCategories, startBusiness, type BusinessDependencies } from "@/modules/whatsapp-assistant/business";
import { advanceOfficialConversation } from "@/modules/whatsapp-assistant/router";
import { MAIN_MENU } from "@/modules/whatsapp-assistant/engine";
import { initialState, type AssistantState } from "@/modules/whatsapp-assistant/schemas";
import { AppError } from "@/platform/errors";
import { BRAND, whatsappChatUrl } from "@/platform/brand";

const userId = "0b6f5f7e-8a7d-4c1b-9e3f-2a1b0c9d8e7f";
const professionalId = "4f1a7d2c-5b8e-4c3a-9d6f-1e2b3c4d5e61";
const listingId = "4f1a7d2c-5b8e-4c3a-9d6f-1e2b3c4d5e62";
const linked = { identityId: "i", user: { id: userId, displayName: "Ama Owusu" } };
const reset = () => initialState();
const input = (body: string, extra: Record<string, unknown> = {}) => ({ body, kind: "text", phone: "233241234567", messageId: `m-${body}`, organisationId: "11111111-1111-4111-8111-111111111111", defaultCountry: "GH", defaultCurrency: "GHS", ...extra });

/** The flow ledger as the database keeps it: one entry per key, written once. */
function memoryLedger(entries = new Map<string, { id: string; slug?: string | null }>()) {
  return { entries, get: vi.fn(async (key: string) => entries.get(key) ?? null), put: vi.fn(async (key: string, done: { id: string; slug?: string | null }) => { entries.set(key, done); }) };
}

function deps(overrides: Partial<Record<keyof BusinessDependencies, unknown>> = {}) {
  return {
    linkedUser: vi.fn(async () => linked),
    requestOtp: vi.fn(),
    verifyOtp: vi.fn(),
    link: vi.fn(),
    download: vi.fn(async () => ({ body: Buffer.from("x"), contentType: "image/jpeg" })),
    professionals: vi.fn(async () => [{ id: professionalId, displayName: "Owusu Realty", myRole: "OWNER", status: "ACTIVE", slug: "owusu-realty" }]),
    createProfessional: vi.fn(),
    uploadProfessionalLogo: vi.fn(),
    createListing: vi.fn(async () => ({ id: listingId })),
    uploadListingPhoto: vi.fn(),
    submitListing: vi.fn(),
    categories: vi.fn(async () => []),
    companies: vi.fn(async () => []),
    createCompany: vi.fn(),
    createProvider: vi.fn(),
    listProvider: vi.fn(),
    uploadProviderLogo: vi.fn(),
    ownedProviders: vi.fn(async () => []),
    existingProvider: vi.fn(async () => null),
    lock: vi.fn(async () => undefined),
    ledger: memoryLedger(),
    ...overrides,
  } as unknown as BusinessDependencies & Record<string, ReturnType<typeof vi.fn>>;
}

async function run(messages: Array<string | { media: string; mimeType?: string }>, dependencies: BusinessDependencies, start = "5") {
  const trigger = businessTrigger(start, initialState())!;
  let result = await startBusiness(trigger, input(start), reset, dependencies);
  const replies = [result.reply];
  for (const message of messages) {
    const next = typeof message === "string" ? input(message) : input("[image received]", { kind: "image", messageId: `m-${message.media}`, media: { id: message.media, mimeType: message.mimeType ?? "image/jpeg" } });
    result = await advanceBusiness(next, result.state, reset, dependencies);
    replies.push(result.reply);
  }
  return { state: result.state as AssistantState, replies };
}

describe("WhatsApp business: starting a flow", () => {
  it("reads the menu numbers and phrases", () => {
    const idle = initialState();
    expect(businessTrigger("3", idle)).toEqual({ kind: "agency" });
    expect(businessTrigger("4", idle)).toEqual({ kind: "agency", professionalType: "INDIVIDUAL_AGENT" });
    expect(businessTrigger("list my property for rent", idle)).toEqual({ kind: "listing" });
    expect(businessTrigger("register my service business", idle)).toEqual({ kind: "service" });
    expect(businessTrigger("change logo", idle)).toEqual({ kind: "logo" });
    expect(businessTrigger("register", idle)).toBeNull();
  });

  it("keeps a bare number a result pick while results are on screen", () => {
    const searching = { ...initialState(), workflow: "property_search" as const, results: ["4f1a7d2c-5b8e-4c3a-9d6f-1e2b3c4d5e63"] };
    // Even with one result, 3 is answered by the search ("choose a number from the results").
    expect(businessTrigger("3", searching)).toBeNull();
    expect(businessTrigger("5", searching)).toEqual({ kind: "listing" });
    expect(businessTrigger("5", { ...initialState(), paused: true })).toBeNull();
    // A phrase keeps a paused search too; the engine then asks to resume or cancel.
    expect(businessTrigger("register my agency", { ...initialState(), workflow: "property_search", paused: true })).toBeNull();
  });

  it("is reached from the official number, and the landlord setup keeps its own command", async () => {
    const startBusinessDep = vi.fn(async () => ({ state: initialState(), reply: "started" }));
    const onboarding = vi.fn(async () => ({ reply: "onboarding" }));
    const routerDeps = { engine: vi.fn(async () => ({ state: initialState(), reply: MAIN_MENU })), startBusiness: startBusinessDep, business: vi.fn(), onboarding, openDraft: vi.fn(async () => null), linkedUser: vi.fn(async () => null), jobs: vi.fn(async () => null), report: vi.fn(async () => null), providerMessage: vi.fn(async () => null), rules: vi.fn(async () => null), network: vi.fn(async () => null), landlord: vi.fn(async () => null) } as never;
    const routed = (body: string) => advanceOfficialConversation({ state: {}, body, kind: "text", phone: "233241234567", conversationId: "c", messageId: "m", defaultCountry: "GH", defaultCurrency: "GHS", organisationId: "11111111-1111-4111-8111-111111111111" }, routerDeps);
    expect((await routed("4")).reply).toBe("started");
    expect((await routed("register")).reply).toBe("onboarding");
    expect(startBusinessDep).toHaveBeenCalledTimes(1);
  });

  it("points other businesses' numbers to the official number", () => {
    expect(BRAND.contact.whatsappE164).toBe("+233502820002");
    expect(whatsappChatUrl("List a property")).toBe("https://wa.me/233502820002?text=List%20a%20property");
  });
});

describe("WhatsApp business: listing a property", () => {
  const details = ["sale", "land", "Half plot at Oyarifa", "Oyarifa", "GHS 250,000", "Dry, documented land with an indenture, close to the main road.", "1", "confirm"];

  it("collects the details, creates a draft only on confirm, stores each photo once and submits for review", async () => {
    const dependencies = deps();
    const { replies, state } = await run([...details.slice(0, -1)], dependencies);
    expect(replies[0]).toContain("for rent or for sale");
    // Land skips bedrooms and the rent frequency.
    expect(replies.at(-1)).toContain("Price: GHS 250000");
    expect(replies.at(-1)).not.toContain("Bedrooms");
    expect(dependencies.createListing).not.toHaveBeenCalled();

    let result = await advanceBusiness(input("confirm"), state, reset, dependencies);
    expect(dependencies.createListing).toHaveBeenCalledWith(userId, professionalId, expect.objectContaining({
      asset: expect.objectContaining({ purpose: "SALE", category: "LAND", priceMinor: "25000000", city: "Oyarifa", locality: null, bedrooms: null }),
      listing: expect.objectContaining({ listingType: "SALE", frequency: null, contactPhone: "+233241234567" }),
      listingAuthority: "OWNER_SELF",
    }));
    expect(result.reply).toContain("Send photos");
    expect((await advanceBusiness(input("done"), result.state, reset, dependencies)).reply).toContain("at least one photo");

    const image = (id: string, mimeType = "image/jpeg") => input("[image received]", { kind: "image", messageId: `m-${id}`, media: { id, mimeType } });
    result = await advanceBusiness(image("111"), result.state, reset, dependencies);
    expect(result.reply).toBe("Photo 1 saved. Send more, or reply done.");
    // A redelivered photo is not stored again.
    result = await advanceBusiness(image("111"), result.state, reset, dependencies);
    expect(result.reply).toBe("That photo is already saved.");
    expect((await advanceBusiness(image("222", "image/heic"), result.state, reset, dependencies)).reply).toContain("JPG, PNG or WebP");
    expect(dependencies.uploadListingPhoto).toHaveBeenCalledTimes(1);
    expect(dependencies.uploadListingPhoto).toHaveBeenCalledWith(userId, professionalId, listingId, expect.objectContaining({ fileName: "whatsapp-111.jpg", contentType: "image/jpeg", mediaType: "PHOTO" }));

    result = await advanceBusiness(input("done"), result.state, reset, dependencies);
    expect(result.reply).toContain("title deed, land certificate or indenture number");
    result = await advanceBusiness(input("Indenture LC/1234/2019"), result.state, reset, dependencies);
    expect(dependencies.submitListing).toHaveBeenCalledWith(userId, professionalId, listingId, { evidence: { type: "ownership_reference", reference: "Indenture LC/1234/2019" }, note: "Submitted on WhatsApp." });
    expect(result.reply).toContain("Submitted for NesAfric review: Half plot at Oyarifa");
    expect(result.state.workflow).toBe("idle");
  });

  it("explains a refused draft and keeps the answers for another confirm", async () => {
    const createListing = vi.fn().mockRejectedValueOnce(new AppError("ENTITLEMENT_LIMIT_REACHED", 403, "Your plan allows 5 active listings.")).mockResolvedValueOnce({ id: listingId });
    const dependencies = deps({ createListing });
    const { state, replies } = await run(details, dependencies);
    expect(replies.at(-1)).toContain("Not saved: Your plan allows 5 active listings.");
    expect(state.business?.step).toBe("listing_review");
    expect((await advanceBusiness(input("confirm"), state, reset, dependencies)).reply).toContain("Send photos");
  });

  it("recovers what an earlier pass of the same flow created, by its ledger entry, never by name", async () => {
    const ledger = memoryLedger();
    const dependencies = deps({ ledger });
    const beforeConfirm = (await run(details.slice(0, -1), dependencies)).state;
    const flow = beforeConfirm.business!.startedAt!;
    // An earlier pass of this confirm created the listing and wrote its ledger entry.
    ledger.entries.set(`+233241234567:${flow}:listing`, { id: listingId });
    let { state } = await advanceBusiness(input("confirm"), beforeConfirm, reset, dependencies);
    expect(dependencies.createListing).not.toHaveBeenCalled();
    expect(dependencies.lock).toHaveBeenCalledWith(`+233241234567:${flow}:listing`);
    expect(state.business?.committed.listingId).toBe(listingId);
    // The photo was stored by an earlier pass: counted, not downloaded or uploaded again.
    ledger.entries.set(`+233241234567:${flow}:photo:333`, { id: "333" });
    ({ state } = await advanceBusiness(input("[image received]", { kind: "image", messageId: "m-p", media: { id: "333", mimeType: "image/jpeg" } }), state, reset, dependencies));
    expect(dependencies.download).not.toHaveBeenCalled();
    expect(state.business?.committed.media).toEqual(["333"]);
    // Already submitted by a pass whose conversation update was lost: reported, not resubmitted.
    ({ state } = await advanceBusiness(input("done"), state, reset, dependencies));
    ledger.entries.set(`+233241234567:${flow}:submit`, { id: listingId });
    const done = await advanceBusiness(input("Indenture LC/1234/2019"), state, reset, dependencies);
    expect(dependencies.submitListing).not.toHaveBeenCalled();
    expect(done.reply).toContain("Submitted for NesAfric review");
  });

  it("records each effect once, so a new flow creates its own records", async () => {
    const ledger = memoryLedger();
    const dependencies = deps({ ledger });
    await run(details, dependencies);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await run(details, dependencies);
    // Two flows (two start times), two listings, even with the same title.
    expect(dependencies.createListing).toHaveBeenCalledTimes(2);
    expect([...ledger.entries.keys()].filter((key) => key.endsWith(":listing"))).toHaveLength(2);
  });

  it("asks which profile when the account has several, and needs one to start", async () => {
    const several = deps({ professionals: vi.fn(async () => [{ id: professionalId, displayName: "Owusu Realty", myRole: "OWNER", status: "ACTIVE", slug: null }, { id: listingId, displayName: "Accra Homes", myRole: "AGENT", status: "ACTIVE", slug: null }]) });
    expect((await run([], several)).replies[0]).toContain("1. Owusu Realty\n2. Accra Homes");
    const none = deps({ professionals: vi.fn(async () => []) });
    const result = await run([], none);
    expect(result.replies[0]).toContain("Reply 4 to register as an agent");
    expect(result.state.workflow).toBe("idle");
  });
});

describe("WhatsApp business: accounts", () => {
  it("creates the account from an SMS code before anything else, and keeps the code out of the transcript", async () => {
    const dependencies = deps({
      linkedUser: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(linked),
      requestOtp: vi.fn(async () => ({ challengeId: "4f1a7d2c-5b8e-4c3a-9d6f-1e2b3c4d5e6f", destination: "+233 24 *** 4567" })),
      verifyOtp: vi.fn(async () => ({ user: linked.user })),
    });
    const trigger = businessTrigger("3", initialState())!;
    const started = await startBusiness(trigger, input("3"), reset, dependencies);
    expect(started.reply).toContain("What is your full name?");
    const named = await advanceBusiness(input("Ama Owusu"), started.state, reset, dependencies);
    expect(dependencies.requestOtp).toHaveBeenCalledWith({ mode: "register", channel: "sms", identifier: "+233241234567" });
    const verified = await advanceBusiness(input("123456"), named.state, reset, dependencies);
    expect(dependencies.link).toHaveBeenCalledWith("233241234567", userId, "SMS_OTP", "11111111-1111-4111-8111-111111111111");
    expect(verified.redactInbound).toBe(true);
    expect(verified.reply).toContain("Signed in as Ama Owusu");
    expect(verified.reply).toContain("What kind of business");
  });
});

describe("WhatsApp business: service categories", () => {
  const categories = ["Plumbing Repairs", "Electrical Repairs", "Electrical Engineers", "Electric Fencing", "Roofing", "Residential Cleaning", "Commercial Cleaning", "Tiling", "Air Conditioning / HVAC"].map((name, index) => ({ id: `0000000${index}-0000-4000-8000-000000000000`, name }));

  it.each([
    ["plumber", ["Plumbing Repairs"]],
    ["roofer", ["Roofing"]],
    ["tiler", ["Tiling"]],
    ["AC", ["Air Conditioning / HVAC"]],
    ["electrician", ["Electrical Repairs", "Electrical Engineers", "Electric Fencing"]],
    ["electrical repairs", ["Electrical Repairs"]],
    ["cleaning", ["Residential Cleaning", "Commercial Cleaning"]],
    ["baking", []],
  ])("matches %s", (phrase, names) => {
    expect(matchServiceCategories(phrase, categories).map(({ name }) => name)).toEqual(names);
  });
});

describe("WhatsApp business: message size", () => {
  it("keeps a review inside WhatsApp's message limit however long the description", async () => {
    const long = "Spacious and bright. ".repeat(450);
    const { replies } = await run(["rent", "house", "Family house, Adenta", "Adenta, Accra", "6000", "1", "4", "3", long, "2"], deps());
    expect(replies.at(-1)).toContain("Description: Spacious and bright.");
    expect(replies.at(-1)!.length).toBeLessThan(4096);
  });
});

describe("WhatsApp business: service review size", () => {
  it("stays inside WhatsApp's message limit with the longest areas and service names", async () => {
    const long = (n: number) => `${"Long service name ".repeat(11).slice(0, 199)}${n}`;
    const categories = Array.from({ length: 10 }, (_, index) => ({ id: `0000000${index}-0000-4000-8000-000000000001`, name: long(index) }));
    const dependencies = deps({ categories: vi.fn(async () => categories) });
    const areas = Array.from({ length: 20 }, (_, index) => `${"Area ".repeat(23)}${String(index).padStart(2, "0")}`).join(", ");
    const { replies } = await run(["2", "C".repeat(160), categories.map(({ name }) => name).join(", "), areas, "D".repeat(5000)], dependencies, "6");
    expect(replies.at(-1)).toContain("Reply confirm to create it");
    expect(Math.max(...replies.map((reply) => reply.length))).toBeLessThan(4096);
  });
});

describe("WhatsApp business: answers the website would refuse", () => {
  it("asks again for an over-long area instead of failing at confirm", async () => {
    const { replies, state } = await run(["rent", "1", "Two bedroom flat", "x".repeat(200)], deps());
    expect(replies.at(-1)).toContain("under 150 characters each");
    expect(state.business?.step).toBe("listing_location");
  });

  it("keeps each service area once, whatever its case", async () => {
    const categories = [{ id: "00000001-0000-4000-8000-000000000001", name: "Plumbing Repairs" }];
    const createProvider = vi.fn(async () => ({ id: "00000001-0000-4000-8000-000000000009", slug: null, displayName: "Kofi" }));
    const dependencies = deps({ categories: vi.fn(async () => categories), createProvider });
    await run(["1", "Kofi Plumbing", "plumber", "Accra, accra, Tema", "skip", "confirm"], dependencies, "6");
    expect(createProvider).toHaveBeenCalledWith(userId, expect.objectContaining({ serviceAreas: [{ areaType: "CITY", name: "Accra" }, { areaType: "CITY", name: "Tema" }] }));
  });

  it("replies with a domain validation error rather than retrying it forever", async () => {
    const { z } = await import("zod");
    const invalid = z.object({ city: z.string().max(150) }).safeParse({ city: "x".repeat(151) });
    const createListing = vi.fn(async () => { throw invalid.error; });
    const { replies, state } = await run(["rent", "1", "Two bedroom flat", "Osu", "4000", "1", "2", "1", "A bright flat close to Oxford Street, newly painted.", "1", "confirm"], deps({ createListing }));
    expect(replies.at(-1)).toContain("Some details were not accepted (city:");
    expect(state.business?.step).toBe("listing_review");
  });
});

describe("WhatsApp business: one provider per person and company", () => {
  it("points to the existing service business instead of a confirm that can never succeed", async () => {
    const dependencies = deps({ existingProvider: vi.fn(async () => ({ id: "00000001-0000-4000-8000-000000000009", displayName: "Kofi Plumbing", archivedAt: null })) });
    const { replies, state } = await run(["1"], dependencies, "6");
    expect(replies.at(-1)).toContain("Kofi Plumbing is already registered as your service business");
    expect(state.workflow).toBe("idle");
    expect(dependencies.existingProvider).toHaveBeenCalledWith(userId, { type: "INDIVIDUAL" });
  });

  it("checks the chosen company, and handles a conflict that appears before confirm", async () => {
    const companyId = "00000001-0000-4000-8000-000000000010";
    const companies = vi.fn(async () => [{ id: companyId, name: "Boateng Ltd" }]);
    const existing = deps({ companies, existingProvider: vi.fn(async () => ({ id: companyId, displayName: "Boateng Services", archivedAt: null })) });
    expect((await run(["2", "1"], existing, "6")).replies.at(-1)).toContain("Boateng Services is already registered");

    const categories = [{ id: "00000001-0000-4000-8000-000000000001", name: "Plumbing Repairs" }];
    const createProvider = vi.fn(async () => { throw new AppError("PROVIDER_IDENTITY_EXISTS", 409, "This user or company already has a provider identity."); });
    const raced = deps({ categories: vi.fn(async () => categories), createProvider });
    const { replies, state } = await run(["1", "Kofi Plumbing", "plumber", "Accra", "skip", "confirm"], raced, "6");
    expect(replies.at(-1)).toContain("Kofi Plumbing is already registered");
    expect(state.workflow).toBe("idle");
  });
});

describe("WhatsApp business: codes and links", () => {
  it("keeps the code already sent when a resend is refused", async () => {
    const challengeId = "4f1a7d2c-5b8e-4c3a-9d6f-1e2b3c4d5e6f";
    const requestOtp = vi.fn()
      .mockResolvedValueOnce({ challengeId, destination: "+233 24 *** 4567" })
      .mockRejectedValueOnce(new AppError("OTP_RATE_LIMITED", 429, "Please wait a minute before asking for another code."));
    const verifyOtp = vi.fn(async () => ({ user: linked.user }));
    const dependencies = deps({ linkedUser: vi.fn(async () => null), requestOtp, verifyOtp });
    const started = await startBusiness(businessTrigger("3", initialState())!, input("3"), reset, dependencies);
    const named = await advanceBusiness(input("Ama Owusu"), started.state, reset, dependencies);
    const refused = await advanceBusiness(input("resend"), named.state, reset, dependencies);
    expect(refused.reply).toContain("Please wait a minute");
    expect(refused.state.business?.account.challengeId).toBe(challengeId);
    await advanceBusiness(input("123456"), refused.state, reset, dependencies);
    expect(verifyOtp).toHaveBeenCalledWith(expect.objectContaining({ challengeId, code: "123456" }));
  });

  it("sends registrations from other numbers to the official menu, where the person chooses", async () => {
    const { advanceConversation } = await import("@/modules/whatsapp-assistant/engine");
    const result = await advanceConversation({ state: {}, body: "register as a service provider", kind: "text", phone: "233241234567", conversationId: "c", messageId: "m", defaultCountry: "GH", defaultCurrency: "GHS" }, { tools: {} as never, interpret: async () => ({ intent: "registration" }) });
    expect(result.reply).toContain("https://wa.me/233502820002?text=menu");
    expect(businessTrigger("menu", initialState())).toBeNull();
  });
});

describe("WhatsApp business: archived service businesses", () => {
  it("sends the person to support instead of to a business they cannot manage", async () => {
    const dependencies = deps({ existingProvider: vi.fn(async () => ({ id: "00000001-0000-4000-8000-000000000009", displayName: "Kofi Plumbing", archivedAt: new Date("2026-01-01") })) });
    const { replies } = await run(["1"], dependencies, "6");
    expect(replies.at(-1)).toContain("is now archived");
    expect(replies.at(-1)).toContain("support@nesafric.com");
    expect(replies.at(-1)).not.toContain("Reply logo");
  });
});

describe("WhatsApp business: image types", () => {
  it("takes an image sent without a declared type when the download is an accepted image, and refuses other downloads", async () => {
    const download = vi.fn().mockResolvedValueOnce({ body: Buffer.from("x"), contentType: "image/png" }).mockResolvedValueOnce({ body: Buffer.from("x"), contentType: "application/pdf" });
    const dependencies = deps({ download });
    const details = ["sale", "land", "Half plot at Oyarifa", "Oyarifa", "GHS 250,000", "Dry, documented land with an indenture, close to the main road.", "1", "confirm"];
    let { state } = await run(details, dependencies);
    let result = await advanceBusiness(input("[image received]", { kind: "image", messageId: "m-a", media: { id: "501" } }), state, reset, dependencies);
    expect(result.reply).toBe("Photo 1 saved. Send more, or reply done.");
    expect(dependencies.uploadListingPhoto).toHaveBeenCalledWith(userId, professionalId, listingId, expect.objectContaining({ fileName: "whatsapp-501.png", contentType: "image/png" }));
    ({ state } = result);
    result = await advanceBusiness(input("[image received]", { kind: "image", messageId: "m-b", media: { id: "502" } }), state, reset, dependencies);
    expect(result.reply).toContain("Please send photos as JPG, PNG or WebP images.");
    expect(dependencies.uploadListingPhoto).toHaveBeenCalledTimes(1);
  });
});

describe("WhatsApp business: support", () => {
  it("hands the chat to support from any step, keeping the answers, without taking the word as an answer", async () => {
    const dependencies = deps({ linkedUser: vi.fn(async () => null) });
    const started = await startBusiness(businessTrigger("3", initialState())!, input("3"), reset, dependencies);
    const result = await advanceBusiness(input("support"), started.state, reset, dependencies);
    expect(result.handoff).toBe(true);
    expect(result.reply).toContain("support queue");
    expect(result.state.business?.step).toBe("account_name");
    expect(dependencies.requestOtp).not.toHaveBeenCalled();
  });

  it("repeats the question for help instead of taking it as an answer", async () => {
    const dependencies = deps({ linkedUser: vi.fn(async () => null) });
    const started = await startBusiness(businessTrigger("3", initialState())!, input("3"), reset, dependencies);
    const result = await advanceBusiness(input("help"), started.state, reset, dependencies);
    expect(result.reply).toContain("Reply support to reach a person");
    expect(result.reply).toContain("What is your full name?");
    expect(result.state.business?.account.displayName).toBeUndefined();
    expect(dependencies.requestOtp).not.toHaveBeenCalled();
  });
});
