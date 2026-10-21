import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppChannelAdapter } from "@/modules/conversations/channels/whatsapp";
import { parseWhatsAppInteractive, replyButtons } from "@/modules/conversations/channels/whatsapp-interactive";
import { advanceConversation, MAIN_MENU, mainMenuList, OFFICIAL_MAIN_MENU } from "@/modules/whatsapp-assistant/engine";
import { advanceOfficialConversation, OFFICIAL_MENU_SUFFIX } from "@/modules/whatsapp-assistant/router";

const MENU_INTRO = "Welcome to NesAfric! 🏡\nTap \"Choose an option\" below, or tell me what you need. Business registration and listing currently continue securely on the website. Use menu, resume or cancel at any time.";
const MENU_ROWS = [
  { id: "1", title: "Find a property" },
  { id: "2", title: "Find a service provider" },
  { id: "3", title: "Register agency", description: "Register a real estate business or agency" },
  { id: "4", title: "Register agent/landlord", description: "Register as an agent or landlord" },
  { id: "5", title: "List a property" },
  { id: "6", title: "Register as provider", description: "Register a service business" },
  { id: "7", title: "Check my request" },
  { id: "8", title: "Talk to support" },
];

describe("WhatsApp interactive send", () => {
  const adapter = new WhatsAppChannelAdapter();
  const request = { organisationId: "o", conversationId: "c", messageId: "m", channel: "WHATSAPP" as const, recipientAddress: "233241234567", fromAddress: null, body: "fallback text", config: { phoneNumberId: "999" }, lastInboundAt: new Date() };
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const configure = () => {
    vi.stubEnv("WHATSAPP_PROVIDER_ACCESS_TOKEN", "token");
    vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "v21.0");
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ messages: [{ id: "wamid.ok" }] })));
    vi.stubGlobal("fetch", fetch);
    return () => ({ url: fetch.mock.calls[0][0], body: JSON.parse(String(fetch.mock.calls[0][1].body)) });
  };

  it("sends the main menu as an interactive list with the exact Graph request body", async () => {
    const sent = configure();
    const interactive = mainMenuList(MAIN_MENU)!;
    await expect(adapter.send({ ...request, body: MAIN_MENU, whatsappInteractive: interactive })).resolves.toMatchObject({ status: "SENT", providerReference: "wamid.ok" });
    expect(sent().url).toBe("https://graph.facebook.com/v21.0/999/messages");
    expect(sent().body).toEqual({
      messaging_product: "whatsapp",
      to: "233241234567",
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: MENU_INTRO },
        action: { button: "Choose an option", sections: [{ title: "How can we help?", rows: MENU_ROWS }] },
      },
    });
  });

  it("sends reply buttons with the exact Graph request body", async () => {
    const sent = configure();
    const interactive = replyButtons("Reply confirm to send it, edit to describe it again, or cancel.", [{ id: "confirm", title: "Confirm" }, { id: "edit", title: "Edit" }, { id: "cancel", title: "Cancel" }]);
    await adapter.send({ ...request, whatsappInteractive: interactive });
    expect(sent().body).toEqual({
      messaging_product: "whatsapp",
      to: "233241234567",
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Reply confirm to send it, edit to describe it again, or cancel." },
        action: { buttons: [
          { type: "reply", reply: { id: "confirm", title: "Confirm" } },
          { type: "reply", reply: { id: "edit", title: "Edit" } },
          { type: "reply", reply: { id: "cancel", title: "Cancel" } },
        ] },
      },
    });
  });

  it("is a session message: a closed customer-service window still blocks it", async () => {
    const sent = vi.fn();
    vi.stubEnv("WHATSAPP_PROVIDER_ACCESS_TOKEN", "token");
    vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "v21.0");
    vi.stubGlobal("fetch", sent);
    await expect(adapter.send({ ...request, whatsappInteractive: mainMenuList(MAIN_MENU), lastInboundAt: new Date(Date.now() - 25 * 3_600_000) }))
      .resolves.toMatchObject({ status: "FAILED", retryable: false, failureReason: expect.stringContaining("customer service window") });
    expect(sent).not.toHaveBeenCalled();
  });

  it("sends a template, not the interactive payload, when both are set", async () => {
    const sent = configure();
    await adapter.send({ ...request, whatsappTemplate: { name: "nesafric_notification", language: "en" }, whatsappInteractive: mainMenuList(MAIN_MENU) });
    expect(sent().body).toMatchObject({ type: "template" });
    expect(sent().body.interactive).toBeUndefined();
  });

  it("falls back to the plain-text body when the stored payload breaks WhatsApp's limits", async () => {
    const sent = configure();
    const tooMany = { type: "button", body: "Pick one", buttons: [1, 2, 3, 4].map((n) => ({ id: String(n), title: `Option ${n}` })) };
    await adapter.send({ ...request, whatsappInteractive: tooMany as never });
    expect(sent().body).toEqual({ messaging_product: "whatsapp", to: "233241234567", type: "text", text: { body: "fallback text" } });
  });
});

describe("WhatsApp interactive limits", () => {
  it("rejects more than 10 list rows, titles over 24 characters and duplicate ids", () => {
    const list = (rows: Array<{ id: string; title: string }>) => ({ type: "list", body: "Menu", button: "Open", sections: [{ rows }] });
    expect(parseWhatsAppInteractive(list(Array.from({ length: 10 }, (_, index) => ({ id: String(index), title: `Row ${index}` }))))).toBeDefined();
    expect(parseWhatsAppInteractive(list(Array.from({ length: 11 }, (_, index) => ({ id: String(index), title: `Row ${index}` }))))).toBeUndefined();
    expect(parseWhatsAppInteractive(list([{ id: "1", title: "x".repeat(25) }]))).toBeUndefined();
    expect(parseWhatsAppInteractive(list([{ id: "1", title: "A" }, { id: "1", title: "B" }]))).toBeUndefined();
  });

  it("drops reply buttons when the prompt is longer than a button message allows", () => {
    expect(replyButtons("x".repeat(1025), [{ id: "confirm", title: "Confirm" }])).toBeUndefined();
    expect(replyButtons("ok?", [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }, { id: "d", title: "D" }])).toBeUndefined();
  });

  it("keeps every main-menu row title within 24 characters and every row id a command the assistant handles", () => {
    const official = mainMenuList(MAIN_MENU + OFFICIAL_MENU_SUFFIX, true)!;
    expect(official.type).toBe("list");
    const rows = official.type === "list" ? official.sections.flatMap((section) => section.rows) : [];
    expect(rows.map((row) => row.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "link", "account"]);
    expect(rows.every((row) => row.title.length <= 24)).toBe(true);
  });
});

describe("assistant replies carry the menu list and plain-text fallback", () => {
  const input = (body: string, state: unknown = {}) => ({ state, body, kind: "text", phone: "233241234567", conversationId: "c", messageId: "m", defaultCountry: "GH", defaultCurrency: "GHS" });
  const dependencies = { tools: {} as never, interpret: vi.fn() as never };

  it("sends the menu as a list and keeps the numbered menu as the stored text", async () => {
    const result = await advanceConversation(input("menu"), dependencies);
    expect(result.reply).toBe(MAIN_MENU);
    expect(result.interactive).toEqual({ type: "list", body: MENU_INTRO, button: "Choose an option", sections: [{ title: "How can we help?", rows: MENU_ROWS }] });
  });

  it("keeps the surrounding text of a reply that embeds the menu", async () => {
    const result = await advanceConversation(input("cancel"), dependencies);
    expect(result.reply).toContain(MAIN_MENU);
    expect(result.interactive?.body).toBe(`The current conversation workflow is cancelled. Submitted requests are unchanged.\n\n${MENU_INTRO}`);
  });

  it("offers confirm and cancel buttons for a pending submission", async () => {
    const state = { workflow: "inquiry", step: "confirm", selectedListingId: "2c7e1b3a-4d5f-4a6b-8c9d-0e1f2a3b4c5d", name: "Ama", message: "Is it available?" };
    const result = await advanceConversation(input("maybe", state), dependencies);
    expect(result.interactive).toEqual({ type: "button", body: result.reply, buttons: [{ id: "confirm", title: "Confirm" }, { id: "cancel", title: "Cancel" }] });
  });

  it("adds the official rows on the official number", async () => {
    const result = await advanceOfficialConversation({ ...input("menu"), organisationId: "11111111-1111-4111-8111-111111111111" }, {
      engine: advanceConversation, providerMessage: vi.fn(async () => null), network: vi.fn(async () => null), report: vi.fn(async () => null), rules: vi.fn(async () => null), jobs: vi.fn(async () => null), landlord: vi.fn(async () => null), linkedUser: vi.fn(async () => null), business: vi.fn(async () => null),
    } as never);
    // On the official number registration and listing happen in the conversation.
    expect(result.reply).toBe(OFFICIAL_MAIN_MENU + OFFICIAL_MENU_SUFFIX);
    expect(result.interactive?.body).toBe(MENU_INTRO.replace(" Business registration and listing currently continue securely on the website.", "") + OFFICIAL_MENU_SUFFIX);
    expect(result.interactive?.type === "list" && result.interactive.sections[0].rows.map((row) => row.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "link", "account"]);
  });
});
