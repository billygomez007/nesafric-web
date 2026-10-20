import { db } from "@/platform/database/client";
import { getObjectStorageAdapter } from "@/platform/storage";
import { expireLapsedFlowDrafts } from "@/modules/whatsapp-assistant/business/drafts";

/**
 * Storage cleanup, separate from image sanitising (which happens on upload). Removes stored
 * files of public photo and logo uploads that nothing references any more:
 *
 * - LISTING_MEDIA: no listing photo row has the file's storage key;
 * - PROVIDER_PORTFOLIO_IMAGE: no portfolio image row points at the stored object;
 * - logos (organisation, professional, provider): archived (replaced or removed) and not the
 *   current logo of any record (professionals reference their logo by URL, which ends with the
 *   storage key).
 *
 * Only files older than the grace period are considered, so an upload whose database work is
 * still committing is never touched. A file still referenced is never deleted: the reference
 * check runs in the same statement that selects candidates. Each cleaned row is marked so it is
 * not processed twice; the row itself stays for the audit trail.
 */
export const UPLOAD_CLEANUP_GRACE_MS = 24 * 60 * 60_000;

type Candidate = { id: string; storageKey: string; classification: "PUBLIC" | "PRIVATE" };

export async function findAbandonedUploads(now = new Date(), limit = 200): Promise<Candidate[]> {
  const before = new Date(now.getTime() - UPLOAD_CLEANUP_GRACE_MS);
  return db.$queryRaw<Candidate[]>`
    SELECT so."id", so."storageKey", so."classification"::text AS "classification"
    FROM "StorageObject" so
    WHERE so."createdAt" < ${before}
      AND (so."metadata" IS NULL OR NOT (so."metadata" ? 'storageDeletedAt'))
      AND (
        (so."targetType" = 'LISTING_MEDIA'
          AND NOT EXISTS (SELECT 1 FROM "ListingMedia" lm WHERE lm."storageKey" = so."storageKey"))
        OR (so."targetType" = 'PROVIDER_PORTFOLIO_IMAGE'
          AND NOT EXISTS (SELECT 1 FROM "ProviderPortfolioImage" pi WHERE pi."storageObjectId" = so."id"))
        OR (so."targetType" IN ('ORGANISATION_LOGO', 'MARKETPLACE_PROFESSIONAL_LOGO', 'SERVICE_PROVIDER_LOGO')
          AND so."archivedAt" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Organisation" o WHERE o."logoStorageObjectId" = so."id")
          AND NOT EXISTS (SELECT 1 FROM "ServiceProvider" sp WHERE sp."logoStorageObjectId" = so."id")
          AND NOT EXISTS (SELECT 1 FROM "MarketplaceProfessional" mp WHERE mp."logoUrl" LIKE '%' || so."storageKey"))
      )
    ORDER BY so."createdAt"
    LIMIT ${limit}`;
}

export async function cleanupAbandonedUploads(now = new Date(), limit = 200) {
  const adapter = getObjectStorageAdapter();
  let deleted = 0;
  for (const candidate of await findAbandonedUploads(now, limit)) {
    await adapter.deleteObject(candidate.storageKey, candidate.classification).catch(() => undefined);
    await db.$executeRaw`
      UPDATE "StorageObject"
      SET "archivedAt" = COALESCE("archivedAt", ${now}),
          "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object('storageDeletedAt', ${now.toISOString()}::text)
      WHERE "id" = ${candidate.id}::uuid`;
    deleted += 1;
  }
  return { deleted };
}

/** The daily maintenance job: lapsed WhatsApp drafts expire and abandoned uploads are removed. */
export async function runUploadAndDraftCleanup(now = new Date()) {
  const expiredDrafts = await expireLapsedFlowDrafts(now);
  const uploads = await cleanupAbandonedUploads(now);
  return { expiredDrafts, deletedUploads: uploads.deleted };
}

/** Queues the cleanup once per day (idempotent; safe to call on every worker tick). */
export async function scheduleUploadAndDraftCleanup(now = new Date()) {
  const key = `upload-and-draft-cleanup:${now.toISOString().slice(0, 10)}`;
  await db.backgroundJob.upsert({ where: { idempotencyKey: key }, update: {}, create: { type: "upload-and-draft-cleanup", idempotencyKey: key, payload: {}, maxAttempts: 3 } });
}
