import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lets a test hold legacy ingestion part-way, after the assignment check and before the message is stored.
const ingesting = vi.hoisted(() => ({ gate: null as Promise<void> | null, started: null as (() => void) | null }));
vi.mock("@/modules/conversations/identity", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/conversations/identity")>();
  return {
    ...original,
    resolveTenantIdentity: async (...args: Parameters<typeof original.resolveTenantIdentity>) => {
      if (ingesting.gate) {
        ingesting.started?.();
        await ingesting.gate;
      }
      return original.resolveTenantIdentity(...args);
    },
  };
});

import { POST as organisationWebhook } from "@/app/api/webhooks/whatsapp/[organisationId]/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createAIEmployee } from "@/modules/ai-employees/service";
import { receiveInboundChannelMessage, routeInboundMessage, sendConversationMessage, upsertChannelConfig } from "@/modules/conversations/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { WHATSAPP_OLD_CONVERSATION_REASON, WHATSAPP_UNVERIFIED_CONVERSATION_REASON } from "@/modules/conversations/channels/whatsapp-numbers";
import { assignWhatsAppNumberForPlatform } from "@/modules/platform-admin/service";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";
import { createPlatformAdmin } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const NUMBER_ONE = "400500600";
const NUMBER_TWO = "400500699";
const CUSTOMER = "233241113333";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "BackgroundJob", "ChannelIdentity" CASCADE');
}

let counter = 0;
const sent: OutboundMessageRequest[] = [];
const adapters: ChannelAdapters = {
  ...defaultChannelAdapters,
  WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { sent.push(request); return { status: "SENT", providerReference: `wamid.out.${++counter}` }; }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) },
};
const work = () => runDueJobs(createJobHandlers(undefined, adapters));

async function inbound(organisationId: string, phoneNumberId: string, body: string) {
  const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id: `wamid.in.${++counter}`, from: CUSTOMER, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }] });
  const response = await organisationWebhook(new Request(`http://localhost/api/webhooks/whatsapp/${organisationId}`, { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(payload).digest("hex")}` }, body: payload }), { params: Promise.resolve({ organisationId }) });
  return response.status;
}

/** Organisation A uses the legacy inbox (assistant off); B exists to receive a moved number. */
async function fixture() {
  const principal = await createPlatformAdmin();
  const owners = await Promise.all(["Owusu Homes", "Mensah Estates"].map(async (name) => {
    const owner = await registerUser({ displayName: `${name} Owner`, email: `owner-${++counter}@example.com`, password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name, type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    await upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { marketplaceAssistantEnabled: false } });
    return { owner, organisation };
  }));
  const [a, b] = owners;
  const assign = (organisationId: string, phoneNumberId: string, extra: Record<string, unknown> = {}) => assignWhatsAppNumberForPlatform(principal, { organisationId, phoneNumberId, businessAccountId: "555", reason: "Test", ...extra });
  const first = (await assign(a.organisation.id, NUMBER_ONE)).assignment;
  return { a, b, assign, first };
}

const conversationsOf = (organisationId: string) => db.conversation.findMany({ where: { organisationId, channel: "WHATSAPP" }, orderBy: { createdAt: "asc" } });
const lastDelivery = async (organisationId: string) => (await db.messageDelivery.findMany({ where: { organisationId, channel: "WHATSAPP" }, orderBy: { createdAt: "asc" } })).at(-1);

describe("PostgreSQL WhatsApp legacy conversation provenance", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    sent.length = 0;
    ingesting.gate = null;
    ingesting.started = null;
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("replies to a legacy conversation under its original assignment, and blocks staff replies after the number is replaced", async () => {
    const { a, assign, first } = await fixture();
    expect(await inbound(a.organisation.id, NUMBER_ONE, "Is the flat still available?")).toBe(200);
    await work();
    const [conversation] = await conversationsOf(a.organisation.id);
    expect(conversation).toMatchObject({ whatsappSessionKey: null, whatsappAssignmentId: first.id });

    // Valid: the conversation was received under the assignment still in force.
    await sendConversationMessage(a.owner.id, a.organisation.id, conversation.id, { body: "Yes, it is." });
    await work();
    expect(await lastDelivery(a.organisation.id)).toMatchObject({ status: "SENT", whatsappAssignmentId: first.id });
    expect(sent).toEqual([expect.objectContaining({ body: "Yes, it is.", config: expect.objectContaining({ phoneNumberId: NUMBER_ONE }) })]);

    const second = (await assign(a.organisation.id, NUMBER_TWO, { reason: "Replaced" })).assignment;
    await sendConversationMessage(a.owner.id, a.organisation.id, conversation.id, { body: "Following up from the new number" });
    await work();
    expect(await lastDelivery(a.organisation.id)).toMatchObject({ status: "SKIPPED", failureReason: WHATSAPP_OLD_CONVERSATION_REASON, whatsappAssignmentId: null });
    expect(sent).toHaveLength(1);

    // The customer writing to the new number starts a new conversation under the new assignment.
    expect(await inbound(a.organisation.id, NUMBER_TWO, "Hello again")).toBe(200);
    await work();
    const conversations = await conversationsOf(a.organisation.id);
    expect(conversations).toHaveLength(2);
    expect(conversations[1]).toMatchObject({ whatsappAssignmentId: second.id });
    expect(await db.message.count({ where: { conversationId: conversation.id, body: "Hello again" } })).toBe(0);
    await sendConversationMessage(a.owner.id, a.organisation.id, conversations[1].id, { body: "Welcome back" });
    await work();
    expect(sent.at(-1)).toMatchObject({ body: "Welcome back", config: expect.objectContaining({ phoneNumberId: NUMBER_TWO }) });
  });

  it("blocks the automatic AI reply on a legacy conversation from a replaced number", async () => {
    const { a, assign, first } = await fixture();
    await db.organisationSubscription.update({ where: { organisationId: a.organisation.id }, data: { plan: { connect: { key: "scale" } } } });
    await createAIEmployee(a.owner.id, a.organisation.id, { name: "Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    await db.aIAutonomyConfiguration.create({ data: { organisationId: a.organisation.id, automationActorUserId: a.owner.id, updatedByUserId: a.owner.id } });
    expect(await inbound(a.organisation.id, NUMBER_ONE, "Hello")).toBe(200);
    await work();
    await work();
    const [conversation] = await conversationsOf(a.organisation.id);
    // Valid: the automatic reply goes out under the original assignment.
    expect(await lastDelivery(a.organisation.id)).toMatchObject({ status: "SENT", whatsappAssignmentId: first.id });
    expect(sent).toEqual([expect.objectContaining({ config: expect.objectContaining({ phoneNumberId: NUMBER_ONE }) })]);

    await assign(a.organisation.id, NUMBER_TWO, { reason: "Replaced" });
    await routeInboundMessage(conversation.id);
    await work();
    expect(await lastDelivery(a.organisation.id)).toMatchObject({ status: "SKIPPED", failureReason: WHATSAPP_OLD_CONVERSATION_REASON });
    expect(sent).toHaveLength(1);
  });

  it("sends nothing on a WhatsApp conversation whose receiving number cannot be verified", async () => {
    const { a } = await fixture();
    // No provenance: ingested without an assignment (as by older code), and an assistant
    // conversation that predates provenance.
    const legacy = await receiveInboundChannelMessage(a.organisation.id, "WHATSAPP", { channelAddress: CUSTOMER, externalMessageId: "wamid.old.1", body: "Old message" });
    expect(await db.conversation.findUniqueOrThrow({ where: { id: legacy.conversationId } })).toMatchObject({ whatsappAssignmentId: null });
    await sendConversationMessage(a.owner.id, a.organisation.id, legacy.conversationId, { body: "Reply" });
    await work();
    expect(await lastDelivery(a.organisation.id)).toMatchObject({ status: "SKIPPED", failureReason: WHATSAPP_UNVERIFIED_CONVERSATION_REASON });
    expect(sent).toHaveLength(0);

    // A message received under the assignment never continues the unverified conversation.
    expect(await inbound(a.organisation.id, NUMBER_ONE, "New message")).toBe(200);
    await work();
    expect((await conversationsOf(a.organisation.id)).map((item) => item.whatsappAssignmentId === null)).toEqual([true, false]);
    expect(await db.message.count({ where: { conversationId: legacy.conversationId } })).toBe(2); // the inbound and the refused reply only
  });

  it("re-verifies an assistant conversation only when the customer writes to the same number again", async () => {
    const { a, first } = await fixture();
    await upsertChannelConfig(a.owner.id, a.organisation.id, "WHATSAPP", { enabled: true, config: { marketplaceAssistantEnabled: true } });
    expect(await inbound(a.organisation.id, NUMBER_ONE, "hi")).toBe(200);
    await work();
    await work();
    const [conversation] = await conversationsOf(a.organisation.id);
    await db.conversation.update({ where: { id: conversation.id }, data: { whatsappAssignmentId: null } });
    await sendConversationMessage(a.owner.id, a.organisation.id, conversation.id, { body: "Staff reply" });
    await work();
    expect(await lastDelivery(a.organisation.id)).toMatchObject({ status: "SKIPPED", failureReason: WHATSAPP_UNVERIFIED_CONVERSATION_REASON });

    expect(await inbound(a.organisation.id, NUMBER_ONE, "hello?")).toBe(200);
    expect(await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).toMatchObject({ whatsappAssignmentId: first.id });
  });

  it("makes a move wait for legacy ingestion already under way, then quarantines the work queued behind it", async () => {
    const { a, b, assign, first } = await fixture();
    expect(await inbound(a.organisation.id, NUMBER_ONE, "first")).toBe(200);
    expect(await inbound(a.organisation.id, NUMBER_ONE, "second")).toBe(200);
    let release!: () => void;
    ingesting.gate = new Promise((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { ingesting.started = resolve; });
    const processing = work();
    await started; // the first job passed its assignment check and is storing the message

    let moved = false;
    const moving = assign(b.organisation.id, NUMBER_ONE, { move: true, reason: "Moved during ingestion" }).then(() => { moved = true; });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(moved).toBe(false);
    expect((await db.whatsAppNumberAssignment.findUniqueOrThrow({ where: { activePhoneNumberId: NUMBER_ONE } })).organisationId).toBe(a.organisation.id);

    ingesting.gate = null;
    release();
    await processing;
    await moving;

    // The first message was fully ingested under the old assignment; the second, queued behind
    // the move, was quarantined.
    const messages = await db.message.findMany({ where: { organisationId: a.organisation.id, direction: "INBOUND" } });
    expect(messages.map((message) => message.body)).toEqual(["first"]);
    expect(await db.domainEvent.count({ where: { organisationId: a.organisation.id, name: "whatsapp.inbound_quarantined" } })).toBe(1);
    const [conversation] = await conversationsOf(a.organisation.id);
    expect(conversation.whatsappAssignmentId).toBe(first.id);

    // Nothing more goes out on A's old thread.
    await sendConversationMessage(a.owner.id, a.organisation.id, conversation.id, { body: "Reply" });
    await work();
    expect(await lastDelivery(a.organisation.id)).toMatchObject({ status: "SKIPPED" });
    expect(sent).toHaveLength(0);
  });
});
