import type { ObjectStorageAdapter, PutObjectInput, SignedUrlOptions, StoredObjectPayload } from "./types";
import { buildLocalSignedUrl } from "./signed-links";

/**
 * Pure in-memory object storage adapter: no disk I/O, fully isolated per process. Used by the
 * automated test suite by default (deterministic, nothing to clean up between runs) and available
 * for any environment that explicitly opts in with `STORAGE_PROVIDER=memory`.
 */
export class InMemoryStorageAdapter implements ObjectStorageAdapter {
  readonly providerKey = "in-memory";
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  isConfigured() {
    return true;
  }

  isPrivateConfigured() {
    return true;
  }

  isPublicConfigured() {
    return true;
  }

  async putObject(input: PutObjectInput) {
    this.objects.set(input.key, { body: Buffer.from(input.body), contentType: input.contentType });
    return { key: input.key };
  }

  async getObject(key: string, _classification?: string): Promise<StoredObjectPayload | null> {
    const found = this.objects.get(key);
    return found ? { body: Buffer.from(found.body), contentType: found.contentType } : null;
  }

  async deleteObject(key: string, _classification?: string) {
    this.objects.delete(key);
  }

  getPublicUrl(): string | null {
    return null;
  }

  async getSignedUrl(key: string, _classification?: string, options?: SignedUrlOptions) {
    return buildLocalSignedUrl(key, options?.expiresInSeconds ?? 300);
  }

  /** Test-only helper to reset state between suites. */
  clear() {
    this.objects.clear();
  }
}
