import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectStorageAdapter, PutObjectInput, SignedUrlOptions, StoredObjectPayload } from "./types";
import { buildLocalSignedUrl } from "./signed-links";

/**
 * Filesystem-backed object storage adapter used for local development when no S3-compatible
 * credentials are configured. Durable across requests within the same machine/container (unlike
 * the in-memory adapter), but never used in production — `isConfigured()` always returns `true`
 * because it has no external credentials to be missing, it is simply not production-ready.
 */
export class LocalFilesystemStorageAdapter implements ObjectStorageAdapter {
  readonly providerKey = "local-filesystem";

  constructor(private readonly rootDir: string = path.join(process.cwd(), "var", "object-storage")) {}

  isConfigured() {
    return true;
  }

  private filePath(key: string) {
    const normalized = path.normalize(key).replace(/^([./\\]+)/, "");
    const resolved = path.join(this.rootDir, normalized);
    if (!resolved.startsWith(this.rootDir)) throw new Error("Refusing to write outside the local storage root.");
    return resolved;
  }

  async putObject(input: PutObjectInput) {
    const filePath = this.filePath(input.key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, input.body);
    await writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType: input.contentType, classification: input.classification }));
    return { key: input.key };
  }

  async getObject(key: string): Promise<StoredObjectPayload | null> {
    const filePath = this.filePath(key);
    try {
      const [body, metaRaw] = await Promise.all([readFile(filePath), readFile(`${filePath}.meta.json`, "utf8").catch(() => "{}")]);
      const meta = JSON.parse(metaRaw) as { contentType?: string };
      return { body, contentType: meta.contentType ?? "application/octet-stream" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async deleteObject(key: string) {
    const filePath = this.filePath(key);
    await rm(filePath, { force: true });
    await rm(`${filePath}.meta.json`, { force: true });
  }

  async exists(key: string) {
    try {
      await stat(this.filePath(key));
      return true;
    } catch {
      return false;
    }
  }

  /** No independent web server: the caller falls back to the internal public-media streaming route. */
  getPublicUrl(): string | null {
    return null;
  }

  async getSignedUrl(key: string, options?: SignedUrlOptions) {
    return buildLocalSignedUrl(key, options?.expiresInSeconds ?? 300);
  }
}
