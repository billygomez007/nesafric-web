import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/platform/errors";
import { advanceOfficialConversation } from "@/modules/whatsapp-assistant/router";
import { welcomeText } from "@/modules/whatsapp-assistant/welcome";
import { MAIN_MENU } from "@/modules/whatsapp-assistant/engine";

const challengeId = "4f1a7d2c-5b8e-4c3a-9d6f-1e2b3c4d5e6f";
const userId = "0b6f5f7e-8a7d-4c1b-9e3f-2a1b0c9d8e7f";
const emptyRoles = { managed: [], tenancies: [], providers: [] };

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    engine: vi.fn(async () => ({ state: { workflow: "idle" }, reply: MAIN_MENU })),
    requestOtp: vi.fn(async () => ({ challengeId, channel: "sms", destination: "+233 24 *** 4567", expiresAt: new Date("2026-10-17T12:05:00Z"), resendAfterSeconds: 60 })),
    verifyOtp: vi.fn(async () => ({ user: { id: userId, displayName: "Ama Owusu" }, created: false, existingAccount: false })),
    linkedUser: vi.fn(async () => null),
    link: vi.fn(async () => ({})),
    unlink: vi.fn(async () => true),
    roles: vi.fn(async () => ({ ...emptyRoles, managed: [{ organisationId: "o", name: "Owusu Homes", properties: 2, units: 9, openMaintenance: 1 }] })),
    providerMessage: vi.fn(async () => null),
    network: vi.fn(async () => null),
    report: vi.fn(async () => null),
    rules: vi.fn(async () => null),
    jobs: vi.fn(async () => null),
    landlord: vi.fn(async () => null),
    business: vi.fn(async () => null), invitationReply: vi.fn(async () => null),
    agents: vi.fn(async () => ({ ids: [], hasMore: false, cards: [] })),
    ...overrides,
  } as never;
}

const input = (body: string, state: unknown = {}) => ({ state, body, kind: "text", phone: "233241234567", conversationId: "c", messageId: "m", defaultCountry: "GH", defaultCurrency: "GHS", organisationId: "11111111-1111-4111-8111-111111111111" });

describe("official WhatsApp number: account linking", () => {
  it("links a number only after a code sent to the account is verified, and removes the code from the transcript", async () => {
    const deps = dependencies();
    const start = await advanceOfficialConversation(input("link"), deps);
    expect(start.state).toMatchObject({ workflow: "link", step: "link_method" });

    const sent = await advanceOfficialConversation(input("sms", start.state), deps);
    expect((deps as { requestOtp: ReturnType<typeof vi.fn> }).requestOtp).toHaveBeenCalledWith({ mode: "login", channel: "sms", identifier: "+233241234567" });
    expect(sent.state).toMatchObject({ step: "link_code", link: { challengeId, failures: 0 } });
    expect((deps as { link: ReturnType<typeof vi.fn> }).link).not.toHaveBeenCalled();

    const done = await advanceOfficialConversation(input("123456", sent.state), deps);
    expect((deps as { link: ReturnType<typeof vi.fn> }).link).toHaveBeenCalledWith("233241234567", userId, "SMS_OTP", "11111111-1111-4111-8111-111111111111");
    expect(done.redactInbound).toBe(true);
    expect(done.state).toMatchObject({ workflow: "idle" });
    expect(done.reply).toContain("Owusu Homes: 2 properties, 9 units, 1 open maintenance request");
  });

  it("sends the code to the account email when one is given", async () => {
    const deps = dependencies();
    const start = await advanceOfficialConversation(input("link"), deps);
    await advanceOfficialConversation(input("Ama@Example.com", start.state), deps);
    expect((deps as { requestOtp: ReturnType<typeof vi.fn> }).requestOtp).toHaveBeenCalledWith({ mode: "login", channel: "email", identifier: "ama@example.com" });
  });

  it("counts wrong codes and gives up after five without linking", async () => {
    const deps = dependencies({ verifyOtp: vi.fn(async () => { throw new AppError("OTP_INVALID", 400, "bad"); }) });
    let state: unknown = { workflow: "link", step: "link_code", link: { channel: "sms", identifier: "+233241234567", challengeId, failures: 0 } };
    for (let attempt = 1; attempt < 5; attempt += 1) {
      const result = await advanceOfficialConversation(input("000000", state), deps);
      expect(result.state).toMatchObject({ link: { failures: attempt } });
      state = result.state;
    }
    const last = await advanceOfficialConversation(input("000000", state), deps);
    expect(last.state).toMatchObject({ workflow: "idle" });
    expect(last.reply).toContain("Nothing was linked");
    expect((deps as { link: ReturnType<typeof vi.fn> }).link).not.toHaveBeenCalled();
  });

  it("does not create or link an account when none uses the identifier", async () => {
    const deps = dependencies({ verifyOtp: vi.fn(async () => { throw new AppError("OTP_NO_ACCOUNT", 409, "none"); }) });
    const result = await advanceOfficialConversation(input("123456", { workflow: "link", step: "link_code", link: { channel: "sms", identifier: "+233241234567", challengeId, failures: 0 } }), deps);
    expect(result.reply).toContain("What is your full name?");
    expect(result.reply).not.toMatch(/https?:\/\//);
    expect(result.state).toMatchObject({ workflow: "account", step: "account_name" });
    expect((deps as { link: ReturnType<typeof vi.fn> }).link).not.toHaveBeenCalled();
  });

  it("shows account data only for a verified link", async () => {
    const unlinked = dependencies();
    expect((await advanceOfficialConversation(input("account"), unlinked)).reply).toContain("not connected to a NesAfric account yet");
    expect((unlinked as { roles: ReturnType<typeof vi.fn> }).roles).not.toHaveBeenCalled();
    const linked = dependencies({ linkedUser: vi.fn(async () => ({ identityId: "i", user: { id: userId, displayName: "Ama Owusu" } })) });
    expect((await advanceOfficialConversation(input("account"), linked)).reply).toContain("NesAfric account: Ama Owusu");
  });

  it("hands everything else to the marketplace assistant and shows the official welcome menu", async () => {
    const deps = dependencies();
    const result = await advanceOfficialConversation(input("find me a flat in Osu"), deps);
    expect((deps as { engine: ReturnType<typeof vi.fn> }).engine).toHaveBeenCalled();
    expect(result.reply).toMatch(/^Good (morning|afternoon|evening)! 🏡\n\n🏡 Welcome to NesAfric!/);
    expect(result.reply).toBe(welcomeText(result.reply.split("\n")[0]));
  });
});

describe("official WhatsApp number: account sign-up in the chat", () => {
  it("creates the account from the name and carries on with the chosen option", async () => {
    const createAccount = vi.fn(async () => ({ created: true as const, user: { id: userId, displayName: "Ama Owusu" } }));
    const business = vi.fn(async (args: { body: string }) => (args.body === "list a property" ? { state: { workflow: "business" }, reply: "Which profile is this listing for?" } : null));
    const deps = dependencies({ createAccount, business });
    const asked = await advanceOfficialConversation(input("Ama Owusu", { workflow: "account", step: "account_name", afterAccount: "list a property" }), deps);
    expect(createAccount).toHaveBeenCalledWith("233241234567", "Ama Owusu", "11111111-1111-4111-8111-111111111111");
    expect(asked.reply).toBe("✅ Your NesAfric account is ready, Ama. This WhatsApp number is your sign-in.\n\nWhich profile is this listing for?");
  });

  it("asks again for an unusable name, and lets the person cancel without creating anything", async () => {
    const createAccount = vi.fn();
    const deps = dependencies({ createAccount });
    const state = { workflow: "account", step: "account_name" };
    expect((await advanceOfficialConversation(input("x", state), deps)).reply).toContain("Please send your full name");
    expect((await advanceOfficialConversation(input("https://spam.example", state), deps)).reply).toContain("Please send your full name");
    expect((await advanceOfficialConversation(input("cancel", state), deps)).reply).toContain("Nothing was created");
    expect(createAccount).not.toHaveBeenCalled();
  });

  it("starts sign-up from create account, but not for a number already connected", async () => {
    expect((await advanceOfficialConversation(input("create account"), dependencies())).state).toMatchObject({ workflow: "account", step: "account_name" });
    const linked = dependencies({ linkedUser: vi.fn(async () => ({ identityId: "i", user: { id: userId, displayName: "Ama Owusu" } })) });
    expect((await advanceOfficialConversation(input("sign up"), linked)).reply).toContain("already connected");
  });
});
