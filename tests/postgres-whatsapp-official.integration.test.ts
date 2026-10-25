import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No real SMS ever leaves a test: a fake Arkesel OTP authority generates and checks codes.
const sms = vi.hoisted(() => ({ codes: new Map<string, string>() }));
vi.mock("@/modules/messaging/otp-provider", () => ({
  getSmsOtpProvider: () => ({
    configured: true,
    expiryMinutes: 5,
    generate: async (numberE164: string) => { sms.codes.set(numberE164, String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")); },
    verify: async (numberE164: string, code: string) => (sms.codes.get(numberE164) === code ? { ok: true, provider: "arkesel" } : { ok: false, provider: "arkesel", reason: "invalid", providerCode: "1104" }),
  }),
}));

import { GET as officialGet, POST as officialPost } from "@/app/api/webhooks/whatsapp/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { recordWhatsAppDeliveryStatus } from "@/modules/whatsapp-assistant/service";

import { deliverNotification } from "@/modules/notifications/service";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { NonRetryableJobError } from "@/platform/jobs/errors";
import { retryBackgroundJob, runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { connectWhatsAppChannel } from "./helpers/whatsapp-channel";

// The first test pays for compiling the route modules.
vi.setConfig({ testTimeout: 30_000 });

const SECRET = "test-app-secret";
const PHONE_NUMBER_ID = "100200300";
const WA_ID = "233241234567";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge" CASCADE');
  await db.tenant.deleteMany();
}

let counter = 0;
const inbound = (body: string, id = `wamid.${++counter}`) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, contacts: [{ wa_id: WA_ID, profile: { name: "Ama" } }], messages: [{ id, from: WA_ID, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }],
});

function signed(payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return new Request("http://localhost/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature ?? `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}` },
    body,
  });
}

/** Records every WhatsApp send instead of calling Meta. */
function recordingAdapters(result: () => Awaited<ReturnType<ChannelAdapters["WHATSAPP"]["send"]>> = () => ({ status: "SENT", providerReference: `wamid.out.${++counter}` })) {
  const sent: OutboundMessageRequest[] = [];
  const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { sent.push(request); return result(); }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };
  return { sent, adapters };
}

async function receive(body: string) {
  const response = await officialPost(signed(inbound(body)));
  expect(response.status).toBe(200);
}

async function work(adapters: ChannelAdapters) {
  // Two passes: the assistant job queues the reply, the delivery job sends it.
  await runDueJobs(createJobHandlers(undefined, adapters));
  await runDueJobs(createJobHandlers(undefined, adapters));
}

async function fixture() {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
  const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
  await connectWhatsAppChannel(staff.id, official.id, { enabled: true, webhookVerifyToken: "verify-me", config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: "555", marketplaceAssistantEnabled: true } });
  const landlord = await registerUser({ displayName: "Ama Owusu", email: "ama@example.com", password: "secure-password-123" });
  await db.user.update({ where: { id: landlord.id }, data: { phoneE164: `+${WA_ID}`, phoneVerifiedAt: new Date() } });
  const landlordOrganisation = await createOrganisation(landlord.id, { name: "Owusu Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  await createProperty(landlord.id, landlordOrganisation.id, { name: "Palm Court", referenceNumber: "PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }, { name: "A2" }] });
  return { staff, official, landlord, landlordOrganisation };
}

const conversationFor = (organisationId: string) => db.conversation.findFirstOrThrow({ where: { organisationId, channel: "WHATSAPP" } });
const lastReply = async (conversationId: string) => (await db.message.findFirstOrThrow({ where: { conversationId, direction: "OUTBOUND" }, orderBy: { createdAt: "desc" } })).body;

describe("PostgreSQL official WhatsApp number", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("OTP_HASH_SECRET", "x".repeat(40));
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("verifies the webhook handshake and signature, and stores a redelivered message once", async () => {
    const { official } = await fixture();
    const handshake = await officialGet(new Request("http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42"));
    expect(await handshake.text()).toBe("42");
    expect((await officialGet(new Request("http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42"))).status).toBe(403);
    expect((await officialPost(signed(inbound("hi"), "sha256=deadbeef"))).status).toBe(401);

    const payload = inbound("menu", "wamid.same");
    expect((await officialPost(signed(payload))).status).toBe(200);
    expect((await officialPost(signed(payload))).status).toBe(200);
    expect(await db.message.count({ where: { organisationId: official.id, externalMessageId: "wamid.same" } })).toBe(1);
    expect(await db.backgroundJob.count({ where: { type: "whatsapp-assistant-message" } })).toBe(1);

    const identity = await db.channelIdentity.findUniqueOrThrow({ where: { channel_address: { channel: "WHATSAPP", address: `+${WA_ID}` } } });
    expect(identity.userId).toBeNull();
  });

  it("acknowledges a batch with an unrecognised item and keeps the valid message", async () => {
    const { official } = await fixture();
    const payload = inbound("menu", "wamid.good");
    (payload.entry[0].changes[0].value.messages as unknown[]).push({ id: "wamid.bad", from: "abc" });
    const response = await officialPost(signed(payload));
    expect(response.status).toBe(200);
    expect(await db.message.count({ where: { organisationId: official.id, direction: "INBOUND" } })).toBe(1);
  });

  it("links the number to an account only after the SMS code is entered, and removes the code from the transcript", async () => {
    const { official, landlord } = await fixture();
    const { adapters, sent } = recordingAdapters();
    await receive("link");
    await work(adapters);
    await receive("sms");
    await work(adapters);
    expect(await db.channelIdentity.findFirst({ where: { userId: landlord.id } })).toBeNull();

    const code = sms.codes.get(`+${WA_ID}`)!;
    await receive(code);
    await work(adapters);
    const identity = await db.channelIdentity.findUniqueOrThrow({ where: { channel_address: { channel: "WHATSAPP", address: `+${WA_ID}` } } });
    expect(identity).toMatchObject({ userId: landlord.id, verificationMethod: "SMS_OTP" });
    expect(await db.message.count({ where: { organisationId: official.id, body: code } })).toBe(0);
    expect(sent.at(-1)?.body).toContain("Owusu Homes: 1 property, 2 units, 0 open maintenance requests");
    expect(await db.auditEvent.count({ where: { action: "channel_identity.linked", entityId: identity.id } })).toBe(1);
  });

  it("queues the main menu as a tappable list with the numbered menu stored as its fallback, and handles a tapped row", async () => {
    const { official } = await fixture();
    const { adapters, sent } = recordingAdapters();
    await receive("menu");
    await work(adapters);
    const conversation = await conversationFor(official.id);
    const reply = await db.message.findFirstOrThrow({ where: { conversationId: conversation.id, direction: "OUTBOUND" } });
    expect(reply.body).toMatch(/^Good (morning|afternoon|evening)(, \p{L}+)?! 🏡\n\n🏡 Welcome to NesAfric!/u);
    const interactive = (reply.metadata as { whatsappInteractive: { type: string; body: string; button: string; sections: Array<{ rows: Array<{ id: string; title: string }> }> } }).whatsappInteractive;
    expect(interactive).toMatchObject({ type: "list", button: "Choose an option" });
    expect(interactive.body).not.toContain("1. Find a Property");
    const rows = interactive.sections.flatMap((section) => section.rows);
    expect(rows.map((row) => row.id)).toEqual(["find a property", "account", "list a property", "register agent", "register services", "register", "property services", "my applications", "support", "more options"]);
    expect(rows.every((row) => row.title.length <= 24)).toBe(true);
    expect(sent).toEqual([expect.objectContaining({ body: reply.body, whatsappInteractive: interactive })]);
    expect(sent[0].whatsappTemplate).toBeUndefined();

    // A tapped row arrives as list_reply; its id becomes the message body and follows the typed path.
    const tapped = inbound("unused");
    tapped.entry[0].changes[0].value.messages[0] = { id: "wamid.tap", from: WA_ID, timestamp: String(Math.floor(Date.now() / 1000)), type: "interactive", interactive: { type: "list_reply", list_reply: { id: "account", title: "My account" } } } as never;
    expect((await officialPost(signed(tapped))).status).toBe(200);
    await work(adapters);
    expect((await db.message.findFirstOrThrow({ where: { externalMessageId: "wamid.tap" } })).body).toBe("account");
    expect(sent.at(-1)?.body).toContain("not linked");
    expect(sent.at(-1)?.whatsappInteractive).toBeUndefined();
  });

  it("does not show account data to an unlinked number", async () => {
    const { official } = await fixture();
    const { adapters } = recordingAdapters();
    await receive("account");
    await work(adapters);
    expect(await lastReply((await conversationFor(official.id)).id)).toContain("not linked");
  });

  it("records STOP and START, and skips WhatsApp notifications while opted out", async () => {
    const { official, landlord, landlordOrganisation } = await fixture();
    const { adapters } = recordingAdapters();
    await receive("STOP");
    await work(adapters);
    expect((await db.channelIdentity.findFirstOrThrow({ where: { address: `+${WA_ID}` } })).optedOutAt).not.toBeNull();
    expect(await lastReply((await conversationFor(official.id)).id)).toContain("unsubscribed");

    const { relationship } = await createTenant(landlord.id, landlordOrganisation.id, { legalName: "Kofi", email: "kofi@example.com", phone: "024 123 4567" });
    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { communicationWhatsappAllowed: true } });
    const notification = await db.notification.create({ data: { organisationId: landlordOrganisation.id, tenantOrganisationId: relationship.id, eventType: "RENT_DUE", channel: "WHATSAPP", scheduledAt: new Date() } });
    await db.organisation.update({ where: { id: landlordOrganisation.id }, data: { notifyWhatsapp: true } });
    expect(await deliverNotification(landlordOrganisation.id, notification.id)).toMatchObject({ status: "SKIPPED" });

    await receive("start");
    await work(adapters);
    expect((await db.channelIdentity.findFirstOrThrow({ where: { address: `+${WA_ID}` } })).optedOutAt).toBeNull();
  });

  it("refuses a WhatsApp notification without an approved template instead of retrying it", async () => {
    const { landlord, landlordOrganisation } = await fixture();
    const { relationship } = await createTenant(landlord.id, landlordOrganisation.id, { legalName: "Esi", email: "esi@example.com", phone: "+233201112223" });
    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { communicationWhatsappAllowed: true } });
    await db.organisation.update({ where: { id: landlordOrganisation.id }, data: { notifyWhatsapp: true } });
    const notification = await db.notification.create({ data: { organisationId: landlordOrganisation.id, tenantOrganisationId: relationship.id, eventType: "RENT_DUE", channel: "WHATSAPP", scheduledAt: new Date() } });
    await expect(deliverNotification(landlordOrganisation.id, notification.id)).rejects.toBeInstanceOf(NonRetryableJobError);
    expect((await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).failureReason).toContain("WHATSAPP_TEMPLATE_NOTIFICATION");
  });

  it("reopens a closed conversation instead of ignoring the person, and stays quiet while staff handle it", async () => {
    const { official } = await fixture();
    const { adapters, sent } = recordingAdapters();
    await receive("menu");
    await work(adapters);
    const conversation = await conversationFor(official.id);
    await db.conversation.update({ where: { id: conversation.id }, data: { status: "CLOSED" } });
    await receive("hello again");
    await work(adapters);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).status).toBe("AI_ACTIVE");
    expect(sent).toHaveLength(2);

    await db.conversation.update({ where: { id: conversation.id }, data: { status: "HUMAN_ACTIVE" } });
    await receive("are you there?");
    await work(adapters);
    expect(sent).toHaveLength(2);
    expect(await db.message.count({ where: { conversationId: conversation.id, direction: "INBOUND", processedAt: null } })).toBe(0);
  });

  it("never resends a reply whose send was unconfirmed, and dead-letters the job", async () => {
    const { official } = await fixture();
    const { adapters, sent } = recordingAdapters(() => ({ status: "FAILED", unconfirmed: true, retryable: false, failureReason: "timed out" }));
    await receive("menu");
    await work(adapters);
    await runDueJobs(createJobHandlers(undefined, adapters), new Date(Date.now() + 3_600_000));
    expect(sent).toHaveLength(1);
    const delivery = await db.messageDelivery.findFirstOrThrow({ where: { organisationId: official.id } });
    expect(delivery.status).toBe("UNCONFIRMED");
    expect((await db.backgroundJob.findFirstOrThrow({ where: { type: "conversation-message-delivery" } })).status).toBe("DEAD_LETTER");
  });

  it("dead-letters exhausted jobs and lets an operator requeue one attempt", async () => {
    const { staff, official } = await fixture();
    const job = await db.backgroundJob.create({ data: { organisationId: official.id, type: "always-fails", idempotencyKey: "always-fails:1", payload: { organisationId: official.id }, maxAttempts: 2 } });
    const handlers = { "always-fails": async () => { throw new Error("boom"); } };
    await runDueJobs(handlers);
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
    await runDueJobs(handlers, new Date(Date.now() + 120_000));
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("DEAD_LETTER");
    await runDueJobs(handlers, new Date(Date.now() + 3_600_000));
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).attempts).toBe(2);

    const requeued = await retryBackgroundJob(staff.id, official.id, job.id);
    expect(requeued).toMatchObject({ status: "FAILED", maxAttempts: 3 });
  });

  it("matches delivery statuses for notifications and drops statuses that match nothing after a while", async () => {
    const { official, landlord, landlordOrganisation } = await fixture();
    const { relationship } = await createTenant(landlord.id, landlordOrganisation.id, { legalName: "Yaw", email: "yaw@example.com", phone: "+233201112224" });
    const notification = await db.notification.create({ data: { organisationId: landlordOrganisation.id, tenantOrganisationId: relationship.id, eventType: "RENT_DUE", channel: "WHATSAPP", scheduledAt: new Date(), status: "SENT", providerReference: "wamid.notice" } });
    const now = Math.floor(Date.now() / 1000);
    await recordWhatsAppDeliveryStatus(official.id, { id: "wamid.notice", recipient: "233201112224", status: "delivered", timestamp: String(now), errorCodes: [] });
    expect((await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).status).toBe("DELIVERED");

    await expect(recordWhatsAppDeliveryStatus(official.id, { id: "wamid.unknown", recipient: WA_ID, status: "delivered", timestamp: String(now), errorCodes: [] })).rejects.toThrow("no matching delivery");
    await expect(recordWhatsAppDeliveryStatus(official.id, { id: "wamid.unknown", recipient: WA_ID, status: "delivered", timestamp: String(now - 3600), errorCodes: [] })).resolves.toBeUndefined();
  });
});
