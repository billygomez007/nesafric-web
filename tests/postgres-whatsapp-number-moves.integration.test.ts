import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as organisationWebhook } from "@/app/api/webhooks/whatsapp/[organisationId]/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { sendConversationMessage, upsertChannelConfig } from "@/modules/conversations/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { WHATSAPP_REASSIGNED_REASON } from "@/modules/conversations/channels/whatsapp-numbers";
import { queueOfficialText } from "@/modules/whatsapp-assistant/outbound";
import { assignWhatsAppNumberForPlatform } from "@/modules/platform-admin/service";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { createPlatformAdmin } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const NUMBER_ONE = "400500600";
const NUMBER_TWO = "400500699";
const OFFICIAL_ONE = "100200300";
const OFFICIAL_TWO = "100200399";
const CUSTOMER = "233241112222";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "BackgroundJob", "ChannelIdentity" CASCADE');
}

let counter = 0;
const sent: OutboundMessageRequest[] = [];
let sendGate: Promise<void> | null = null;
let sendStarted: (() => void) | null = null;
const adapters: ChannelAdapters = {
  ...defaultChannelAdapters,
  WHATSAPP: {
    ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP",
    send: async (request) => {
      sendStarted?.();
      if (sendGate) await sendGate;
      sent.push(request);
      return { status: "SENT", providerReference: `wamid.out.${++counter}` };
    },
    normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }),
  },
};
const work = () => runDueJobs(createJobHandlers(undefined, adapters));

async function inbound(organisationId: string, phoneNumberId: string, body = "hi") {
  const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id: `wamid.in.${++counter}`, from: CUSTOMER, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }] });
  const response = await organisationWebhook(new Request(`http://localhost/api/webhooks/whatsapp/${organisationId}`, { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(payload).digest("hex")}` }, body: payload }), { params: Promise.resolve({ organisationId }) });
  return response.status;
}

async function organisationWithOwner(name: string) {
  const owner = await registerUser({ displayName: `${name} Owner`, email: `owner-${++counter}@example.com`, password: "secure-password-123" });
  const organisation = await createOrganisation(owner.id, { name, type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  return { owner, organisation };
}

async function fixture(options: { assistant?: boolean } = {}) {
  const principal = await createPlatformAdmin();
  const official = await organisationWithOwner("NesAfric");
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.organisation.id);
  await assignWhatsAppNumberForPlatform(principal, { organisationId: official.organisation.id, phoneNumberId: OFFICIAL_ONE, businessAccountId: "555", reason: "Official" });
  await upsertChannelConfig(official.owner.id, official.organisation.id, "WHATSAPP", { enabled: true, config: { marketplaceAssistantEnabled: true } });
  const a = await organisationWithOwner("Owusu Homes");
  const b = await organisationWithOwner("Mensah Estates");
  for (const { owner, organisation } of [a, b]) {
    await upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { marketplaceAssistantEnabled: options.assistant ?? true } });
  }
  await assignWhatsAppNumberForPlatform(principal, { organisationId: a.organisation.id, phoneNumberId: NUMBER_ONE, businessAccountId: "555", reason: "A's number" });
  const move = (organisationId: string, phoneNumberId: string) => assignWhatsAppNumberForPlatform(principal, { organisationId, phoneNumberId, businessAccountId: "555", move: true, reason: "Moved in test" });
  return { principal, official, a, b, move };
}

const deliveriesOf = (organisationId: string) => db.messageDelivery.findMany({ where: { organisationId, channel: "WHATSAPP" }, orderBy: { createdAt: "asc" } });
const quarantineEvents = (organisationId: string) => db.domainEvent.count({ where: { organisationId, name: "whatsapp.inbound_quarantined" } });

describe("PostgreSQL WhatsApp work across number moves", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_TEMPLATE_NOTIFICATION", "nesafric_notification:en");
    sent.length = 0;
    sendGate = null;
    sendStarted = null;
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("answers on the assigned number when nothing moves", async () => {
    const { a } = await fixture();
    expect(await inbound(a.organisation.id, NUMBER_ONE)).toBe(200);
    await work();
    await work();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ organisationId: a.organisation.id, recipientAddress: CUSTOMER, config: { phoneNumberId: NUMBER_ONE } });
    expect(await deliveriesOf(a.organisation.id)).toEqual([expect.objectContaining({ status: "SENT", whatsappAssignmentId: (await db.whatsAppNumberAssignment.findUniqueOrThrow({ where: { activeOrganisationId: a.organisation.id } })).id })]);
  });

  it("quarantines an inbound message received before its number moved", async () => {
    const { a, b, move } = await fixture();
    expect(await inbound(a.organisation.id, NUMBER_ONE, "my account balance")).toBe(200);
    await move(b.organisation.id, NUMBER_ONE);
    await work();
    await work();
    expect(sent).toHaveLength(0);
    expect(await deliveriesOf(a.organisation.id)).toHaveLength(0);
    const message = await db.message.findFirstOrThrow({ where: { organisationId: a.organisation.id, direction: "INBOUND" } });
    expect(message).toMatchObject({ processedAt: expect.any(Date), metadata: expect.objectContaining({ quarantined: "number_reassigned" }) });
    expect(await quarantineEvents(a.organisation.id)).toBe(1);

    // The old holder no longer receives; the new holder gets its own conversation, without A's history.
    expect(await inbound(a.organisation.id, NUMBER_ONE)).toBe(503);
    expect(await inbound(b.organisation.id, NUMBER_ONE)).toBe(200);
    await work();
    await work();
    expect(sent).toEqual([expect.objectContaining({ organisationId: b.organisation.id, config: expect.objectContaining({ phoneNumberId: NUMBER_ONE }) })]);
    const conversation = await db.conversation.findFirstOrThrow({ where: { organisationId: b.organisation.id }, include: { messages: true } });
    expect(conversation.messages.filter((item) => item.direction === "INBOUND").map((item) => item.body)).toEqual(["hi"]);
    expect(await db.message.count({ where: { conversationId: conversation.id, body: "my account balance" } })).toBe(0);
  });

  it("quarantines a reply queued before its number moved", async () => {
    const { a, b, move } = await fixture();
    expect(await inbound(a.organisation.id, NUMBER_ONE)).toBe(200);
    await work(); // decides and queues the reply; the delivery runs in the next pass
    expect(await deliveriesOf(a.organisation.id)).toEqual([expect.objectContaining({ status: "QUEUED" })]);
    await move(b.organisation.id, NUMBER_ONE);
    await work();
    expect(sent).toHaveLength(0);
    expect(await deliveriesOf(a.organisation.id)).toEqual([expect.objectContaining({ status: "SKIPPED", failureReason: WHATSAPP_REASSIGNED_REASON })]);
    expect(await db.auditEvent.count({ where: { organisationId: a.organisation.id, action: "message.delivery_quarantined" } })).toBe(1);
  });

  it("does not deliver a legacy inbound message received before its number moved", async () => {
    const { a, b, move } = await fixture({ assistant: false });
    expect(await inbound(a.organisation.id, NUMBER_ONE, "private question")).toBe(200);
    await move(b.organisation.id, NUMBER_ONE);
    await work();
    expect(await db.message.count({ where: { organisationId: a.organisation.id } })).toBe(0);
    expect(await quarantineEvents(a.organisation.id)).toBe(1);
  });

  it("does not continue a conversation from a replaced number", async () => {
    const { a, principal } = await fixture();
    expect(await inbound(a.organisation.id, NUMBER_ONE)).toBe(200);
    await work();
    await work();
    await assignWhatsAppNumberForPlatform(principal, { organisationId: a.organisation.id, phoneNumberId: NUMBER_TWO, reason: "Replaced" });
    const conversation = await db.conversation.findFirstOrThrow({ where: { organisationId: a.organisation.id } });
    await sendConversationMessage(a.owner.id, a.organisation.id, conversation.id, { body: "Following up" });
    await work();
    expect(sent).toHaveLength(1);
    expect((await deliveriesOf(a.organisation.id)).at(-1)).toMatchObject({ status: "SKIPPED", failureReason: expect.stringContaining("no longer has") });
  });

  it("quarantines official messages queued before the official number was replaced", async () => {
    const { official, principal } = await fixture();
    await db.$transaction((tx) => queueOfficialText(tx, { phoneE164: `+${CUSTOMER}`, displayName: "Customer", text: "Your request was received.", externalMessageId: "test:before" }));
    await assignWhatsAppNumberForPlatform(principal, { organisationId: official.organisation.id, phoneNumberId: OFFICIAL_TWO, businessAccountId: "555", reason: "New official number" });
    await db.$transaction((tx) => queueOfficialText(tx, { phoneE164: `+${CUSTOMER}`, displayName: "Customer", text: "Your request was received.", externalMessageId: "test:after" }));
    await work();
    const deliveries = await deliveriesOf(official.organisation.id);
    expect(deliveries.map((delivery) => delivery.status)).toEqual(["SKIPPED", "SENT"]);
    expect(deliveries[0].failureReason).toBe(WHATSAPP_REASSIGNED_REASON);
    expect(sent).toEqual([expect.objectContaining({ config: expect.objectContaining({ phoneNumberId: OFFICIAL_TWO }), whatsappTemplate: expect.objectContaining({ name: "nesafric_notification" }) })]);
  });

  it("finishes a send already in flight before the number moves, then sends nothing more from it", async () => {
    const { a, b, move } = await fixture();
    expect(await inbound(a.organisation.id, NUMBER_ONE)).toBe(200);
    await work();
    let release!: () => void;
    sendGate = new Promise((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { sendStarted = resolve; });
    const delivering = work();
    await started;
    let moved = false;
    const moving = move(b.organisation.id, NUMBER_ONE).then(() => { moved = true; });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(moved).toBe(false);
    release();
    await delivering;
    await moving;
    expect(sent).toEqual([expect.objectContaining({ organisationId: a.organisation.id, config: expect.objectContaining({ phoneNumberId: NUMBER_ONE }) })]);
    expect(await deliveriesOf(a.organisation.id)).toEqual([expect.objectContaining({ status: "SENT" })]);
    sendGate = null;
    sendStarted = null;
    // After the move, A's next reply is not sent from the number B now holds.
    const conversation = await db.conversation.findFirstOrThrow({ where: { organisationId: a.organisation.id } });
    await sendConversationMessage(a.owner.id, a.organisation.id, conversation.id, { body: "Anything else?" });
    await work();
    expect(sent).toHaveLength(1);
    expect((await deliveriesOf(a.organisation.id)).at(-1)).toMatchObject({ status: "SKIPPED", failureReason: "No WhatsApp number is assigned to this organisation." });
  });
});
