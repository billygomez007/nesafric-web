import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { ingestWebhook } from "@/modules/whatsapp-assistant/ingest";
import {
  purgeExpiredWhatsAppData, RETENTION_DEFAULTS, RetentionConfigError, runWhatsAppRetention, whatsAppRetentionPolicy, type WhatsAppRetentionPolicy,
} from "@/modules/whatsapp-assistant/retention";
import { configureAssistantEnv, FakeGraphApi, sign, webhookBody } from "./helpers/whatsapp-assistant";
import { cleanWhatsAppDatabase } from "./helpers/whatsapp-fixtures";

/**
 * Retention of the assistant's own data: bounded, configurable, and never at the expense of
 * pending work, active conversations or exactly-once guarantees.
 */

const DAY = 86_400_000;
const now = new Date("2026-10-18T12:00:00Z");
const daysAgo = (count: number) => new Date(now.getTime() - count * DAY);
const policy = (overrides: Partial<WhatsAppRetentionPolicy> = {}): WhatsAppRetentionPolicy => ({ enabled: true, ...RETENTION_DEFAULTS, ...overrides });

async function contact(waId = `2332${Math.floor(Math.random() * 1e8)}`) {
  return db.whatsAppContact.create({ data: { waId, phoneE164: `+${waId}` } });
}

async function inbound(contactId: string, age: number, status: "RECEIVED" | "PROCESSING" | "PROCESSED" | "FAILED" | "IGNORED" = "PROCESSED") {
  return db.whatsAppInboundMessage.create({
    data: { waMessageId: `wamid.${randomUUID()}`, contactId, type: "text", text: "My number is 024 000 0000", content: { choiceId: "x" }, status, sentAt: daysAgo(age), receivedAt: daysAgo(age) },
  });
}

async function outbound(contactId: string, age: number, status: "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "SKIPPED" = "DELIVERED") {
  return db.whatsAppOutboundMessage.create({
    data: { contactId, idempotencyKey: `reply:${randomUUID()}:00`, kind: "text", payload: { kind: "text", text: "Hello Ama" }, status, createdAt: daysAgo(age) },
  });
}

describe("WhatsApp assistant — retention", () => {
  const api = new FakeGraphApi();
  beforeAll(() => { configureAssistantEnv(); api.install(); });
  beforeEach(cleanWhatsAppDatabase);
  afterAll(async () => { api.uninstall(); await cleanWhatsAppDatabase(); await db.$disconnect(); });

  it("is off by default, uses the documented defaults, and refuses an unsafe policy", async () => {
    expect(whatsAppRetentionPolicy({})).toEqual({ enabled: false, ...RETENTION_DEFAULTS });
    const { id } = await contact();
    await inbound(id, 1_000);
    expect(await purgeExpiredWhatsAppData(now, whatsAppRetentionPolicy({}))).toBeNull();
    expect(await db.whatsAppInboundMessage.count()).toBe(1);

    const enabled = { WHATSAPP_RETENTION_ENABLED: "true" };
    expect(() => whatsAppRetentionPolicy({ ...enabled, WHATSAPP_RETENTION_CONTENT_DAYS: "7" })).toThrow(RetentionConfigError);
    expect(() => whatsAppRetentionPolicy({ ...enabled, WHATSAPP_RETENTION_CONTENT_DAYS: "60", WHATSAPP_RETENTION_DELETE_DAYS: "30" })).toThrow(/DELETE_DAYS/);
    expect(() => whatsAppRetentionPolicy({ ...enabled, WHATSAPP_RETENTION_DELETE_DAYS: "500" })).toThrow(/ACTION_DAYS/);
    expect(() => whatsAppRetentionPolicy({ ...enabled, WHATSAPP_RETENTION_EVENT_DAYS: "ten" })).toThrow(/EVENT_DAYS/);
    expect(whatsAppRetentionPolicy({ ...enabled, WHATSAPP_RETENTION_CONTENT_DAYS: "14", WHATSAPP_RETENTION_BATCH_SIZE: "50" })).toMatchObject({ enabled: true, contentDays: 14, batchSize: 50 });

    // The scheduled entry point never throws and purges nothing with an invalid policy.
    process.env.WHATSAPP_RETENTION_ENABLED = "true";
    process.env.WHATSAPP_RETENTION_CONTENT_DAYS = "1";
    try {
      expect(await runWhatsAppRetention(now)).toBeNull();
      expect(await db.whatsAppInboundMessage.count()).toBe(1);
    } finally {
      delete process.env.WHATSAPP_RETENTION_ENABLED;
      delete process.env.WHATSAPP_RETENTION_CONTENT_DAYS;
    }
  });

  it("redacts old content but keeps message ids, so webhook redeliveries are still deduplicated", async () => {
    const body = webhookBody("233249000001", { text: "My Ghana Card number is GHA-000000000-0" }, { messageId: "wamid.redelivered" });
    const ingested = await ingestWebhook(body, sign(body));
    if (!ingested.ok) throw new Error(ingested.reason);
    await db.whatsAppInboundMessage.updateMany({ data: { status: "PROCESSED", receivedAt: daysAgo(31) } });
    const { id } = (await db.whatsAppContact.findFirstOrThrow());
    const pending = await inbound(id, 90, "RECEIVED");
    const sent = await outbound(id, 31);
    const queued = await outbound(id, 90, "QUEUED");
    const recent = await outbound(id, 5);

    const report = await purgeExpiredWhatsAppData(now, policy());
    expect(report).toMatchObject({ inboundRedacted: 1, outboundRedacted: 1, inboundDeleted: 0, outboundDeleted: 0 });
    const redacted = await db.whatsAppInboundMessage.findUniqueOrThrow({ where: { waMessageId: "wamid.redelivered" } });
    expect(redacted).toMatchObject({ text: null, content: {}, redactedAt: now });
    expect(await db.whatsAppOutboundMessage.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({ payload: { redacted: true }, redactedAt: now, idempotencyKey: sent.idempotencyKey });
    // Pending work and recent rows are untouched.
    expect(await db.whatsAppInboundMessage.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ text: "My number is 024 000 0000", redactedAt: null });
    expect(await db.whatsAppOutboundMessage.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ payload: { text: "Hello Ama" }, redactedAt: null });
    expect(await db.whatsAppOutboundMessage.findUniqueOrThrow({ where: { id: recent.id } })).toMatchObject({ redactedAt: null });

    // Meta redelivers the same message: still recognised as a duplicate, nothing re-processed.
    const again = await ingestWebhook(body, sign(body));
    expect(again.ok).toBe(true);
    expect(await db.whatsAppInboundMessage.count({ where: { waMessageId: "wamid.redelivered" } })).toBe(1);
    expect((await db.whatsAppInboundMessage.findUniqueOrThrow({ where: { waMessageId: "wamid.redelivered" } })).status).toBe("PROCESSED");
  });

  it("deletes finished messages after the delete period, never pending ones", async () => {
    const { id } = await contact();
    const old = await Promise.all([inbound(id, 200), inbound(id, 200, "FAILED"), inbound(id, 200, "IGNORED")]);
    const stuck = await inbound(id, 200, "PROCESSING");
    const waiting = await inbound(id, 200, "RECEIVED");
    const kept = await inbound(id, 100);
    await Promise.all([outbound(id, 200), outbound(id, 200, "SKIPPED"), outbound(id, 200, "FAILED")]);
    const unsent = await outbound(id, 200, "QUEUED");

    const report = await purgeExpiredWhatsAppData(now, policy());
    expect(report).toMatchObject({ inboundDeleted: 3, outboundDeleted: 3 });
    expect(await db.whatsAppInboundMessage.count({ where: { id: { in: old.map((row) => row.id) } } })).toBe(0);
    expect(await db.whatsAppInboundMessage.findMany({ select: { id: true } })).toEqual(expect.arrayContaining([{ id: stuck.id }, { id: waiting.id }, { id: kept.id }]));
    expect(await db.whatsAppOutboundMessage.findMany({ select: { id: true } })).toEqual([{ id: unsent.id }]);
  });

  it("works in bounded batches and finishes a backlog over successive runs", async () => {
    const { id } = await contact();
    for (let index = 0; index < 7; index += 1) await inbound(id, 200);
    const small = policy({ batchSize: 2, maxBatches: 2 });
    expect((await purgeExpiredWhatsAppData(now, small))!.inboundDeleted).toBe(4);
    expect(await db.whatsAppInboundMessage.count()).toBe(3);
    expect((await purgeExpiredWhatsAppData(now, small))!.inboundDeleted).toBe(3);
    expect((await purgeExpiredWhatsAppData(now, small))!.inboundDeleted).toBe(0);
  });

  it("clears only abandoned workflows: never an active, leased or pending conversation", async () => {
    const state = { workflow: "listing", step: "price", data: { title: "3-bed house" } };
    const abandoned = await contact();
    await db.whatsAppAssistantSession.create({ data: { contactId: abandoned.id, ...state, lastActivityAt: daysAgo(61) } });
    const active = await contact();
    await db.whatsAppAssistantSession.create({ data: { contactId: active.id, ...state, lastActivityAt: daysAgo(2) } });
    const leased = await contact();
    await db.whatsAppAssistantSession.create({ data: { contactId: leased.id, ...state, lastActivityAt: daysAgo(61), lockedUntil: new Date(now.getTime() + 60_000), leaseToken: "worker" } });
    const waiting = await contact();
    await db.whatsAppAssistantSession.create({ data: { contactId: waiting.id, ...state, lastActivityAt: daysAgo(61) } });
    await inbound(waiting.id, 0, "RECEIVED");

    expect((await purgeExpiredWhatsAppData(now, policy()))!.workflowsCleared).toBe(1);
    expect(await db.whatsAppAssistantSession.findUniqueOrThrow({ where: { contactId: abandoned.id } })).toMatchObject({ workflow: null, step: null, data: {} });
    for (const kept of [active, leased, waiting]) {
      expect(await db.whatsAppAssistantSession.findUniqueOrThrow({ where: { contactId: kept.id } })).toMatchObject(state);
    }
  });

  it("deletes an action binding only once the message that could repeat the action is gone", async () => {
    const { id } = await contact();
    const finished = await inbound(id, 500);
    const stillPending = await inbound(id, 500, "RECEIVED");
    const recentMessage = await inbound(id, 10);
    await db.whatsAppAction.createMany({ data: [
      { actionKey: `lead:${finished.id}`, contactId: id, kind: "lead", resultId: randomUUID(), createdAt: daysAgo(500) },
      { actionKey: `lead:${stillPending.id}`, contactId: id, kind: "lead", resultId: randomUUID(), createdAt: daysAgo(500) },
      { actionKey: `provider_registration:${finished.id}:organisation`, contactId: id, kind: "provider_organisation", resultId: randomUUID(), createdAt: daysAgo(500) },
      { actionKey: `lead:${recentMessage.id}`, contactId: id, kind: "lead", resultId: randomUUID(), createdAt: daysAgo(10) },
    ] });

    const report = await purgeExpiredWhatsAppData(now, policy());
    // The finished message is deleted first; its two bindings follow in the same run.
    expect(report).toMatchObject({ inboundDeleted: 1, actionsDeleted: 2 });
    expect((await db.whatsAppAction.findMany({ select: { actionKey: true }, orderBy: { actionKey: "asc" } })).map(({ actionKey }) => actionKey))
      .toEqual([`lead:${recentMessage.id}`, `lead:${stillPending.id}`].sort());
  });

  it("deletes old analytics events and resolved support requests, keeping open requests", async () => {
    const { id } = await contact();
    await db.whatsAppAssistantEvent.createMany({ data: [
      { name: "property_search", contactId: id, createdAt: daysAgo(401) },
      { name: "property_search", contactId: id, createdAt: daysAgo(30) },
    ] });
    const support = (status: "OPEN" | "RESOLVED", resolvedDaysAgo: number | null) => db.whatsAppSupportRequest.create({
      data: { reference: `NES-SP-${randomUUID().slice(0, 8)}`, contactId: id, topic: "general", summary: "Help", status, resolvedAt: resolvedDaysAgo === null ? null : daysAgo(resolvedDaysAgo), createdAt: daysAgo(500) },
    });
    await support("RESOLVED", 400);
    const recentlyResolved = await support("RESOLVED", 30);
    const open = await support("OPEN", null);

    expect(await purgeExpiredWhatsAppData(now, policy())).toMatchObject({ eventsDeleted: 1, supportDeleted: 1 });
    expect(await db.whatsAppAssistantEvent.count()).toBe(1);
    expect((await db.whatsAppSupportRequest.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } })).map(({ id: requestId }) => requestId).sort())
      .toEqual([recentlyResolved.id, open.id].sort());
  });
});
