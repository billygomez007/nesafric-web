import { AppError } from "@/platform/errors";
import type { ObjectStorageAdapter } from "./types";
import { S3CompatibleStorageAdapter } from "./s3-adapter";
import { LocalFilesystemStorageAdapter } from "./local-adapter";
import { InMemoryStorageAdapter } from "./memory-adapter";
import { HttpMalwareScanner, NullMalwareScanner, type MalwareScanner } from "./malware-scanner";
import { isCloudRuntime } from "./environment";

const s3Adapter = new S3CompatibleStorageAdapter();
const localAdapter = new LocalFilesystemStorageAdapter();
const memoryAdapter = new InMemoryStorageAdapter();
const httpMalwareScanner = new HttpMalwareScanner();
const nullMalwareScanner = new NullMalwareScanner();

/**
 * Resolves the active object storage adapter for this process. Selection is re-evaluated on
 * every call (env reads are cheap) so tests can flip `STORAGE_PROVIDER` between assertions:
 *  - `STORAGE_PROVIDER=memory|local|s3` forces that adapter explicitly — an operator opting into
 *    the local adapter on Vercel on purpose is a deliberate choice, not a silent fallback, so it's
 *    still honoured.
 *  - Otherwise, S3-compatible credentials for *either* bucket being present selects the durable
 *    adapter — this is deliberately an OR, not an AND: if only the public bucket is configured, a
 *    PUBLIC upload should still go to S3 (and succeed), while a PRIVATE upload correctly fails
 *    with the specific `STORAGE_PRIVATE_NOT_CONFIGURED` from inside the adapter itself, rather
 *    than both classifications being routed to local storage just because one side is incomplete.
 *  - With NEITHER bucket configured and nothing explicitly forced: the filesystem adapter is used
 *    in a local/test environment (durable enough across requests there), but a cloud deployment
 *    (Preview or Production) throws instead of silently writing to a directory (`/tmp` on Vercel)
 *    that doesn't survive between invocations — a Ghana Card upload that "succeeds" but is gone
 *    moments later is worse than one that fails clearly and immediately.
 */
export function getObjectStorageAdapter(): ObjectStorageAdapter {
  const explicit = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (explicit === "memory") return memoryAdapter;
  if (explicit === "local") return localAdapter;
  if (explicit === "s3" || s3Adapter.isConfigured()) return s3Adapter;
  if (isCloudRuntime()) {
    throw new AppError(
      "STORAGE_NOT_CONFIGURED",
      503,
      "File uploads are temporarily unavailable — durable storage is not yet configured for this deployment. Please try again shortly, or contact support if this persists.",
    );
  }
  return localAdapter;
}

export function getMalwareScanner(): MalwareScanner {
  return httpMalwareScanner.isConfigured() ? httpMalwareScanner : nullMalwareScanner;
}

/** Test-only: clears the in-memory adapter's contents between test files. */
export function resetInMemoryStorageForTests() {
  memoryAdapter.clear();
}

export { s3Adapter, localAdapter, memoryAdapter };
export * from "./types";
export * from "./mime";
export * from "./malware-scanner";
export * from "./signed-links";
