/**
 * Provider-neutral object storage contract (Phase 19, item 1). Every adapter — the
 * production S3-compatible adapter and the local/in-memory development-and-test adapters —
 * implements this same interface so callers never depend on a specific storage vendor.
 * Files are always addressed by an opaque `key`; the database never stores file bytes.
 */
export type StorageClassificationValue = "PRIVATE" | "PUBLIC";

export type PutObjectInput = {
  key: string;
  body: Buffer;
  contentType: string;
  classification: StorageClassificationValue;
};

export type SignedUrlOptions = {
  /** Defaults to a conservative short lifetime; callers needing longer-lived links must say so explicitly. */
  expiresInSeconds?: number;
  fileName?: string;
};

export type StoredObjectPayload = {
  body: Buffer;
  contentType: string;
};

export interface ObjectStorageAdapter {
  /** Stable identifier for this adapter, surfaced (never with secrets) in integration health. */
  readonly providerKey: string;
  /** Whether this adapter can serve *either* classification right now — used only to decide
   * whether to route to this adapter at all (vs. local/in-memory). Per-classification readiness
   * (the thing that actually matters for a real upload) is `isPrivateConfigured`/`isPublicConfigured`. */
  isConfigured(): boolean;
  /** Whether the PRIVATE-classification bucket/credentials are actually usable. */
  isPrivateConfigured(): boolean;
  /** Whether the PUBLIC-classification bucket/credentials are actually usable. */
  isPublicConfigured(): boolean;
  putObject(input: PutObjectInput): Promise<{ key: string }>;
  /** `classification` tells a dual-bucket adapter which physical bucket to read from — it is not
   * re-derived from the key, since bucket identity is never encoded in the key itself. */
  getObject(key: string, classification: StorageClassificationValue): Promise<StoredObjectPayload | null>;
  deleteObject(key: string, classification: StorageClassificationValue): Promise<void>;
  /**
   * A durable, directly fetchable URL for a PUBLIC object, or `null` when this adapter has no
   * way to produce one (callers fall back to the internal public-media streaming route, which
   * always works regardless of adapter). Always resolves against the PUBLIC bucket — there is no
   * such thing as a "public URL" for a PRIVATE object, so no classification parameter is needed.
   */
  getPublicUrl(key: string): string | null;
  /** A time-limited signed URL usable to fetch the object without further authentication. */
  getSignedUrl(key: string, classification: StorageClassificationValue, options?: SignedUrlOptions): Promise<string>;
}

export class StorageObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Storage object '${key}' was not found.`);
  }
}
