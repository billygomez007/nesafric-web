import { Prisma } from "@/platform/database/generated/client";
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
 * Every other upload type is never a candidate: provider evidence, application documents,
 * maintenance attachments, inspection media, campaign creative and generated documents are kept
 * by this job whatever their state (an allowlist, not a denylist).
 *
 * Only files older than the grace period are considered, so an upload whose database work is
 * still committing is never touched. Each cleaned row is marked and kept for the audit trail.
 */
export const UPLOAD_CLEANUP_GRACE_MS = 24 * 60 * 60_000;
export const CLEANED_UPLOAD_TARGETS = ["LISTING_MEDIA", "PROVIDER_PORTFOLIO_IMAGE", "ORGANISATION_LOGO", "MARKETPLACE_PROFESSIONAL_LOGO", "SERVICE_PROVIDER_LOGO"] as const;

type Candidate = { id: string; storageKey: string; classification: "PUBLIC" | "PRIVATE" };

/** True for a stored object nothing references (alias `so`). The single definition used both to
 * find candidates and to re-check one under its row lock. */
const unreferenced = Prisma.sql`
  (so."metadata" IS NULL OR NOT (so."metadata" ? 'storageDeletedAt'))
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
  )`;

export async function findAbandonedUploads(now = new Date(), limit = 200): Promise<Candidate[]> {
  const before = new Date(now.getTime() - UPLOAD_CLEANUP_GRACE_MS);
  return db.$queryRaw<Candidate[]>`
    SELECT so."id", so."storageKey", so."classification"::text AS "classification"
    FROM "StorageObject" so
    WHERE so."createdAt" < ${before} AND ${unreferenced}
    ORDER BY so."createdAt"
    LIMIT ${limit}`;
}

/**
 * Each candidate is claimed in its own transaction: the row is locked FOR UPDATE, the reference
 * check runs again under that lock, and the row is marked deleted before the file is removed.
 * A listing write that names the file locks it FOR SHARE first (`assertOwnStorageKeys`), so
 * either the write commits first (the recheck then sees the reference and skips the file) or the
 * mark commits first (the write then refuses the file). A file is deleted only after its mark.
 */
export async function cleanupAbandonedUploads(now = new Date(), limit = 200) {
  const adapter = getObjectStorageAdapter();
  let deleted = 0;
  for (const candidate of await findAbandonedUploads(now, limit)) {
    const claimed = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT so."id" FROM "StorageObject" so WHERE so."id" = ${candidate.id}::uuid FOR UPDATE`;
      if (!locked.length) return false;
      const [check] = await tx.$queryRaw<Array<{ unreferenced: boolean }>>`SELECT (${unreferenced}) AS "unreferenced" FROM "StorageObject" so WHERE so."id" = ${candidate.id}::uuid`;
      if (!check?.unreferenced) return false;
      await tx.$executeRaw`
        UPDATE "StorageObject"
        SET "archivedAt" = COALESCE("archivedAt", ${now}),
            "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object('storageDeletedAt', ${now.toISOString()}::text)
        WHERE "id" = ${candidate.id}::uuid`;
      return true;
    });
    if (!claimed) continue;
    await adapter.deleteObject(candidate.storageKey, candidate.classification).catch(() => undefined);
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
