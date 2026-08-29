import { describe, expect, it } from "vitest";
import os from "node:os";
import { LocalFilesystemStorageAdapter } from "@/platform/storage/local-adapter";

describe("LocalFilesystemStorageAdapter", () => {
  it("writes and reads an object using its default (no-argument) root directory", async () => {
    // Regression guard: a real Preview deployment crashed with ENOENT on the very first evidence
    // upload because the previous default root was `process.cwd()`-relative — writable in local
    // dev (where this exact test would have passed even with the bug), but not on Vercel's
    // serverless runtime, where the bundle root is read-only. Constructing with no argument here
    // (rather than an injected temp-dir override) is the point: it must resolve to something
    // writable everywhere, not just in a test harness that happens to run from a writable cwd.
    const adapter = new LocalFilesystemStorageAdapter();
    const key = `unit-test/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    await adapter.putObject({ key, body: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg", classification: "PRIVATE" });
    const stored = await adapter.getObject(key);
    expect(stored?.contentType).toBe("image/jpeg");
    expect(stored?.body.equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    await adapter.deleteObject(key);
    expect(await adapter.exists(key)).toBe(false);
  });

  it("defaults to a directory under the OS temp dir, not the process working directory", () => {
    const adapter = new LocalFilesystemStorageAdapter();
    // @ts-expect-error -- reaching into the private field is the simplest direct way to assert
    // the actual default without duplicating path-join logic in the test itself.
    const rootDir: string = adapter.rootDir;
    expect(rootDir.startsWith(os.tmpdir())).toBe(true);
    expect(rootDir.startsWith(process.cwd())).toBe(false);
  });
});
