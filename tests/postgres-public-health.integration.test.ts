import { afterAll, afterEach, describe, expect, it } from "vitest";
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
    expect(names).toEqual(expect.arrayContaining(["backgroundWorker", "ai", "payments", "saasBilling", "storagePrivate", "storagePublic", "malwareScan", "esignature", "geocoding", "calendar", "sms", "whatsapp", "email", "voice"]));
    // Voice must never claim readiness merely from unrelated configuration in this environment.
    const voice = health.providers.find((provider) => provider.name === "voice");
    expect(voice?.readiness).toBe("DEFERRED");
  });

  describe("email provider reporting", () => {
    const originalKey = process.env.RESEND_API_KEY;
    afterEach(() => {
      if (originalKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalKey;
    });

    it("reports TEST_MODE truthfully when RESEND_API_KEY is unset", async () => {
      delete process.env.RESEND_API_KEY;
      const health = await getPublicHealth();
      const email = health.providers.find((provider) => provider.name === "email");
      expect(email?.readiness).toBe("TEST_MODE");
    });

    it("reports CONFIGURED once RESEND_API_KEY is set, and never leaks the key value anywhere in the response", async () => {
      process.env.RESEND_API_KEY = "re_should_never_appear_in_any_response_abc123";
      const health = await getPublicHealth();
      const email = health.providers.find((provider) => provider.name === "email");
      expect(email?.readiness).toBe("CONFIGURED");
      expect(JSON.stringify(health)).not.toContain("re_should_never_appear_in_any_response_abc123");
    });
  });
});
