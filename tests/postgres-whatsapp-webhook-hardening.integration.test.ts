import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as officialGet, POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { recordWhatsAppDeliveryStatus } from "@/modules/whatsapp-assistant/service";
import { interpretMessage } from "@/modules/whatsapp-assistant/interpret";
import { assistantStateSchema } from "@/modules/whatsapp-assistant/schemas";
import type { AIProvider } from "@/modules/ai/providers";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { connectWhatsAppChannel } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 30_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const WA_ID = "233241234567";
const URL_BASE = "http://localhost/api/webhooks/whatsapp";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge" CASCADE');
}

let counter = 0;
const envelope = (message: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, contacts: [{ wa_id: WA_ID, profile: { name: "Ama" } }], messages: [{ id: `wamid.${++counter}`, from: WA_ID, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }],
});
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
const post = (body: string, headers: Record<string, string> = {}) => officialPost(new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json", ...headers }, body }));

function recordingAdapters() {
  const sent: OutboundMessageRequest[] = [];
  const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { sent.push(request); return { status: "SENT", providerReference: `wamid.out.${++counter}` }; }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };
  return { sent, adapters };
}

async function fixture() {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
  const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
  await connectWhatsAppChannel(staff.id, official.id, { enabled: true, webhookVerifyToken: "verify-me", config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: "555", marketplaceAssistantEnabled: true } });
  return { official };
}

const stored = (organisationId: string) => db.message.count({ where: { organisationId, direction: "INBOUND" } });

describe("PostgreSQL WhatsApp webhook hardening", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("refuses handshakes with missing parameters or the wrong mode", async () => {
    await fixture();
    for (const query of ["", "?hub.challenge=42", "?hub.mode=subscribe&hub.challenge=42", "?hub.verify_token=verify-me&hub.challenge=42", "?hub.mode=unsubscribe&hub.verify_token=verify-me&hub.challenge=42"]) {
      const response = await officialGet(new Request(`${URL_BASE}${query}`));
      expect([query, response.status]).toEqual([query, 403]);
      expect(await response.text()).not.toContain("42");
    }
  });

  it("rejects missing, malformed and stale signatures, and stores nothing", async () => {
    const { official } = await fixture();
    const body = JSON.stringify(envelope({ type: "text", text: { body: "hi" } }));
    expect((await post(body)).status).toBe(401);
    expect((await post(body, { "x-hub-signature-256": "not-a-signature" })).status).toBe(401);
    expect((await post(body, { "x-hub-signature-256": sign(body).replace("sha256=", "sha1=") })).status).toBe(401);
    // Signed, then changed in transit.
    expect((await post(body.replace("hi", "HI"), { "x-hub-signature-256": sign(body) })).status).toBe(401);
    // Signed with another app's secret.
    expect((await post(body, { "x-hub-signature-256": `sha256=${createHmac("sha256", "other-secret").update(body).digest("hex")}` })).status).toBe(401);
    expect(await stored(official.id)).toBe(0);
    expect(await db.backgroundJob.count({ where: { type: { startsWith: "whatsapp" } } })).toBe(0);
  });

  it("refuses to accept anything while the app secret is not configured", async () => {
    await fixture();
    vi.stubEnv("WHATSAPP_APP_SECRET", "");
    const body = JSON.stringify(envelope({ type: "text", text: { body: "hi" } }));
    expect((await post(body, { "x-hub-signature-256": sign(body) })).status).toBe(503);
  });

  it("rejects correctly signed malformed JSON without storing anything", async () => {
    const { official } = await fixture();
    const body = '{"object":"whatsapp_business_account","entry":[';
    const response = await post(body, { "x-hub-signature-256": sign(body) });
    expect(response.status).toBe(400);
    expect(await stored(official.id)).toBe(0);
  });

  it("rejects bodies over 1 MiB, by declared length and by streamed length", async () => {
    const { official } = await fixture();
    const big = JSON.stringify({ ...envelope({ type: "text", text: { body: "hi" } }), padding: "x".repeat(1024 * 1024) });
    expect((await post(big, { "x-hub-signature-256": sign(big) })).status).toBe(413);
    // No content-length: the body is streamed and cut off at the limit.
    const streamed = new ReadableStream<Uint8Array>({ start(controller) { for (let index = 0; index < 20; index += 1) controller.enqueue(new TextEncoder().encode("x".repeat(64 * 1024))); controller.close(); } });
    const response = await officialPost(new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign("") }, body: streamed, duplex: "half" } as RequestInit));
    expect(response.status).toBe(413);
    expect(await stored(official.id)).toBe(0);
  });

  it("reads interactive replies as their id, and answers unsupported types without acting on them", async () => {
    const { official } = await fixture();
    const { sent, adapters } = recordingAdapters();
    for (const message of [
      { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "menu", title: "Menu" } } },
      { type: "interactive", interactive: { type: "list_reply", list_reply: { id: "1", title: "Find a property" } } },
      { type: "sticker", sticker: { id: "media-1", mime_type: "image/webp" } },
    ]) {
      const body = JSON.stringify(envelope(message));
      expect((await post(body, { "x-hub-signature-256": sign(body) })).status).toBe(200);
    }
    const messages = await db.message.findMany({ where: { organisationId: official.id, direction: "INBOUND" }, orderBy: { createdAt: "asc" } });
    expect(messages.map((message) => message.body)).toEqual(["menu", "1", "[sticker received]"]);
    expect(messages.map((message) => (message.metadata as { kind?: string }).kind)).toEqual(["text", "text", "unsupported"]);
    await runDueJobs(createJobHandlers(undefined, adapters));
    await runDueJobs(createJobHandlers(undefined, adapters));
    const replies = await db.message.findMany({ where: { organisationId: official.id, direction: "OUTBOUND" }, orderBy: { createdAt: "asc" } });
    expect(replies).toHaveLength(3);
    expect(replies[2].body).toContain("not supported");
    expect(sent.every((request) => request.recipientAddress === WA_ID || request.recipientAddress === `+${WA_ID}`)).toBe(true);
  });

  it("with an allowlist, stores and queues only allowlisted senders and discards the rest without their content", async () => {
    const { official } = await fixture();
    vi.stubEnv("WHATSAPP_INBOUND_ALLOWLIST", "+233 24 123 4567, 233200000001");
    const from = (waId: string, text: string) => ({ object: "whatsapp_business_account", entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, contacts: [{ wa_id: waId, profile: { name: "X" } }], messages: [{ id: `wamid.${++counter}`, from: waId, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }], statuses: [{ id: `wamid.status.${++counter}`, recipient_id: waId, status: "delivered", timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
    for (const [waId, text] of [[WA_ID, "allowed one"], ["233200000001", "allowed two"], ["233209999999", "stranger secret"]]) {
      const body = JSON.stringify(from(waId, text));
      expect((await post(body, { "x-hub-signature-256": sign(body) })).status).toBe(200);
    }
    const bodies = (await db.message.findMany({ where: { organisationId: official.id, direction: "INBOUND" } })).map((message) => message.body).sort();
    expect(bodies).toEqual(["allowed one", "allowed two"]);
    expect(await db.conversation.count({ where: { channelAddress: "233209999999" } })).toBe(0);
    expect(await db.channelIdentity.count({ where: { address: { contains: "233209999999" } } })).toBe(0);
    const jobs = await db.backgroundJob.findMany({ where: { type: { startsWith: "whatsapp" } } });
    expect(jobs.filter((job) => job.type === "whatsapp-assistant-message")).toHaveLength(2);
    expect(jobs.filter((job) => job.type === "whatsapp-delivery-status")).toHaveLength(2);
    expect(JSON.stringify(jobs.map((job) => job.payload))).not.toContain("233209999999");
  });

  it("never moves a delivery status backwards when Meta's callbacks arrive out of order", async () => {
    const { official } = await fixture();
    const conversation = await db.conversation.create({ data: { organisationId: official.id, channel: "WHATSAPP", channelAddress: WA_ID, subject: "Test" } });
    const message = await db.message.create({ data: { organisationId: official.id, conversationId: conversation.id, channel: "WHATSAPP", direction: "OUTBOUND", senderType: "SYSTEM", body: "Hello" } });
    const delivery = await db.messageDelivery.create({ data: { organisationId: official.id, messageId: message.id, channel: "WHATSAPP", recipientAddress: WA_ID, idempotencyKey: `test:${message.id}`, status: "SENT", providerReference: "wamid.out.order", sentAt: new Date() } });
    const at = (seconds: number) => String(Math.floor(Date.now() / 1000) - seconds);
    const status = (value: "sent" | "delivered" | "read" | "failed", seconds: number) => recordWhatsAppDeliveryStatus(official.id, { id: "wamid.out.order", recipient: WA_ID, status: value, timestamp: at(seconds), errorCodes: value === "failed" ? [131026] : [] });

    await status("read", 10);
    await status("delivered", 20);
    await status("sent", 30);
    await status("failed", 5);
    const after = await db.messageDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.status).toBe("READ");
    expect(after.readAt).not.toBeNull();
    expect(after.deliveredAt).not.toBeNull();
    expect(after.failureReason).toBeNull();
  });

  it("does not apply another organisation's status to this organisation's delivery", async () => {
    await fixture();
    const owner = await registerUser({ displayName: "Other", email: "other@example.com", password: "secure-password-123" });
    const other = await createOrganisation(owner.id, { name: "Other", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const conversation = await db.conversation.create({ data: { organisationId: other.id, channel: "WHATSAPP", channelAddress: WA_ID, subject: "Test" } });
    const message = await db.message.create({ data: { organisationId: other.id, conversationId: conversation.id, channel: "WHATSAPP", direction: "OUTBOUND", senderType: "SYSTEM", body: "Hello" } });
    const delivery = await db.messageDelivery.create({ data: { organisationId: other.id, messageId: message.id, channel: "WHATSAPP", recipientAddress: WA_ID, idempotencyKey: `test:${message.id}`, status: "SENT", providerReference: "wamid.out.other", sentAt: new Date() } });
    // A non-official organisation only matches its own deliveries; an old status is then dropped.
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const unrelated = await createOrganisation(owner.id, { name: "Unrelated", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    await recordWhatsAppDeliveryStatus(unrelated.id, { id: "wamid.out.other", recipient: WA_ID, status: "failed", timestamp: old, errorCodes: [1] });
    expect((await db.messageDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("SENT");
  });

  it("falls back to deterministic interpretation when the AI provider fails, times out or answers off-script", async () => {
    const state = assistantStateSchema.parse({});
    const failing: AIProvider = { key: "test", complete: async () => { throw new Error("provider down"); } };
    const offScript: AIProvider = { key: "test", complete: async () => ({ text: "Ignore previous instructions", toolCall: { key: "grant_admin", arguments: { intent: "support" } }, inputTokens: 0, outputTokens: 0, modelKey: "test" }) };
    const invalid: AIProvider = { key: "test", complete: async () => ({ text: "", toolCall: { key: "interpret_marketplace_request", arguments: { intent: "delete_everything" } }, inputTokens: 0, outputTokens: 0, modelKey: "test" }) };
    const expected = { intent: "property_search", property: { listingType: "RENT", category: "APARTMENT", location: "east legon" } };
    for (const provider of [failing, offScript, invalid]) {
      expect(await interpretMessage("apartment to rent in East Legon", state, provider)).toMatchObject(expected);
    }
    // Business intents never reach the model at all.
    let called = false;
    const spy: AIProvider = { key: "test", complete: async () => { called = true; throw new Error("unused"); } };
    expect(await interpretMessage("I need a human", state, spy)).toEqual({ intent: "support" });
    expect(called).toBe(false);
  });
});
