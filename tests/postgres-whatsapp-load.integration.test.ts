import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/messaging/otp-provider", async () => (await import("./helpers/fake-sms-otp")).fakeSmsOtpModule);
import { db } from "@/platform/database/client";
import { ingestWebhook } from "@/modules/whatsapp-assistant/ingest";
import { processContact } from "@/modules/whatsapp-assistant/processor";
import { configureAssistantEnv, FakeGraphApi, sign, webhookBody } from "./helpers/whatsapp-assistant";
import { cleanWhatsAppDatabase, publishedListing } from "./helpers/whatsapp-fixtures";

/**
 * Bounded concurrency check (not a capacity claim for production): many simultaneous
 * conversations, each a burst of messages, ingested in parallel and drained by overlapping
 * workers — two per contact — the way `after()`, jobs and the sweep can overlap. Every message must
 * be processed exactly once, in order, with one reply set each. Set WA_LOAD_REPORT=<path> to write
 * the measured figures.
 */
const CONTACTS = Number(process.env.WA_LOAD_CONTACTS ?? 40);
const MESSAGES = ["Hi", "apartment for rent in East Legon", "skip", "menu", "help"];
const WORKER_CONCURRENCY = 10;

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<unknown>) {
  for (let index = 0; index < items.length; index += size) await Promise.all(items.slice(index, index + size).map(run));
}

describe("WhatsApp assistant — bounded concurrency", () => {
  const api = new FakeGraphApi();
  beforeAll(() => { configureAssistantEnv(); api.install(); });
  beforeEach(cleanWhatsAppDatabase);
  afterAll(async () => { api.uninstall(); await cleanWhatsAppDatabase(); await db.$disconnect(); });

  it(`handles ${CONTACTS} simultaneous conversations × ${MESSAGES.length} messages exactly once`, async () => {
    await publishedListing();
    const senders = Array.from({ length: CONTACTS }, (_, index) => `2332410${String(index).padStart(5, "0")}`);
    const deliveries = senders.flatMap((from) => MESSAGES.map((text) => webhookBody(from, { text })));
    const ingestStart = performance.now();
    // Each delivery is also redelivered once, concurrently, as Meta does after a lost acknowledgement.
    await inBatches([...deliveries, ...deliveries], 20, (body) => ingestWebhook(body, sign(body)));
    const ingestMs = performance.now() - ingestStart;
    const contacts = await db.whatsAppContact.findMany({ select: { id: true } });
    expect(contacts).toHaveLength(CONTACTS);
    expect(await db.whatsAppInboundMessage.count()).toBe(CONTACTS * MESSAGES.length);

    const processStart = performance.now();
    const workers = contacts.flatMap(({ id }) => [id, id]); // two overlapping workers per contact
    await inBatches(workers, WORKER_CONCURRENCY, (id) => processContact(id));
    for (const { id } of contacts) await processContact(id); // drain anything a racing worker deferred
    const processMs = performance.now() - processStart;

    const inbound = await db.whatsAppInboundMessage.findMany({ select: { status: true, attempts: true } });
    expect(inbound.every(({ status, attempts }) => status === "PROCESSED" && attempts === 1)).toBe(true);
    const sessions = await db.whatsAppAssistantSession.findMany({ select: { version: true } });
    expect(sessions.every(({ version }) => version === MESSAGES.length)).toBe(true);
    const outbound = await db.whatsAppOutboundMessage.findMany({ select: { idempotencyKey: true, status: true } });
    expect(new Set(outbound.map(({ idempotencyKey }) => idempotencyKey.split(":").slice(0, 2).join(":"))).size).toBe(CONTACTS * MESSAGES.length);
    expect(outbound.every(({ status }) => status === "SENT")).toBe(true);
    expect(api.take()).toHaveLength(outbound.length);

    const report = {
      contacts: CONTACTS,
      messagesPerContact: MESSAGES.length,
      webhookDeliveries: deliveries.length * 2,
      ingestMs: Math.round(ingestMs),
      ingestPerSecond: Math.round((deliveries.length * 2) / (ingestMs / 1000)),
      processMs: Math.round(processMs),
      messagesProcessedPerSecond: Math.round((CONTACTS * MESSAGES.length) / (processMs / 1000)),
      outboundMessages: outbound.length,
      workerConcurrency: WORKER_CONCURRENCY,
    };
    if (process.env.WA_LOAD_REPORT) writeFileSync(process.env.WA_LOAD_REPORT, JSON.stringify(report, null, 2));
  }, 240_000);
});
