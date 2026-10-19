import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The post-response fast path schedules its drain with next/server `after()`; capture it.
const scheduled = vi.hoisted(() => ({ callbacks: [] as Array<() => unknown> }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (callback: () => unknown) => { scheduled.callbacks.push(callback); } }));

import { runDueJobs } from "@/platform/jobs/runner";
import { runWithJobDeadline } from "@/platform/jobs/deadline";
import { drainReplyPathAfterResponse } from "@/platform/jobs/fast-path";
import { withWhatsAppProcessingGuard } from "@/modules/conversations/channels/whatsapp-numbers";
import { db } from "@/platform/database/client";

vi.setConfig({ testTimeout: 30_000 });

const KEY = "fast-path-deadline:";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const job = (type: string) => db.backgroundJob.create({ data: { type, idempotencyKey: `${KEY}${randomUUID()}`, payload: {} } });

describe("PostgreSQL fast-path deadlines", () => {
  beforeEach(async () => {
    scheduled.callbacks.length = 0;
    await db.backgroundJob.deleteMany({ where: { idempotencyKey: { startsWith: KEY } } });
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await db.backgroundJob.deleteMany({ where: { idempotencyKey: { startsWith: KEY } } });
    await db.$disconnect();
  });

  it("does not claim a job when the remaining time cannot cover its budget and bookkeeping", async () => {
    const queued = await job("whatsapp-delivery-status");
    const ran: string[] = [];
    const result = await runDueJobs({ "whatsapp-delivery-status": async () => { ran.push("ran"); } }, new Date(), { types: ["whatsapp-delivery-status"], deadline: new Date(Date.now() + 3_000), jobBudgetMs: 30_000, reserveMs: 5_000 });
    expect(ran).toEqual([]);
    expect(result).toMatchObject({ claimed: 0, stoppedForDeadline: true });
    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: "PENDING", attempts: 0, lockedAt: null });
  });

  it("stops waiting for a claimed job at its budget and records a retry instead of leaving it RUNNING", async () => {
    const queued = await job("whatsapp-delivery-status");
    const started = Date.now();
    const result = await runDueJobs({ "whatsapp-delivery-status": async () => { await sleep(3_000); } }, new Date(), { types: ["whatsapp-delivery-status"], deadline: new Date(Date.now() + 60_000), jobBudgetMs: 300, reserveMs: 100 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result).toMatchObject({ claimed: 1, failed: 1, succeeded: 0 });
    const after = await db.backgroundJob.findUniqueOrThrow({ where: { id: queued.id } });
    expect(after.status).toBe("FAILED");
    expect(after.lastError).toContain("300 ms budget");
    expect(after.runAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("shortens the WhatsApp processing guard to the job's deadline, so its writes roll back in time", async () => {
    const marker = `${KEY}guard:${randomUUID()}`;
    await expect(runWithJobDeadline(Date.now() + 800, () => withWhatsAppProcessingGuard(randomUUID(), async () => {
      await db.backgroundJob.create({ data: { type: "marker", idempotencyKey: marker, payload: {} } });
      await sleep(2_500);
    }))).rejects.toThrow();
    // The transaction hit the job's deadline and rolled back; without the cap it would commit.
    expect(await db.backgroundJob.findUnique({ where: { idempotencyKey: marker } })).toBeNull();
  });

  it("refuses to start guarded work when almost no time is left", async () => {
    let started = false;
    await expect(runWithJobDeadline(Date.now() + 50, () => withWhatsAppProcessingGuard(randomUUID(), async () => { started = true; }))).rejects.toThrow("budget");
    expect(started).toBe(false);
  });

  it("counts the fast path's lifetime from the request start, not from the response", async () => {
    vi.stubEnv("WHATSAPP_INLINE_PROCESSING", "");
    const queued = await job("whatsapp-delivery-status");
    // 115 s into a 120 s function: nothing may be claimed.
    drainReplyPathAfterResponse(Date.now() - 115_000);
    expect(scheduled.callbacks).toHaveLength(1);
    await scheduled.callbacks[0]();
    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: "PENDING", attempts: 0 });
  });
});
