import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runDueJobs } from "@/platform/jobs/runner";
import { FAST_TYPES } from "@/platform/jobs/fast-path";
import { db } from "@/platform/database/client";

describe("PostgreSQL job runner type filter", () => {
  beforeEach(async () => { await db.backgroundJob.deleteMany({ where: { idempotencyKey: { startsWith: "type-filter:" } } }); });
  afterAll(async () => {
    await db.backgroundJob.deleteMany({ where: { idempotencyKey: { startsWith: "type-filter:" } } });
    await db.$disconnect();
  });

  it("runs only the requested job types, so the WhatsApp reply path never drains unrelated work", async () => {
    await db.backgroundJob.createMany({ data: [
      { type: "whatsapp-assistant-message", idempotencyKey: "type-filter:a", payload: {} },
      { type: "daily-digest", idempotencyKey: "type-filter:b", payload: {} },
    ] });
    const ran: string[] = [];
    const handler = (type: string) => async () => { ran.push(type); };
    const result = await runDueJobs({ "whatsapp-assistant-message": handler("whatsapp-assistant-message"), "daily-digest": handler("daily-digest") }, new Date(), { types: FAST_TYPES, limit: 10 });
    expect(ran).toEqual(["whatsapp-assistant-message"]);
    expect(result.claimed).toBe(1);
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { idempotencyKey: "type-filter:b" } })).status).toBe("PENDING");
  });
});
