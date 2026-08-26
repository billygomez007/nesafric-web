import type { ObjectStorageAdapter } from "./types";
import { S3CompatibleStorageAdapter } from "./s3-adapter";
import { LocalFilesystemStorageAdapter } from "./local-adapter";
import { InMemoryStorageAdapter } from "./memory-adapter";
import { HttpMalwareScanner, NullMalwareScanner, type MalwareScanner } from "./malware-scanner";

const s3Adapter = new S3CompatibleStorageAdapter();
const localAdapter = new LocalFilesystemStorageAdapter();
const memoryAdapter = new InMemoryStorageAdapter();
const httpMalwareScanner = new HttpMalwareScanner();
const nullMalwareScanner = new NullMalwareScanner();

/**
 * Resolves the active object storage adapter for this process. Selection is re-evaluated on
 * every call (env reads are cheap) so tests can flip `STORAGE_PROVIDER` between assertions:
 *  - `STORAGE_PROVIDER=memory|local|s3` forces that adapter explicitly.
 *  - Otherwise, S3-compatible credentials being present selects the production adapter.
 *  - With nothing configured, the filesystem adapter is used (durable across requests in dev).
 */
export function getObjectStorageAdapter(): ObjectStorageAdapter {
  const explicit = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (explicit === "memory") return memoryAdapter;
  if (explicit === "local") return localAdapter;
  if (explicit === "s3" || s3Adapter.isConfigured()) return s3Adapter;
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
