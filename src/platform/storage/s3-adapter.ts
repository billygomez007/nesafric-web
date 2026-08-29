import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl as presign } from "@aws-sdk/s3-request-presigner";
import { AppError } from "@/platform/errors";
import type { ObjectStorageAdapter, PutObjectInput, SignedUrlOptions, StorageClassificationValue, StoredObjectPayload } from "./types";
import { isCloudRuntime } from "./environment";

function env(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (body instanceof Uint8Array) return Buffer.from(body);
  const stream = body as AsyncIterable<Uint8Array>;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

type BucketCredentials = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  publicBaseUrl?: string;
  forcePathStyle: boolean;
};

/**
 * Production-ready object storage adapter for any S3-compatible provider (AWS S3, MinIO,
 * DigitalOcean Spaces, Cloudflare R2, Backblaze B2, ...).
 *
 * Two physically separate buckets, not a shared bucket with a prefix or an ACL: UmoAfric stores
 * highly sensitive identity documents (Ghana Card, business registration, licences) alongside
 * public marketing media, and providers like Cloudflare R2 do not reliably enforce per-object
 * ACLs — a bucket's public-access setting is the only access-control boundary that actually
 * holds. Bucket separation is therefore the real security boundary here, not the `classification`
 * value passed to `putObject` (which still selects the bucket, but must never be trusted as the
 * *only* thing standing between a Ghana Card and the public internet).
 *
 * `classification` is never re-derived from the object key — the key format is an internal
 * organisational convenience (see `documents/service.ts`'s `private/`/`public/` prefix), not a
 * security control a caller could spoof. Every read/delete call must state which bucket it means.
 */
export class S3CompatibleStorageAdapter implements ObjectStorageAdapter {
  readonly providerKey = "s3-compatible";
  private clients = new Map<string, S3Client>();

  private shared() {
    return {
      region: env("STORAGE_S3_REGION") ?? "auto",
      endpoint: env("STORAGE_S3_ENDPOINT"),
      forcePathStyle: env("STORAGE_S3_FORCE_PATH_STYLE") === "true",
      defaultAccessKeyId: env("STORAGE_S3_ACCESS_KEY_ID"),
      defaultSecretAccessKey: env("STORAGE_S3_SECRET_ACCESS_KEY"),
    };
  }

  /**
   * Resolves one bucket's full credentials. Least-privilege: `STORAGE_S3_PRIVATE_*`/
   * `STORAGE_S3_PUBLIC_*` access keys are checked first, so an operator can hand this adapter a
   * key that can only touch the private bucket and a separate one that can only touch the public
   * bucket; either falls back to the shared `STORAGE_S3_ACCESS_KEY_ID`/`SECRET_ACCESS_KEY` when a
   * dedicated pair isn't set (the common case: one API token with access to both buckets).
   *
   * The legacy singular `STORAGE_S3_BUCKET` is honoured only outside a cloud deployment (local
   * development convenience for someone testing real S3 integration from their laptop with one
   * bucket) — never in Preview/Production, and never once the explicit private/public bucket name
   * is set, so a cloud deployment can never silently store identity evidence in a bucket that was
   * only ever intended as a generic single-bucket fallback.
   */
  private credentialsFor(classification: StorageClassificationValue): BucketCredentials | null {
    const shared = this.shared();
    const explicitBucket = classification === "PRIVATE" ? env("STORAGE_S3_PRIVATE_BUCKET") : env("STORAGE_S3_PUBLIC_BUCKET");
    const bucket = explicitBucket ?? (isCloudRuntime() ? undefined : env("STORAGE_S3_BUCKET"));
    if (!bucket) return null;
    const accessKeyId = (classification === "PRIVATE" ? env("STORAGE_S3_PRIVATE_ACCESS_KEY_ID") : env("STORAGE_S3_PUBLIC_ACCESS_KEY_ID")) ?? shared.defaultAccessKeyId;
    const secretAccessKey = (classification === "PRIVATE" ? env("STORAGE_S3_PRIVATE_SECRET_ACCESS_KEY") : env("STORAGE_S3_PUBLIC_SECRET_ACCESS_KEY")) ?? shared.defaultSecretAccessKey;
    if (!accessKeyId || !secretAccessKey) return null;
    return {
      bucket, accessKeyId, secretAccessKey, region: shared.region, endpoint: shared.endpoint, forcePathStyle: shared.forcePathStyle,
      // Only the PUBLIC bucket ever has (or needs) a public base URL — a PRIVATE object must never
      // resolve to one regardless of what's configured.
      publicBaseUrl: classification === "PUBLIC" ? env("STORAGE_PUBLIC_BASE_URL") : undefined,
    };
  }

  isPrivateConfigured() {
    return this.credentialsFor("PRIVATE") !== null;
  }

  isPublicConfigured() {
    return this.credentialsFor("PUBLIC") !== null;
  }

  /** Whether *either* bucket is usable — the coarse signal the registry uses to decide whether to
   * route to this adapter at all (vs. local/in-memory). Per-classification readiness, which is
   * what actually determines whether a given upload can succeed, is the two methods above. */
  isConfigured() {
    return this.isPrivateConfigured() || this.isPublicConfigured();
  }

  private requireCredentials(classification: StorageClassificationValue): BucketCredentials {
    const credentials = this.credentialsFor(classification);
    if (!credentials) {
      throw new AppError(
        classification === "PRIVATE" ? "STORAGE_PRIVATE_NOT_CONFIGURED" : "STORAGE_PUBLIC_NOT_CONFIGURED",
        503,
        `${classification === "PRIVATE" ? "Private" : "Public"} file storage is not yet configured for this deployment. Please try again shortly, or contact support if this persists.`,
      );
    }
    return credentials;
  }

  private getClient(credentials: BucketCredentials) {
    const cacheKey = `${credentials.endpoint ?? ""}::${credentials.accessKeyId}`;
    let client = this.clients.get(cacheKey);
    if (!client) {
      client = new S3Client({
        region: credentials.region,
        endpoint: credentials.endpoint,
        forcePathStyle: credentials.forcePathStyle,
        credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
      });
      this.clients.set(cacheKey, client);
    }
    return client;
  }

  async putObject(input: PutObjectInput) {
    const credentials = this.requireCredentials(input.classification);
    const client = this.getClient(credentials);
    await client.send(new PutObjectCommand({
      Bucket: credentials.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      // Sent as defense-in-depth on providers that do honour it (real AWS S3) — bucket separation
      // above is what actually enforces this, since R2 does not reliably apply per-object ACLs.
      ACL: input.classification === "PUBLIC" ? "public-read" : "private",
    }));
    return { key: input.key };
  }

  async getObject(key: string, classification: StorageClassificationValue): Promise<StoredObjectPayload | null> {
    const credentials = this.requireCredentials(classification);
    const client = this.getClient(credentials);
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: credentials.bucket, Key: key }));
      const body = await streamToBuffer(result.Body);
      return { body, contentType: result.ContentType ?? "application/octet-stream" };
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      throw error;
    }
  }

  async deleteObject(key: string, classification: StorageClassificationValue) {
    const credentials = this.requireCredentials(classification);
    const client = this.getClient(credentials);
    await client.send(new DeleteObjectCommand({ Bucket: credentials.bucket, Key: key }));
  }

  /** Always the PUBLIC bucket — returns `null` (never throws) when it isn't configured, so a
   * caller can gracefully fall back to the internal public-media streaming route instead. A real
   * upload already fails fast at `putObject` time if the public bucket is missing; this only
   * matters for resolving a URL for something already known to exist. */
  getPublicUrl(key: string): string | null {
    const credentials = this.credentialsFor("PUBLIC");
    if (!credentials) return null;
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    if (credentials.publicBaseUrl) return `${credentials.publicBaseUrl.replace(/\/$/, "")}/${encodedKey}`;
    if (credentials.endpoint) {
      const base = credentials.forcePathStyle ? `${credentials.endpoint.replace(/\/$/, "")}/${credentials.bucket}` : credentials.endpoint.replace("://", `://${credentials.bucket}.`);
      return `${base.replace(/\/$/, "")}/${encodedKey}`;
    }
    return `https://${credentials.bucket}.s3.${credentials.region}.amazonaws.com/${encodedKey}`;
  }

  async getSignedUrl(key: string, classification: StorageClassificationValue, options?: SignedUrlOptions) {
    const credentials = this.requireCredentials(classification);
    const client = this.getClient(credentials);
    const command = new GetObjectCommand({
      Bucket: credentials.bucket,
      Key: key,
      ...(options?.fileName ? { ResponseContentDisposition: `attachment; filename="${options.fileName}"` } : {}),
    });
    return presign(client, command, { expiresIn: options?.expiresInSeconds ?? 300 });
  }
}
