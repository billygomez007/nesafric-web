import { afterEach, describe, expect, it } from "vitest";

const envKeys = [
  "STORAGE_PROVIDER",
  "STORAGE_GCS_PROJECT_ID",
  "STORAGE_GCS_PRIVATE_BUCKET",
  "STORAGE_GCS_PUBLIC_BUCKET",
  "STORAGE_S3_PRIVATE_BUCKET",
  "STORAGE_S3_PUBLIC_BUCKET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
];

const snapshot = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of envKeys) {
    const value = snapshot[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("public health storage readiness", () => {
  it("reports configured GCS private and public storage through the active adapter", async () => {
    process.env.STORAGE_PROVIDER = "gcs";
    process.env.STORAGE_GCS_PROJECT_ID = "nesafric-health-test";
    process.env.STORAGE_GCS_PRIVATE_BUCKET = "nesafric-private-test";
    process.env.STORAGE_GCS_PUBLIC_BUCKET = "nesafric-public-test";

    delete process.env.STORAGE_S3_PRIVATE_BUCKET;
    delete process.env.STORAGE_S3_PUBLIC_BUCKET;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    const { getPublicHealth } = await import("@/modules/health/service");

    const health = await getPublicHealth();

    const privateStorage = health.providers.find(
      (provider) => provider.name === "storagePrivate",
    );
    const publicStorage = health.providers.find(
      (provider) => provider.name === "storagePublic",
    );

    expect(privateStorage?.readiness).toBe("CONFIGURED");
    expect(publicStorage?.readiness).toBe("CONFIGURED");
  });
});
