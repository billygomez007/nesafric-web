import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { enqueueJob, runDueJobs } from "@/platform/jobs/runner";

describe("PostgreSQL durable worker", () => {
  beforeEach(async () => {
    await db.backgroundJob.deleteMany();
  });
  afterAll(async () => {
    await db.backgroundJob.deleteMany();
  });

  it("claims and executes an idempotently enqueued job exactly once", async () => {
    const first = await enqueueJob({ type: "test.success", idempotencyKey: "worker-success", payload: { value: 1 } });
    const second = await enqueueJob({ type: "test.success", idempotencyKey: "worker-success", payload: { value: 2 } });
    expect(second.id).toBe(first.id);
    let executions = 0;
    await runDueJobs({ "test.success": async () => { executions++; } });
    await runDueJobs({ "test.success": async () => { executions++; } });
    expect(executions).toBe(1);
    expect(await db.backgroundJob.findUnique({ where: { id: first.id } })).toMatchObject({ status: "SUCCEEDED", attempts: 1 });
  });

  it("records failures and keeps jobs retryable", async () => {
    const job = await enqueueJob({ type: "test.failure", idempotencyKey: "worker-failure", payload: {} });
    await runDueJobs({ "test.failure": async () => { throw new Error("provider unavailable"); } });
    const failed = await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed).toMatchObject({ status: "FAILED", attempts: 1, lastError: "provider unavailable" });
  });
});
