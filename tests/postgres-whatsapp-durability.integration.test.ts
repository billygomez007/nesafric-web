import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/messaging/otp-provider", async () => (await import("./helpers/fake-sms-otp")).fakeSmsOtpModule);
import { db } from "@/platform/database/client";
import { runDueJobs } from "@/platform/jobs/runner";
import { jobHandlers } from "@/platform/jobs/handlers";
import { createMarketplaceLead } from "@/modules/listings/service";
import { ACTION_STALE_MS, ActionInDoubtError, runOnce } from "@/modules/whatsapp-assistant/actions";
import { setAssistantAIProvider } from "@/modules/whatsapp-assistant/ai";
import { ingestWebhook } from "@/modules/whatsapp-assistant/ingest";
import { processContact } from "@/modules/whatsapp-assistant/processor";
import { recoverStalledWhatsAppWork } from "@/modules/whatsapp-assistant/recovery";
import { acquireSession, extendSessionLease, LeaseLostError, releaseSession } from "@/modules/whatsapp-assistant/store";
import type { AIProvider, AIProviderRequest } from "@/modules/ai/providers";
import { allText, configureAssistantEnv, converse, FakeGraphApi, sign, textOf, webhookBody } from "./helpers/whatsapp-assistant";
import { cleanWhatsAppDatabase, publishedListing } from "./helpers/whatsapp-fixtures";

/**
 * Durability and recovery of the WhatsApp pipeline: what happens when `after()` never runs, the
 * process dies, a job is stranded, webhooks repeat or race, a worker stalls past its lease, or an
 * irreversible action is interrupted.
 */

const CUSTOMER = "233246666666";
const later = (ms: number) => new Date(Date.now() + ms);

async function ingestOnly(from: string, text: string, messageId?: string) {
  const body = webhookBody(from, { text }, { messageId });
  const result = await ingestWebhook(body, sign(body));
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("WhatsApp assistant — durability and recovery", () => {
  const api = new FakeGraphApi();
  beforeAll(() => { configureAssistantEnv(); api.install(); });
  beforeEach(async () => { await cleanWhatsAppDatabase(); api.take(); api.failNext = []; });
  afterEach(() => { setAssistantAIProvider(null); configureAssistantEnv(); });
  afterAll(async () => { api.uninstall(); await cleanWhatsAppDatabase(); await db.$disconnect(); });

  it("persists the message and its processing job atomically before acknowledging", async () => {
    const result = await ingestOnly(CUSTOMER, "Hi", "wamid.atomic-1");
    expect(result).toMatchObject({ ok: true, stored: 1 });
    const inbound = await db.whatsAppInboundMessage.findUniqueOrThrow({ where: { waMessageId: "wamid.atomic-1" } });
    expect(inbound.status).toBe("RECEIVED");
    expect(await db.backgroundJob.findUnique({ where: { idempotencyKey: "wa-in:wamid.atomic-1" } })).toMatchObject({ type: "whatsapp-assistant-inbound", status: "PENDING" });
  });

  it("answers through the durable job when after() never runs", async () => {
    await ingestOnly(CUSTOMER, "Hi");
    expect(api.take()).toHaveLength(0); // nothing processed by the request itself
    await runDueJobs(jobHandlers, later(61_000));
    const replies = api.take();
    expect(allText(replies)).toContain("Welcome to NesAfric");
    expect(await db.whatsAppInboundMessage.count({ where: { status: "PROCESSED" } })).toBe(1);
  });

  it("recovers through the sweep when the job runner crashed and stranded the job as RUNNING", async () => {
    await ingestOnly(CUSTOMER, "Hi", "wamid.stranded-1");
    // The generic runner never re-claims RUNNING jobs; simulate a runner that died mid-job.
    await db.backgroundJob.update({ where: { idempotencyKey: "wa-in:wamid.stranded-1" }, data: { status: "RUNNING", lockedAt: new Date() } });
    await runDueJobs(jobHandlers, later(61_000));
    expect(api.take()).toHaveLength(0);
    // Not yet stalled: the sweep leaves fresh work to the normal path.
    expect(await recoverStalledWhatsAppWork(new Date())).toMatchObject({ contactsProcessed: 0 });
    expect(await recoverStalledWhatsAppWork(later(3 * 60_000))).toMatchObject({ contactsProcessed: 1, errors: 0 });
    expect(allText(api.take())).toContain("Welcome to NesAfric");
  });

  it("re-arms processing when Meta redelivers a message whose first acknowledgement was lost", async () => {
    await ingestOnly(CUSTOMER, "Hi", "wamid.redelivered-1");
    // The first job somehow completed without processing (e.g. it ran while another worker held the lease and was lost).
    await db.backgroundJob.update({ where: { idempotencyKey: "wa-in:wamid.redelivered-1" }, data: { status: "SUCCEEDED" } });
    const again = await ingestOnly(CUSTOMER, "Hi", "wamid.redelivered-1");
    expect(again).toMatchObject({ stored: 0, duplicates: 1 });
    expect(await db.backgroundJob.findUniqueOrThrow({ where: { idempotencyKey: "wa-in:wamid.redelivered-1" } })).toMatchObject({ status: "PENDING", attempts: 0 });
    await runDueJobs(jobHandlers, later(1_000));
    expect(allText(api.take())).toContain("Welcome to NesAfric");
    expect(await db.whatsAppInboundMessage.count()).toBe(1);
  });

  it("stores and processes concurrent duplicate deliveries exactly once", async () => {
    const body = webhookBody(CUSTOMER, { text: "Hi" }, { messageId: "wamid.race-1" });
    const results = await Promise.all(Array.from({ length: 6 }, () => ingestWebhook(body, sign(body))));
    expect(results.filter((result) => result.ok && result.stored === 1)).toHaveLength(1);
    await Promise.all(Array.from({ length: 4 }, () => processContact((results[0] as { contactIds: string[] }).contactIds[0])));
    expect(api.take()).toHaveLength(1);
    expect(await db.whatsAppInboundMessage.count()).toBe(1);
    expect(await db.whatsAppOutboundMessage.count()).toBe(1);
  });

  it("processes a burst of messages from one person once each, in order, under concurrent workers", async () => {
    const texts = ["Hi", "help", "menu", "help", "Hi"];
    let contactId = "";
    for (const text of texts) contactId = (await ingestOnly(CUSTOMER, text)).contactIds[0];
    await Promise.all(Array.from({ length: 5 }, () => processContact(contactId)));
    const inbound = await db.whatsAppInboundMessage.findMany({ where: { contactId }, orderBy: { sentAt: "asc" } });
    expect(inbound.map(({ status }) => status)).toEqual(Array(texts.length).fill("PROCESSED"));
    expect(inbound.every(({ attempts }) => attempts === 1)).toBe(true);
    const outbound = await db.whatsAppOutboundMessage.findMany({ where: { contactId }, orderBy: { createdAt: "asc" } });
    // Replies were committed in message order.
    const order = outbound.map(({ idempotencyKey }) => inbound.findIndex(({ id }) => idempotencyKey.startsWith(`reply:${id}:`)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect((await db.whatsAppAssistantSession.findFirstOrThrow({ where: { contactId } })).version).toBe(texts.length);
  });

  it("fences leases: a stale worker can neither extend, release nor overwrite a newer lease", async () => {
    const { contactIds } = await ingestOnly(CUSTOMER, "Hi");
    const stale = (await acquireSession(contactIds[0]))!;
    expect(await acquireSession(contactIds[0])).toBeNull();
    await db.whatsAppAssistantSession.update({ where: { id: stale.sessionId }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
    const fresh = (await acquireSession(contactIds[0]))!;
    expect(fresh.token).not.toBe(stale.token);
    await expect(extendSessionLease(stale)).rejects.toBeInstanceOf(LeaseLostError);
    await releaseSession(stale); // must not free the newer lease
    expect(await acquireSession(contactIds[0])).toBeNull();
    await releaseSession(fresh);
    expect(await acquireSession(contactIds[0])).not.toBeNull();
  });

  it("discards everything from a worker that stalled past its lease; the replacement's result stands", async () => {
    process.env.WHATSAPP_ASSISTANT_AI = "";
    let releaseStalled!: () => void;
    let calls = 0;
    const stalledProvider: AIProvider = {
      key: "test-ai",
      complete: async (_request: AIProviderRequest) => {
        calls += 1;
        if (calls === 1) await new Promise<void>((resolve) => { releaseStalled = resolve; });
        return { text: "", toolKey: "nesafric.classify", toolCall: { key: "nesafric.classify", arguments: { intent: "support" } }, inputTokens: 1, outputTokens: 1, modelKey: "test" };
      },
    };
    setAssistantAIProvider(stalledProvider);
    const { contactIds } = await ingestOnly(CUSTOMER, "zzqx blorp wibble");
    const stalledWorker = processContact(contactIds[0]);
    await vi.waitFor(() => expect(calls).toBe(1));
    // The lease expires while worker A is stuck in the AI call; worker B takes over and finishes.
    await db.whatsAppAssistantSession.updateMany({ where: { contactId: contactIds[0] }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
    await processContact(contactIds[0]);
    releaseStalled();
    await stalledWorker;
    const outbound = await db.whatsAppOutboundMessage.findMany({ where: { contactId: contactIds[0] }, orderBy: { idempotencyKey: "asc" } });
    // Exactly one committed reply set (worker B's): one welcome + one support prompt, no second copy from A.
    expect(outbound.map(({ idempotencyKey }) => idempotencyKey.slice(-2))).toEqual(["00", "01"]);
    const sent = api.take();
    expect(sent).toHaveLength(2);
    expect(textOf(sent[1])).toMatch(/pass you to the NesAfric team/);
    expect(await db.whatsAppInboundMessage.findFirstOrThrow()).toMatchObject({ status: "PROCESSED", attempts: 2 });
    expect(await db.whatsAppAssistantEvent.count({ where: { name: "lease_lost" } })).toBe(1);
    expect((await db.whatsAppAssistantSession.findFirstOrThrow()).workflow).toBe("support");
  });

  describe("at-most-once action guard", () => {
    async function contactId() {
      return (await ingestOnly(CUSTOMER, "Hi")).contactIds[0];
    }

    it("defers, without running anything, while an earlier attempt may still be in flight", async () => {
      const id = await contactId();
      await db.whatsAppAction.create({ data: { actionKey: "test:inflight", contactId: id, kind: "test" } });
      const perform = vi.fn(async () => ({ id: "x" }));
      await expect(runOnce("test:inflight", id, "test", perform, async () => null)).rejects.toBeInstanceOf(ActionInDoubtError);
      expect(perform).not.toHaveBeenCalled();
    });

    it("completes from the real record when an interrupted attempt did commit (no duplicate)", async () => {
      const id = await contactId();
      const { listing } = await publishedListing();
      const submission = { keyHash: "a".repeat(64), fingerprint: "b".repeat(64) };
      const lead = await createMarketplaceLead(listing.id, undefined, { name: "Kofi", phone: "+233246666666", source: "whatsapp" }, { submission });
      // The worker crashed after the lead committed but before the guard recorded completion.
      await db.whatsAppAction.create({ data: { actionKey: "lead:crashed", contactId: id, kind: "lead", createdAt: new Date(Date.now() - ACTION_STALE_MS - 1_000) } });
      const perform = vi.fn(async () => ({ id: "should-not-run" }));
      const { findLeadForSubmission } = await import("@/modules/listings/service");
      const outcome = await runOnce("lead:crashed", id, "lead", perform, async () => (await findLeadForSubmission(listing.id, submission))?.id ?? null);
      expect(outcome).toMatchObject({ status: "completed", resultId: lead.id, repeated: true });
      expect(perform).not.toHaveBeenCalled();
      expect(await db.marketplaceLead.count()).toBe(1);
    });

    it("re-runs exactly once when an interrupted attempt provably never committed (no permanent suppression)", async () => {
      const id = await contactId();
      await db.whatsAppAction.create({ data: { actionKey: "test:lost", contactId: id, kind: "test", createdAt: new Date(Date.now() - ACTION_STALE_MS - 1_000) } });
      const perform = vi.fn(async () => ({ id: "created-now" }));
      expect(await runOnce("test:lost", id, "test", perform, async () => null)).toMatchObject({ status: "completed", resultId: "created-now", repeated: false });
      expect(await runOnce("test:lost", id, "test", perform, async () => null)).toMatchObject({ status: "completed", resultId: "created-now", repeated: true });
      expect(perform).toHaveBeenCalledTimes(1);
    });

    it("retries a step whose action is in doubt later, without spending its attempts, then completes it once", async () => {
      const { listing } = await publishedListing();
      await converse(api, CUSTOMER, { text: "apartment for rent in East Legon" });
      await converse(api, CUSTOMER, { text: "skip" });
      await converse(api, CUSTOMER, { choice: `ps:ask:${listing.id}` });
      await converse(api, CUSTOMER, { text: "Is it available?" });
      await converse(api, CUSTOMER, { choice: "pi:send" });
      const { contactIds } = await ingestOnly(CUSTOMER, "Kofi Boateng");
      const inbound = await db.whatsAppInboundMessage.findFirstOrThrow({ where: { text: "Kofi Boateng" } });
      // Another worker started this exact action a moment ago.
      await db.whatsAppAction.create({ data: { actionKey: `lead:${inbound.id}`, contactId: contactIds[0], kind: "lead" } });
      await processContact(contactIds[0]);
      expect(api.take()).toHaveLength(0);
      expect(await db.whatsAppInboundMessage.findUniqueOrThrow({ where: { id: inbound.id } })).toMatchObject({ status: "RECEIVED", attempts: 0 });
      expect(await db.backgroundJob.count({ where: { type: "whatsapp-assistant-inbound", idempotencyKey: { contains: ":doubt:" } } })).toBe(1);

      // That attempt died without committing; once stale, the retry creates the lead exactly once.
      await db.whatsAppAction.update({ where: { actionKey: `lead:${inbound.id}` }, data: { createdAt: new Date(Date.now() - ACTION_STALE_MS - 1_000) } });
      await processContact(contactIds[0]);
      expect(allText(api.take())).toMatch(/NES-IQ-/);
      expect(await db.marketplaceLead.count()).toBe(1);
    });
  });
});
