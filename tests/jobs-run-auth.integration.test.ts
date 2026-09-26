import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/jobs/run/route";
import { db } from "@/platform/database/client";
import * as runner from "@/platform/jobs/runner";

const ENV_KEYS = ["JOBS_RUN_SECRET", "CRON_SECRET", "ALLOW_UNAUTHENTICATED_JOBS_RUN", "NODE_ENV"] as const;
const ORIGINAL = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const env = process.env as Record<string, string | undefined>;

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    if (key in values) env[key] = values[key];
    else if (key !== "NODE_ENV") delete env[key];
  }
}

const call = (handler: typeof GET, headers: Record<string, string> = {}) =>
  handler(new Request("https://nesafric.test/api/jobs/run", { method: handler === POST ? "POST" : "GET", headers }));

async function seedExpiredCounter() {
  await db.publicWriteCounter.create({ data: { bucket: "enquiry.ip.10m", keyHash: "jobs-auth-old", windowStart: new Date(0), count: 1, expiresAt: new Date(1000) } });
}

describe("/api/jobs/run authorization (fail-closed)", () => {
  let drain: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await db.publicWriteCounter.deleteMany();
    drain = vi.spyOn(runner, "runDueJobs").mockResolvedValue(undefined as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of ENV_KEYS) {
      if (ORIGINAL[key] === undefined) delete env[key];
      else env[key] = ORIGINAL[key];
    }
  });
  afterAll(async () => {
    await db.publicWriteCounter.deleteMany();
    await db.$disconnect();
  });

  it("refuses every call when no secret is configured, and does no work", async () => {
    setEnv({ NODE_ENV: "production" });
    await seedExpiredCounter();
    for (const handler of [GET, POST]) {
      const response = await call(handler, { authorization: "Bearer anything", "x-jobs-run-secret": "anything" });
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("JOBS_RUN_NOT_CONFIGURED");
    }
    expect(drain).not.toHaveBeenCalled();
    expect(await db.publicWriteCounter.count()).toBe(1);
  });

  it("ignores the local-development opt-in in production", async () => {
    setEnv({ NODE_ENV: "production", ALLOW_UNAUTHENTICATED_JOBS_RUN: "true" });
    expect((await call(GET)).status).toBe(503);
    expect(drain).not.toHaveBeenCalled();
  });

  it("allows unauthenticated runs only with the explicit opt-in outside production", async () => {
    setEnv({ NODE_ENV: "development" });
    expect((await call(GET)).status).toBe(503);
    setEnv({ NODE_ENV: "development", ALLOW_UNAUTHENTICATED_JOBS_RUN: "true" });
    expect((await call(GET)).status).toBe(200);
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it("accepts Vercel Cron's Bearer CRON_SECRET and refuses anything else", async () => {
    setEnv({ NODE_ENV: "production", CRON_SECRET: "cron-secret-value-for-tests" });
    await seedExpiredCounter();
    expect((await call(GET)).status).toBe(401);
    expect((await call(GET, { authorization: "Bearer wrong-secret" })).status).toBe(401);
    expect((await call(GET, { "x-jobs-run-secret": "cron-secret-value-for-tests" })).status).toBe(401);
    expect(drain).not.toHaveBeenCalled();
    expect(await db.publicWriteCounter.count()).toBe(1);

    expect((await call(GET, { authorization: "Bearer cron-secret-value-for-tests" })).status).toBe(200);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(await db.publicWriteCounter.count()).toBe(0);
  });

  it("accepts JOBS_RUN_SECRET via x-jobs-run-secret or Bearer", async () => {
    setEnv({ NODE_ENV: "production", JOBS_RUN_SECRET: "jobs-secret-value-for-tests" });
    expect((await call(POST, { "x-jobs-run-secret": "jobs-secret-value-for-tests" })).status).toBe(200);
    expect((await call(GET, { authorization: "Bearer jobs-secret-value-for-tests" })).status).toBe(200);
    expect((await call(POST, { "x-jobs-run-secret": "jobs-secret-value-for-test" })).status).toBe(401);
    expect(drain).toHaveBeenCalledTimes(2);
  });
});
