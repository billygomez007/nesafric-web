import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Holds processing part-way, before a side effect, so a test can expire or kill the processing
 * guard, move the number, and then let the paused work continue.
 */
const pause = vi.hoisted(() => ({ gate: null as Promise<void> | null, started: null as (() => void) | null, outcome: [] as string[] }));
async function pausedSideEffect(organisationId: string, conversationId: string | null) {
  if (!pause.gate) return;
  pause.started?.();
  await pause.gate;
  // The late continuation tries to act for the organisation that no longer holds the number.
  const { db } = await import("@/platform/database/client");
  try {
    await db.domainEvent.create({ data: { organisationId, name: "test.late_side_effect", aggregateType: "conversation", aggregateId: conversationId ?? organisationId, payload: {} } });
    pause.outcome.push("write succeeded");
  } catch {
    pause.outcome.push("write refused");
  }
  const { assertGuardedWorkActive } = await import("@/platform/database/guarded");
  try {
    await assertGuardedWorkActive();
    pause.outcome.push("send allowed");
  } catch {
    pause.outcome.push("send refused");
  }
}
vi.mock("@/modules/whatsapp-assistant/engine", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/whatsapp-assistant/engine")>();
  return {
    ...original,
    advanceConversation: async (...args: Parameters<typeof original.advanceConversation>) => {
      const { db } = await import("@/platform/database/client");
      const conversation = await db.conversation.findUniqueOrThrow({ where: { id: args[0].conversationId }, select: { organisationId: true } });
      await pausedSideEffect(conversation.organisationId, args[0].conversationId);
      return original.advanceConversation(...args);
    },
  };
});
vi.mock("@/modules/conversations/identity", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/conversations/identity")>();
  return {
    ...original,
    resolveTenantIdentity: async (...args: Parameters<typeof original.resolveTenantIdentity>) => {
      await pausedSideEffect(args[0], null);
      return original.resolveTenantIdentity(...args);
    },
  };
});

import { POST as organisationWebhook } from "@/app/api/webhooks/whatsapp/[organisationId]/route";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { upsertChannelConfig } from "@/modules/conversations/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { assignWhatsAppNumberForPlatform } from "@/modules/platform-admin/service";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { baseClient, db } from "@/platform/database/client";
import { runGuarded } from "@/platform/database/guarded";
import { createPlatformAdmin } from "./helpers/whatsapp-channel";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRET = "test-app-secret";
const NUMBER = "400500600";
const CUSTOMER = "233241114444";
const DEADLINE_MS = 1_000;

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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function inbound(organisationId: string, body: string) {
  const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "555", changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, messages: [{ id: `wamid.in.${++counter}`, from: CUSTOMER, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }] });
  const response = await organisationWebhook(new Request(`http://localhost/api/webhooks/whatsapp/${organisationId}`, { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(payload).digest("hex")}` }, body: payload }), { params: Promise.resolve({ organisationId }) });
  return response.status;
}

async function fixture(assistant: boolean) {
  const principal = await createPlatformAdmin();
  const [a, b] = await Promise.all(["Owusu Homes", "Mensah Estates"].map(async (name) => {
    const owner = await registerUser({ displayName: `${name} Owner`, email: `owner-${++counter}@example.com`, password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name, type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    await upsertChannelConfig(owner.id, organisation.id, "WHATSAPP", { enabled: true, config: { marketplaceAssistantEnabled: assistant } });
    return { owner, organisation };
  }));
  await assignWhatsAppNumberForPlatform(principal, { organisationId: a.organisation.id, phoneNumberId: NUMBER, businessAccountId: "555", reason: "A's number" });
  const move = () => assignWhatsAppNumberForPlatform(principal, { organisationId: b.organisation.id, phoneNumberId: NUMBER, businessAccountId: "555", move: true, reason: "Moved while A was processing" });
  return { a, b, move };
}

/** Advisory locks and open transactions left in this database by anything other than this query. */
async function leftovers() {
  const [row] = await db.$queryRaw<Array<{ locks: bigint; idle: bigint }>>`
    SELECT
      (SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory' AND a.datname = current_database() AND a.pid <> pg_backend_pid()) AS locks,
      (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%' AND pid <> pg_backend_pid()) AS idle`;
  return { locks: Number(row.locks), idleInTransaction: Number(row.idle) };
}

async function processingGuardPid() {
  const rows = await db.$queryRaw<Array<{ pid: number }>>`SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory' AND l.mode = 'ShareLock' AND l.granted AND a.datname = current_database()`;
  return rows.map((row) => row.pid);
}

type Interrupt = "deadline" | "connection";

/** Pauses processing before a side effect, interrupts the guard, moves the number, then resumes. */
async function interruptAndMove(interrupt: Interrupt, move: () => Promise<unknown>) {
  let release!: () => void;
  pause.gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { pause.started = resolve; });
  const processing = work();
  await started;
  if (interrupt === "deadline") await sleep(DEADLINE_MS + 500);
  else {
    const pids = await processingGuardPid();
    expect(pids).toHaveLength(1);
    await db.$queryRaw`SELECT pg_terminate_backend(${pids[0]}::int)`;
  }
  // With the guard gone the move goes ahead.
  await move();
  pause.gate = null;
  release();
  await processing;
}

describe("PostgreSQL WhatsApp processing guard under failure", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_PROCESSING_TIMEOUT_MS", String(DEADLINE_MS));
    sent.length = 0;
    pause.gate = null;
    pause.started = null;
    pause.outcome = [];
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    // Known driver behaviour (@prisma/adapter-pg 6.19): a pooled client whose backend was killed
    // inside an interactive transaction is never handed back, so `$disconnect` waits for it
    // forever. The server side is clean (asserted in each test); bound the wait here.
    await Promise.race([db.$disconnect(), sleep(2_000)]);
  });

  for (const interrupt of ["deadline", "connection"] as const) {
    it(`assistant processing: no write or send for the old holder after the guard is lost (${interrupt})`, async () => {
      const { a, b, move } = await fixture(true);
      expect(await inbound(a.organisation.id, "hi")).toBe(200);
      await interruptAndMove(interrupt, move);
      expect((await db.whatsAppNumberAssignment.findUniqueOrThrow({ where: { activePhoneNumberId: NUMBER } })).organisationId).toBe(b.organisation.id);

      // The late continuation could neither write nor pass the send fence, and left nothing behind.
      expect(pause.outcome).toEqual(["write refused", "send refused"]);
      expect(await db.domainEvent.count({ where: { name: "test.late_side_effect" } })).toBe(0);
      expect(await db.message.count({ where: { organisationId: a.organisation.id, direction: "OUTBOUND" } })).toBe(0);
      expect(await db.messageDelivery.count({ where: { organisationId: a.organisation.id } })).toBe(0);

      // Recovery: the job is retried, the message is quarantined, nothing is sent, nothing leaks.
      await db.backgroundJob.updateMany({ data: { runAt: new Date(0) } });
      await work();
      await work();
      expect(await db.message.findFirstOrThrow({ where: { organisationId: a.organisation.id, direction: "INBOUND" } })).toMatchObject({ processedAt: expect.any(Date), metadata: expect.objectContaining({ quarantined: "number_reassigned" }) });
      expect(sent).toHaveLength(0);
      expect(await leftovers()).toEqual({ locks: 0, idleInTransaction: 0 });
    });

    it(`legacy ingestion: the old holder never stores the message after the guard is lost (${interrupt})`, async () => {
      const { a, move } = await fixture(false);
      expect(await inbound(a.organisation.id, "private question")).toBe(200);
      await interruptAndMove(interrupt, move);

      expect(pause.outcome).toEqual(["write refused", "send refused"]);
      expect(await db.domainEvent.count({ where: { name: "test.late_side_effect" } })).toBe(0);
      expect(await db.message.count({ where: { organisationId: a.organisation.id } })).toBe(0);
      expect(await db.conversation.count({ where: { organisationId: a.organisation.id } })).toBe(0);

      await db.backgroundJob.updateMany({ data: { runAt: new Date(0) } });
      await work();
      expect(await db.message.count({ where: { organisationId: a.organisation.id } })).toBe(0);
      expect(await db.domainEvent.count({ where: { organisationId: a.organisation.id, name: "whatsapp.inbound_quarantined" } })).toBe(1);
      expect(await leftovers()).toEqual({ locks: 0, idleInTransaction: 0 });
    });
  }

  describe("guarded client semantics", () => {
    const events = (organisationId: string) => db.domainEvent.findMany({ where: { organisationId, name: { startsWith: "test." } }, select: { name: true } });
    const event = (organisationId: string, name: string) => db.domainEvent.create({ data: { organisationId, name, aggregateType: "test", aggregateId: organisationId, payload: {} } });
    const guarded = <T>(work: () => Promise<T>, timeout = 5_000) => runGuarded(baseClient, async () => undefined, work, { timeout });

    it("keeps a caught failure, a rolled-back nested transaction and concurrent statements apart", async () => {
      const { a } = await fixture(true);
      const organisationId = a.organisation.id;
      await guarded(async () => {
        await event(organisationId, "test.first");
        // A failing statement that the caller catches does not poison the rest of the work.
        await db.$executeRawUnsafe("SELECT * FROM table_that_does_not_exist").catch(() => undefined);
        await db.$transaction(async (tx) => {
          await tx.domainEvent.create({ data: { organisationId, name: "test.rolled_back", aggregateType: "test", aggregateId: organisationId, payload: {} } });
          throw new Error("undo this nested transaction");
        }).catch(() => undefined);
        await Promise.all([event(organisationId, "test.parallel_1"), event(organisationId, "test.parallel_2"), db.$transaction(async (tx) => { await tx.domainEvent.create({ data: { organisationId, name: "test.nested_ok", aggregateType: "test", aggregateId: organisationId, payload: {} } }); })]);
      });
      expect((await events(organisationId)).map((row) => row.name).sort()).toEqual(["test.first", "test.nested_ok", "test.parallel_1", "test.parallel_2"]);
    });

    it("rolls back everything and refuses later statements when the work fails or its deadline passes", async () => {
      const { a } = await fixture(true);
      const organisationId = a.organisation.id;
      await expect(guarded(async () => { await event(organisationId, "test.before_failure"); throw new Error("boom"); })).rejects.toThrow("boom");
      let late: Promise<unknown> | null = null;
      await expect(guarded(async () => {
        await event(organisationId, "test.before_deadline");
        await sleep(600);
        late = event(organisationId, "test.after_deadline");
        await late;
      }, 300)).rejects.toBeTruthy();
      await expect(late).rejects.toBeTruthy();
      // A continuation the work left running (a timer it did not await) cannot write either.
      let orphan!: Promise<string>;
      await guarded(async () => {
        orphan = new Promise((resolve) => setTimeout(() => { event(organisationId, "test.orphan").then(() => resolve("wrote"), (error: Error) => resolve(error.name)); }, 100));
      });
      expect(await orphan).toBe("GuardedWorkClosedError");
      expect(await events(organisationId)).toEqual([]);
      expect(await leftovers()).toEqual({ locks: 0, idleInTransaction: 0 });
    });
  });

  it("still processes normally inside the guard, atomically with the lock", async () => {
    const { a } = await fixture(true);
    expect(await inbound(a.organisation.id, "hi")).toBe(200);
    await work();
    await work();
    expect(sent).toHaveLength(1);
    expect(await db.message.findFirstOrThrow({ where: { organisationId: a.organisation.id, direction: "INBOUND" } })).toMatchObject({ processedAt: expect.any(Date) });
    expect(await leftovers()).toEqual({ locks: 0, idleInTransaction: 0 });
  });
});
