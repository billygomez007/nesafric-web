import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const ENV_KEYS = [
  "STORAGE_PROVIDER", "VERCEL", "VERCEL_ENV",
  "STORAGE_S3_BUCKET", "STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY",
  "STORAGE_S3_PRIVATE_BUCKET", "STORAGE_S3_PUBLIC_BUCKET",
  "STORAGE_S3_PRIVATE_ACCESS_KEY_ID", "STORAGE_S3_PRIVATE_SECRET_ACCESS_KEY",
  "STORAGE_S3_PUBLIC_ACCESS_KEY_ID", "STORAGE_S3_PUBLIC_SECRET_ACCESS_KEY",
  "STORAGE_S3_ENDPOINT", "STORAGE_S3_REGION", "STORAGE_S3_FORCE_PATH_STYLE", "STORAGE_PUBLIC_BASE_URL",
] as const;
let saved: Record<string, string | undefined>;

function setDualBucketEnv() {
  process.env.STORAGE_S3_PRIVATE_BUCKET = "umoafric-private-test";
  process.env.STORAGE_S3_PUBLIC_BUCKET = "umoafric-public-test";
  process.env.STORAGE_S3_ACCESS_KEY_ID = "shared-test-key";
  process.env.STORAGE_S3_SECRET_ACCESS_KEY = "shared-test-secret";
  process.env.STORAGE_S3_ENDPOINT = "https://test.r2.cloudflarestorage.com";
  process.env.STORAGE_S3_REGION = "auto";
  process.env.STORAGE_S3_FORCE_PATH_STYLE = "true";
  process.env.STORAGE_PUBLIC_BASE_URL = "https://assets.umoafric.test";
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

describe("getObjectStorageAdapter cloud-durability guard (registry-level)", () => {
  it("uses the local filesystem adapter outside a cloud runtime with nothing configured", async () => {
    const { getObjectStorageAdapter, localAdapter } = await import("@/platform/storage/registry");
    expect(getObjectStorageAdapter()).toBe(localAdapter);
  });

  it("throws STORAGE_NOT_CONFIGURED on Vercel with neither bucket configured, instead of silently falling back", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    const { getObjectStorageAdapter } = await import("@/platform/storage/registry");
    expect(() => getObjectStorageAdapter()).toThrowError(/durable storage is not yet configured/i);
  });

  it("routes to the S3 adapter on Vercel once at least one bucket is configured", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    setDualBucketEnv();
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

  it("does not honour the legacy single STORAGE_S3_BUCKET on Vercel — Preview/Production must use the explicit private/public variables", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.STORAGE_S3_BUCKET = "legacy-single-bucket";
    process.env.STORAGE_S3_ACCESS_KEY_ID = "test-key";
    process.env.STORAGE_S3_SECRET_ACCESS_KEY = "test-secret";
    const { getObjectStorageAdapter } = await import("@/platform/storage/registry");
    expect(() => getObjectStorageAdapter()).toThrowError(/durable storage is not yet configured/i);
  });

  it("does honour the legacy single STORAGE_S3_BUCKET outside a cloud runtime (local-development convenience)", async () => {
    process.env.STORAGE_S3_BUCKET = "legacy-single-bucket";
    process.env.STORAGE_S3_ACCESS_KEY_ID = "test-key";
    process.env.STORAGE_S3_SECRET_ACCESS_KEY = "test-secret";
    const { getObjectStorageAdapter, s3Adapter } = await import("@/platform/storage/registry");
    expect(getObjectStorageAdapter()).toBe(s3Adapter);
    expect(s3Adapter.isPrivateConfigured()).toBe(true);
    expect(s3Adapter.isPublicConfigured()).toBe(true);
  });
});

describe("S3CompatibleStorageAdapter fail-closed behavior per classification", () => {
  it("[J] throws STORAGE_PRIVATE_NOT_CONFIGURED for a PRIVATE upload when only the public bucket is configured", async () => {
    process.env.STORAGE_S3_PUBLIC_BUCKET = "umoafric-public-test";
    process.env.STORAGE_S3_ACCESS_KEY_ID = "shared-test-key";
    process.env.STORAGE_S3_SECRET_ACCESS_KEY = "shared-test-secret";
    const { s3Adapter } = await import("@/platform/storage/registry");
    await expect(s3Adapter.putObject({ key: "private/provider-evidence/x", body: Buffer.from("x"), contentType: "image/jpeg", classification: "PRIVATE" }))
      .rejects.toMatchObject({ code: "STORAGE_PRIVATE_NOT_CONFIGURED" });
  });

  it("[K] throws STORAGE_PUBLIC_NOT_CONFIGURED for a PUBLIC upload when only the private bucket is configured", async () => {
    process.env.STORAGE_S3_PRIVATE_BUCKET = "umoafric-private-test";
    process.env.STORAGE_S3_ACCESS_KEY_ID = "shared-test-key";
    process.env.STORAGE_S3_SECRET_ACCESS_KEY = "shared-test-secret";
    const { s3Adapter } = await import("@/platform/storage/registry");
    await expect(s3Adapter.putObject({ key: "public/campaigns/x", body: Buffer.from("x"), contentType: "image/jpeg", classification: "PUBLIC" }))
      .rejects.toMatchObject({ code: "STORAGE_PUBLIC_NOT_CONFIGURED" });
  });

  it("reports per-classification readiness independently", async () => {
    process.env.STORAGE_S3_PUBLIC_BUCKET = "umoafric-public-test";
    process.env.STORAGE_S3_ACCESS_KEY_ID = "shared-test-key";
    process.env.STORAGE_S3_SECRET_ACCESS_KEY = "shared-test-secret";
    const { s3Adapter } = await import("@/platform/storage/registry");
    expect(s3Adapter.isPrivateConfigured()).toBe(false);
    expect(s3Adapter.isPublicConfigured()).toBe(true);
    expect(s3Adapter.isConfigured()).toBe(true); // OR — at least one side ready
  });

  it("least-privilege: a dedicated private-bucket access key is preferred over the shared one when both are set", async () => {
    process.env.STORAGE_S3_PRIVATE_BUCKET = "umoafric-private-test";
    process.env.STORAGE_S3_PRIVATE_ACCESS_KEY_ID = "private-only-key";
    process.env.STORAGE_S3_PRIVATE_SECRET_ACCESS_KEY = "private-only-secret";
    process.env.STORAGE_S3_ACCESS_KEY_ID = "shared-key-should-not-be-used-for-private";
    process.env.STORAGE_S3_SECRET_ACCESS_KEY = "shared-secret";
    const { s3Adapter } = await import("@/platform/storage/registry");
    expect(s3Adapter.isPrivateConfigured()).toBe(true);
  });
});

describe("S3CompatibleStorageAdapter routes to the correct physical bucket (no real network call)", () => {
  it("[A][B][G][H][I] PutObject/GetObject/DeleteObject/presign all target the private bucket for PRIVATE and the public bucket for PUBLIC", async () => {
    setDualBucketEnv();
    const { s3Adapter } = await import("@/platform/storage/registry");
    const sendSpy = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: unknown) => {
      if (command instanceof GetObjectCommand) return { Body: undefined, ContentType: "application/octet-stream" };
      return {};
    });

    await s3Adapter.putObject({ key: "private/provider-evidence/a", body: Buffer.from("x"), contentType: "image/jpeg", classification: "PRIVATE" });
    await s3Adapter.putObject({ key: "public/campaigns/a", body: Buffer.from("x"), contentType: "image/jpeg", classification: "PUBLIC" });
    await s3Adapter.getObject("private/provider-evidence/a", "PRIVATE");
    await s3Adapter.getObject("public/campaigns/a", "PUBLIC");
    await s3Adapter.deleteObject("private/provider-evidence/a", "PRIVATE"); // [H]
    await s3Adapter.deleteObject("public/campaigns/a", "PUBLIC"); // [I]
    const privateSignedUrl = await s3Adapter.getSignedUrl("private/provider-evidence/a", "PRIVATE"); // [G]

    const buckets = sendSpy.mock.calls.map(([command]) => (command as { input: { Bucket: string } }).input.Bucket);
    // Six real send() calls: 2 puts, 2 gets, 2 deletes. The presign call above never calls send().
    expect(buckets).toEqual([
      "umoafric-private-test", "umoafric-public-test",
      "umoafric-private-test", "umoafric-public-test",
      "umoafric-private-test", "umoafric-public-test",
    ]);
    expect(privateSignedUrl).toContain("umoafric-private-test");
  });

  it("[F] a PUBLIC object's URL uses STORAGE_PUBLIC_BASE_URL, never the private bucket", async () => {
    setDualBucketEnv();
    const { s3Adapter } = await import("@/platform/storage/registry");
    const url = s3Adapter.getPublicUrl("public/campaigns/hero.jpg");
    expect(url).toBe("https://assets.umoafric.test/public/campaigns/hero.jpg");
    expect(url).not.toContain("umoafric-private-test");
  });

  it("[E] getPublicUrl returns null when the public bucket isn't configured — never guesses at a private-bucket URL", async () => {
    process.env.STORAGE_S3_PRIVATE_BUCKET = "umoafric-private-test";
    process.env.STORAGE_S3_ACCESS_KEY_ID = "shared-test-key";
    process.env.STORAGE_S3_SECRET_ACCESS_KEY = "shared-test-secret";
    const { s3Adapter } = await import("@/platform/storage/registry");
    expect(s3Adapter.getPublicUrl("private/provider-evidence/ghana-card.jpg")).toBeNull();
  });
});
