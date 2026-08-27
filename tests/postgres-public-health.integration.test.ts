import { afterAll, describe, expect, it } from "vitest";
import { getPublicHealth } from "@/modules/health/service";
import { db } from "@/platform/database/client";

describe("Public health endpoint (item 15)", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("reports HEALTHY with Postgres reachable, never failing on unconfigured optional providers", async () => {
    const health = await getPublicHealth();
    expect(health.status).toBe("HEALTHY");
    expect(health.database.status).toBe("UP");
    expect(health.application.status).toBe("UP");
    const names = health.providers.map((provider) => provider.name);
    expect(names).toEqual(expect.arrayContaining(["backgroundWorker", "ai", "payments", "saasBilling", "storage", "malwareScan", "esignature", "geocoding", "calendar", "sms", "whatsapp", "email", "voice"]));
    // Voice must never claim readiness merely from unrelated configuration in this environment.
    const voice = health.providers.find((provider) => provider.name === "voice");
    expect(voice?.readiness).toBe("DEFERRED");
  });
});
