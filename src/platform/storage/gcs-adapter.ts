import { Storage } from "@google-cloud/storage";
import { AppError } from "@/platform/errors";
import type {
  ObjectStorageAdapter,
  PutObjectInput,
  SignedUrlOptions,
  StorageClassificationValue,
  StoredObjectPayload,
} from "./types";

function env(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

type InlineServiceAccount = {
  client_email?: string;
  private_key?: string;
};

function inlineCredentials() {
  const raw = env("GOOGLE_SERVICE_ACCOUNT_JSON");

  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as InlineServiceAccount;

    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("Incomplete service account credentials.");
    }

    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    throw new AppError(
      "GCS_CREDENTIALS_INVALID",
      503,
      "Google Cloud Storage credentials are not configured correctly.",
    );
  }
}

/**
 * Native Google Cloud Storage implementation of the provider-neutral
 * NesAfric object-storage contract.
 *
 * PRIVATE and PUBLIC classifications are always mapped to physically
 * separate buckets. Classification is never inferred from an object key.
 *
 * Authentication:
 * - Local development: Google Application Default Credentials.
 * - Hosted environments: GOOGLE_SERVICE_ACCOUNT_JSON when explicitly
 *   configured, or another ADC-compatible workload identity.
 *
 * Public Access Prevention may remain enabled on the PUBLIC/media bucket.
 * In that configuration getPublicUrl() returns null unless an explicit
 * STORAGE_PUBLIC_BASE_URL has been configured, allowing NesAfric's
 * authenticated/internal public-media streaming route to serve the file.
 */
export class GoogleCloudStorageAdapter implements ObjectStorageAdapter {
  readonly providerKey = "gcs";

  private storage: Storage | null = null;

  private projectId() {
    return (
      env("STORAGE_GCS_PROJECT_ID") ??
      env("GOOGLE_CLOUD_PROJECT") ??
      env("GCLOUD_PROJECT")
    );
  }

  private bucketName(classification: StorageClassificationValue) {
    return classification === "PRIVATE"
      ? env("STORAGE_GCS_PRIVATE_BUCKET")
      : env("STORAGE_GCS_PUBLIC_BUCKET");
  }

  private getStorage() {
    if (this.storage) return this.storage;

    const projectId = this.projectId();
    const credentials = inlineCredentials();

    this.storage = new Storage({
      ...(projectId ? { projectId } : {}),
      ...(credentials ? { credentials } : {}),
    });

    return this.storage;
  }

  isPrivateConfigured() {
    return Boolean(this.bucketName("PRIVATE"));
  }

  isPublicConfigured() {
    return Boolean(this.bucketName("PUBLIC"));
  }

  isConfigured() {
    return this.isPrivateConfigured() || this.isPublicConfigured();
  }

  private requireBucket(classification: StorageClassificationValue) {
    const bucketName = this.bucketName(classification);

    if (!bucketName) {
      throw new AppError(
        classification === "PRIVATE"
          ? "STORAGE_PRIVATE_NOT_CONFIGURED"
          : "STORAGE_PUBLIC_NOT_CONFIGURED",
        503,
        `${
          classification === "PRIVATE" ? "Private" : "Public"
        } file storage is not yet configured for this deployment. Please try again shortly, or contact support if this persists.`,
      );
    }

    return this.getStorage().bucket(bucketName);
  }

  async putObject(input: PutObjectInput) {
    const bucket = this.requireBucket(input.classification);

    const file = bucket.file(input.key);

    await file.save(input.body, {
      resumable: false,
      contentType: input.contentType,
      metadata: {
        cacheControl:
          input.classification === "PUBLIC"
            ? "private, max-age=3600"
            : "private, no-store",
      },
    });

    return { key: input.key };
  }

  async getObject(
    key: string,
    classification: StorageClassificationValue,
  ): Promise<StoredObjectPayload | null> {
    const file = this.requireBucket(classification).file(key);

    try {
      const [body] = await file.download();
      const [metadata] = await file.getMetadata();

      return {
        body,
        contentType: metadata.contentType ?? "application/octet-stream",
      };
    } catch (error) {
      const candidate = error as {
        code?: number | string;
      };

      if (candidate.code === 404 || candidate.code === "404") {
        return null;
      }

      throw error;
    }
  }

  async deleteObject(
    key: string,
    classification: StorageClassificationValue,
  ): Promise<void> {
    const file = this.requireBucket(classification).file(key);

    await file.delete({
      ignoreNotFound: true,
    });
  }

  getPublicUrl(key: string): string | null {
    if (!this.isPublicConfigured()) {
      return null;
    }

    const baseUrl = env("STORAGE_PUBLIC_BASE_URL");

    if (!baseUrl) {
      return null;
    }

    const encodedKey = key.split("/").map(encodeURIComponent).join("/");

    return `${baseUrl.replace(/\/$/, "")}/${encodedKey}`;
  }

  async getSignedUrl(
    key: string,
    classification: StorageClassificationValue,
    options?: SignedUrlOptions,
  ): Promise<string> {
    const file = this.requireBucket(classification).file(key);

    const expiresInSeconds = options?.expiresInSeconds ?? 300;

    const safeFileName = options?.fileName
      ?.replaceAll('"', "")
      .replaceAll("\r", "")
      .replaceAll("\n", "");

    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + expiresInSeconds * 1000,
      ...(safeFileName
        ? {
            responseDisposition: `attachment; filename="${safeFileName}"`,
          }
        : {}),
    });

    return url;
  }
}
