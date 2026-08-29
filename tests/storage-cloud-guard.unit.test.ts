import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENV_KEYS = ["STORAGE_PROVIDER", "VERCEL", "VERCEL_ENV", "STORAGE_S3_BUCKET", "STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("getObjectStorageAdapter cloud-durability guard", () => {
  it("uses the local filesystem adapter outside a cloud runtime with nothing configured", async () => {
    const { getObjectStorageAdapter, localAdapter } = await import("@/platform/storage/registry");
    expect(getObjectStorageAdapter()).toBe(localAdapter);
  });

  it("throws STORAGE_NOT_CONFIGURED on Vercel (Preview/Production) with no durable storage configured, instead of silently falling back", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    const { getObjectStorageAdapter } = await import("@/platform/storage/registry");
    expect(() => getObjectStorageAdapter()).toThrowError(/durable storage is not yet configured/i);
  });

  it("does not throw on Vercel when S3-compatible credentials are actually configured", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.STORAGE_S3_BUCKET = "test-bucket";
    process.env.STORAGE_S3_ACCESS_KEY_ID = "test-key";
    process.env.STORAGE_S3_SECRET_ACCESS_KEY = "test-secret";
    const { getObjectStorageAdapter, s3Adapter } = await import("@/platform/storage/registry");
    expect(getObjectStorageAdapter()).toBe(s3Adapter);
  });

  it("still allows an explicit STORAGE_PROVIDER=local override on Vercel — a deliberate operator choice, not a silent fallback", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    process.env.STORAGE_PROVIDER = "local";
    const { getObjectStorageAdapter, localAdapter } = await import("@/platform/storage/registry");
    expect(getObjectStorageAdapter()).toBe(localAdapter);
  });

  it("does not throw for `vercel dev` running locally (VERCEL_ENV=development)", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "development";
    const { getObjectStorageAdapter, localAdapter } = await import("@/platform/storage/registry");
    expect(getObjectStorageAdapter()).toBe(localAdapter);
  });
});
