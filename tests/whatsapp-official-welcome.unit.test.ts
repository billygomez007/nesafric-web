import { describe, expect, it, vi } from "vitest";
import { advanceOfficialConversation } from "@/modules/whatsapp-assistant/router";
import { advanceConversation } from "@/modules/whatsapp-assistant/engine";
import { interpretLocally } from "@/modules/whatsapp-assistant/interpret";
import { COMMERCIAL_PROMPT, FIND_PROPERTY_PROMPT, firstNameFrom, ghanaGreeting, greetingLine, MORE_OPTIONS, officialWelcomeList, VIEWING_PROMPT, welcomeReply } from "@/modules/whatsapp-assistant/welcome";
import { whatsappInteractiveSchema } from "@/modules/conversations/channels/whatsapp-interactive";

const MORNING = new Date("2026-10-25T08:30:00Z"); // Ghana is UTC+0 all year.
const agentCard = "1. Owusu Realty\nAgent · Verified by NesAfric\nAreas: East Legon\nPublished listings: 4\nhttps://www.nesafric.com/marketplace/professionals/owusu-realty";

function dependencies(overrides: Record<string, unknown> = {}) {
  const tools = {
    searchProperties: vi.fn(async () => ({ ids: [], hasMore: false, cards: [] })),
    searchServices: vi.fn(async () => ({ ids: [], hasMore: false, cards: [] })),
    propertyDetails: vi.fn(), submitCustomerRequest: vi.fn(), customerRequestStatus: vi.fn(),
  };
  const engine = vi.fn((input: Parameters<typeof advanceConversation>[0]) => advanceConversation(input, { tools: tools as never, interpret: (async (body: string, state: never) => interpretLocally(body, state)) as never }));
  return {
    tools,
    deps: {
      engine, providerMessage: vi.fn(async () => null), network: vi.fn(async () => null), report: vi.fn(async () => null), rules: vi.fn(async () => null), jobs: vi.fn(async () => null),
      landlord: vi.fn(async () => null), linkedUser: vi.fn(async () => null), business: vi.fn(async () => null), invitationReply: vi.fn(async () => null), openDraft: vi.fn(async () => null),
      onboarding: vi.fn(async () => ({ reply: "Let's set up your properties.", exit: false })),
      agents: vi.fn(async (area: string, page: number) => (page === 1 && /legon/i.test(area) ? { ids: ["a"], hasMore: true, cards: [agentCard] } : { ids: [], hasMore: false, cards: [] })),
      roles: vi.fn(async () => ({ managed: [], tenancies: [], providers: [] })),
      now: () => MORNING,
      ...overrides,
    } as never,
  };
}

const input = (body: string, state: unknown = {}, profileName?: string) => ({ state, body, kind: "text", phone: "233241234567", conversationId: "c", messageId: "m", defaultCountry: "GH", defaultCurrency: "GHS", organisationId: "11111111-1111-4111-8111-111111111111", profileName });

describe("Ghana-time greeting", () => {
  it.each([
    ["2026-10-25T04:59:59Z", "Good evening"], ["2026-10-25T05:00:00Z", "Good morning"], ["2026-10-25T11:59:59Z", "Good morning"],
    ["2026-10-25T12:00:00Z", "Good afternoon"], ["2026-10-25T16:59:59Z", "Good afternoon"], ["2026-10-25T17:00:00Z", "Good evening"],
    ["2026-10-25T23:59:59Z", "Good evening"], ["2026-10-26T00:00:00Z", "Good evening"],
  ])("at %s it says %s", (at, expected) => {
    expect(ghanaGreeting(new Date(at))).toBe(expected);
  });

  it("uses Africa/Accra, not the server's time zone", () => {
    const previous = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try { expect(ghanaGreeting(new Date("2026-10-25T08:00:00Z"))).toBe("Good morning"); } finally { process.env.TZ = previous; }
  });
});

describe("customer first name", () => {
  it.each([["Ama Owusu", "Ama"], ["  kwame  ", "Kwame"], ["ADJOA", "Adjoa"], ["Nii-Armah Tetteh", "Nii-Armah"], ["Akosua 🌸", "Akosua"], ["Éfua", "Éfua"], ["McDonald", "McDonald"]])("greets %j as %j", (name, first) => {
    expect(firstNameFrom(name)).toBe(first);
  });

  it.each([[undefined], [null], [""], ["   "], ["+233 24 123 4567"], ["0241234567"], ["ama@example.com"], ["🌸🌸"], ["WhatsApp User"], ["undefined"], ["null"], ["A"], ["user123"]])("never greets with %j", (name) => {
    expect(firstNameFrom(name)).toBeUndefined();
  });

  it("formats the line with and without a name", () => {
    expect(greetingLine(MORNING, "Ama Owusu")).toBe("Good morning, Ama! 🏡");
    expect(greetingLine(MORNING, "+233241234567")).toBe("Good morning! 🏡");
    expect(greetingLine(new Date("2026-10-25T13:00:00Z"))).toBe("Good afternoon! 🏡");
  });
});

describe("official WhatsApp welcome", () => {
  it("greets a first-time customer by WhatsApp profile name, with the short welcome and the list beneath", async () => {
    const result = await advanceOfficialConversation(input("Hi", {}, "Ama Owusu"), dependencies().deps);
    expect(result.reply.startsWith("Good morning, Ama! 🏡\n\n🏡 Welcome to NesAfric!\nYour smarter way to manage properties and explore real estate — all on WhatsApp.\nTap Choose an option below to get started, or simply tell me what you need.")).toBe(true);
    expect(result.interactive).toMatchObject({ type: "list", button: "Choose an option", body: expect.stringMatching(/^Good morning, Ama! 🏡\n\n🏡 Welcome to NesAfric!/) });
    expect(whatsappInteractiveSchema.safeParse(result.interactive).success).toBe(true);
    expect(result.interactive?.type === "list" && result.interactive.body).not.toContain("1. ");
  });

  it("prefers the linked account's name for a returning customer", async () => {
    const linkedUser = vi.fn(async () => ({ identityId: "i", user: { id: "u", displayName: "Kofi Mensah" } }));
    const result = await advanceOfficialConversation(input("menu", { workflow: "idle" }, "K"), dependencies({ linkedUser, now: () => new Date("2026-10-25T18:00:00Z") }).deps);
    expect(result.reply.startsWith("Good evening, Kofi! 🏡")).toBe(true);
  });

  it("greets without a name when none is reliable, and never shows the phone number", async () => {
    const result = await advanceOfficialConversation(input("hello", {}, "+233 24 123 4567"), dependencies().deps);
    expect(result.reply.startsWith("Good morning! 🏡\n\n")).toBe(true);
    expect(result.reply).not.toMatch(/233|undefined|null/);
  });

  it("keeps a saved task's note with the welcome for a returning customer", async () => {
    const result = await advanceOfficialConversation(input("menu", { workflow: "property_search", property: { listingType: "RENT" } }), dependencies().deps);
    expect(result.reply).toContain("Your previous workflow is saved.");
    expect(result.state).toMatchObject({ paused: true });
  });

  it("answers an unrecognised first message with the welcome instead of a dead end", async () => {
    const result = await advanceOfficialConversation(input("good morning"), dependencies().deps);
    expect(result).toMatchObject(welcomeReply("Good morning! 🏡", "I did not catch that.\n\n"));
  });

  it("keeps the list within Meta's limits", () => {
    const list = officialWelcomeList("Good afternoon, Nii-Armah! 🏡", "x".repeat(400), "\n\nYour previous workflow is saved.")!;
    expect(whatsappInteractiveSchema.safeParse(list).success).toBe(true);
    expect(officialWelcomeList("Good morning! 🏡", "x".repeat(900))).toBeUndefined();
  });
});

describe("Choose an option: each row runs an existing workflow", () => {
  it("1 / Find a Property offers rent, buy, land, commercial or a viewing, then searches real listings", async () => {
    const { deps, tools } = dependencies();
    const found = await advanceOfficialConversation(input("find a property"), deps);
    expect(found.reply).toBe(FIND_PROPERTY_PROMPT);
    expect(found.interactive).toMatchObject({ type: "list", sections: [{ rows: [{ id: "rent" }, { id: "buy" }, { id: "land" }, { id: "commercial" }, { id: "book a viewing" }] }] });
    expect((await advanceOfficialConversation(input("1"), deps)).reply).toBe(FIND_PROPERTY_PROMPT);
    const rent = await advanceOfficialConversation(input("rent", found.state), deps);
    expect(rent.state).toMatchObject({ workflow: "property_search", property: { listingType: "RENT" } });
    const land = await advanceOfficialConversation(input("land", found.state), deps);
    expect(land.interactive).toMatchObject({ type: "button", buttons: [{ id: "rent" }, { id: "buy" }] });
    const buy = await advanceOfficialConversation(input("buy", land.state), deps);
    const area = await advanceOfficialConversation(input("Kasoa", buy.state), deps);
    expect(area.reply).toContain("What is your budget");
    await advanceOfficialConversation(input("any budget", area.state), deps);
    expect(tools.searchProperties).toHaveBeenCalledWith(expect.objectContaining({ listingType: "SALE", category: "LAND", location: "Kasoa" }), 1);
    expect((await advanceOfficialConversation(input("commercial", found.state), deps)).reply).toBe(COMMERCIAL_PROMPT);
    expect((await advanceOfficialConversation(input("book a viewing", found.state), deps)).reply).toBe(VIEWING_PROMPT);
  });

  it("2 / Manage My Properties shows the linked account, and asks an unlinked number to link", async () => {
    expect((await advanceOfficialConversation(input("2"), dependencies().deps)).reply).toContain("Reply link to connect it.");
    const linkedUser = vi.fn(async () => ({ identityId: "i", user: { id: "u", displayName: "Kofi Mensah" } }));
    expect((await advanceOfficialConversation(input("account"), dependencies({ linkedUser }).deps)).reply).toContain("Kofi Mensah");
  });

  it.each([["3", "list a property"], ["4", "register agent"], ["5", "register services"], ["8", "my applications"]])("%s runs the existing %s business flow", async (number, command) => {
    const business = vi.fn(async (args: { body: string }) => (args.body === command ? { state: { workflow: "business" }, reply: `started ${command}` } : null));
    const result = await advanceOfficialConversation(input(number), dependencies({ business }).deps);
    expect(result.reply).toBe(`started ${command}`);
  });

  it("6 / Landlord or Property Manager starts the existing landlord onboarding", async () => {
    const { deps } = dependencies();
    const result = await advanceOfficialConversation(input("6"), deps);
    expect((deps as { onboarding: ReturnType<typeof vi.fn> }).onboarding).toHaveBeenCalledWith(expect.objectContaining({ body: "register" }));
    expect(result.state).toMatchObject({ workflow: "onboarding" });
  });

  it("7 / Find Property Services starts the verified provider search", async () => {
    const result = await advanceOfficialConversation(input("7"), dependencies().deps);
    expect(result.state).toMatchObject({ workflow: "service_search" });
    expect(result.reply).toBe("What service do you need?");
  });

  it("9 / Help & Support hands the conversation to the support queue", async () => {
    expect((await advanceOfficialConversation(input("9"), dependencies().deps)).handoff).toBe(true);
  });

  it("More options lists agency registration, agent search, linking and status", async () => {
    expect((await advanceOfficialConversation(input("more options"), dependencies().deps)).reply).toBe(MORE_OPTIONS);
  });

  it("finds verified agents by area with profile links only", async () => {
    const { deps } = dependencies();
    const asked = await advanceOfficialConversation(input("find an agent"), deps);
    const found = await advanceOfficialConversation(input("East Legon", asked.state), deps);
    expect(found.reply).toContain(agentCard);
    expect(found.reply).not.toMatch(/\+?233\d{9}/);
    await advanceOfficialConversation(input("more", found.state), deps);
    expect((deps as { agents: ReturnType<typeof vi.fn> }).agents).toHaveBeenLastCalledWith("East Legon", 2);
  });

  it("treats a bare number in an open search as a fresh menu choice, but a word as a filter", async () => {
    const { deps } = dependencies();
    const searching = { workflow: "property_search", property: { listingType: "RENT", location: "osu" } };
    expect((await advanceOfficialConversation(input("1", searching), deps)).reply).toBe(FIND_PROPERTY_PROMPT);
    const filter = await advanceOfficialConversation(input("land", searching), deps);
    expect(filter.state).toMatchObject({ property: { listingType: "RENT", location: "osu", category: "LAND" } });
  });

  it("goes back with back and starts again with restart, keeping submitted requests", async () => {
    const { deps } = dependencies();
    const searching = { workflow: "property_search", property: { listingType: "RENT" } };
    const back = await advanceOfficialConversation(input("back", searching), deps);
    expect(back.reply).toContain("🏡 Welcome to NesAfric!");
    expect(back.state).toMatchObject({ paused: true });
    const restart = await advanceOfficialConversation(input("restart", searching), deps);
    expect(restart.reply).toContain("Submitted requests are unchanged.");
    expect(restart.state).toMatchObject({ workflow: "idle" });
  });

  it("does not turn numbers into menu choices while a name or viewing time is typed", async () => {
    const { deps } = dependencies();
    const result = await advanceOfficialConversation(input("7", { workflow: "viewing", step: "name", selectedListingId: "2c7e1b3a-4d5f-4a6b-8c9d-0e1f2a3b4c5d" }), deps);
    expect(result.state).toMatchObject({ workflow: "viewing" });
  });
});
