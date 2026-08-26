import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl as presign } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorageAdapter, PutObjectInput, SignedUrlOptions, StoredObjectPayload } from "./types";

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

/**
 * Production-ready object storage adapter for any S3-compatible provider (AWS S3, MinIO,
 * DigitalOcean Spaces, Cloudflare R2, Backblaze B2, ...). Which vendor sits behind
 * `STORAGE_S3_ENDPOINT` is an operational/env concern, matching the provider-neutral pattern
 * already used for the payment and communication-channel adapters elsewhere in this codebase.
 */
export class S3CompatibleStorageAdapter implements ObjectStorageAdapter {
  readonly providerKey = "s3-compatible";
  private client: S3Client | null = null;

  private credentials() {
    const bucket = env("STORAGE_S3_BUCKET");
    const region = env("STORAGE_S3_REGION") ?? "auto";
    const accessKeyId = env("STORAGE_S3_ACCESS_KEY_ID");
    const secretAccessKey = env("STORAGE_S3_SECRET_ACCESS_KEY");
    const endpoint = env("STORAGE_S3_ENDPOINT");
    const publicBaseUrl = env("STORAGE_PUBLIC_BASE_URL");
    if (!bucket || !accessKeyId || !secretAccessKey) return null;
    return { bucket, region, accessKeyId, secretAccessKey, endpoint, publicBaseUrl, forcePathStyle: env("STORAGE_S3_FORCE_PATH_STYLE") === "true" };
  }

  isConfigured() {
    return this.credentials() !== null;
  }

  private getClient(credentials: NonNullable<ReturnType<S3CompatibleStorageAdapter["credentials"]>>) {
    if (!this.client) {
      this.client = new S3Client({
        region: credentials.region,
        endpoint: credentials.endpoint,
        forcePathStyle: credentials.forcePathStyle,
        credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
      });
    }
    return this.client;
  }

  private requireCredentials() {
    const credentials = this.credentials();
    if (!credentials) throw new Error("The S3-compatible storage adapter is not configured. Set STORAGE_S3_BUCKET/STORAGE_S3_ACCESS_KEY_ID/STORAGE_S3_SECRET_ACCESS_KEY.");
    return credentials;
  }

  async putObject(input: PutObjectInput) {
    const credentials = this.requireCredentials();
    const client = this.getClient(credentials);
    await client.send(new PutObjectCommand({
      Bucket: credentials.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      ACL: input.classification === "PUBLIC" ? "public-read" : "private",
    }));
    return { key: input.key };
  }

  async getObject(key: string): Promise<StoredObjectPayload | null> {
    const credentials = this.requireCredentials();
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

  async deleteObject(key: string) {
    const credentials = this.requireCredentials();
    const client = this.getClient(credentials);
    await client.send(new DeleteObjectCommand({ Bucket: credentials.bucket, Key: key }));
  }

  getPublicUrl(key: string): string | null {
    const credentials = this.credentials();
    if (!credentials) return null;
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    if (credentials.publicBaseUrl) return `${credentials.publicBaseUrl.replace(/\/$/, "")}/${encodedKey}`;
    if (credentials.endpoint) {
      const base = credentials.forcePathStyle ? `${credentials.endpoint.replace(/\/$/, "")}/${credentials.bucket}` : credentials.endpoint.replace("://", `://${credentials.bucket}.`);
      return `${base.replace(/\/$/, "")}/${encodedKey}`;
    }
    return `https://${credentials.bucket}.s3.${credentials.region}.amazonaws.com/${encodedKey}`;
  }

  async getSignedUrl(key: string, options?: SignedUrlOptions) {
    const credentials = this.requireCredentials();
    const client = this.getClient(credentials);
    const command = new GetObjectCommand({
      Bucket: credentials.bucket,
      Key: key,
      ...(options?.fileName ? { ResponseContentDisposition: `attachment; filename="${options.fileName}"` } : {}),
    });
    return presign(client, command, { expiresIn: options?.expiresInSeconds ?? 300 });
  }
}
