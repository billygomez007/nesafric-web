import { getPublicListingsByIds } from "@/modules/listings/service";
import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { importSavedListingsSchema, savedListingIdSchema, savedListingsQuerySchema } from "./schemas";

/** Per-user ceiling: keeps the list useful and bounds storage if a client misbehaves. */
export const MAX_SAVED_LISTINGS = 500;

type Tx = Prisma.TransactionClient;

/**
 * Serialises one user's saves and imports (a transaction-scoped Postgres advisory lock keyed on the
 * user id), so the per-user limit holds even when several requests arrive at once. Other users
 * are never blocked.
 */
async function lockUser(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
}

const limitReached = () =>
  new AppError("SAVED_LISTINGS_LIMIT", 422, `You can save up to ${MAX_SAVED_LISTINGS} properties. Remove some to save more.`, { limit: MAX_SAVED_LISTINGS });

/**
 * The user's saved listings, newest first. Each saved listing is re-checked with the public
 * marketplace rules: an eligible one carries its public projection; one that has since been
 * unpublished, unverified, let or withdrawn is reported as unavailable with no listing data.
 */
export async function listSavedListings(userId: string, query: unknown = {}) {
  const { page, pageSize } = savedListingsQuerySchema.parse(query);
  const [total, rows] = await Promise.all([
    db.savedListing.count({ where: { userId } }),
    db.savedListing.findMany({
      where: { userId },
      select: { listingId: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const publicListings = await getPublicListingsByIds(rows.map((row) => row.listingId));
  return {
    items: rows.map((row) => {
      const listing = publicListings.get(row.listingId) ?? null;
      return { listingId: row.listingId, savedAt: row.createdAt, available: listing !== null, listing };
    }),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/** Just the ids, newest first, so a client can show heart states without loading listings. */
export async function listSavedListingIds(userId: string) {
  const rows = await db.savedListing.findMany({ where: { userId }, select: { listingId: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  return { listingIds: rows.map((row) => row.listingId) };
}

/**
 * Saves a listing that is currently public (anything else answers 404, exactly like the public
 * detail route, so hidden listings can't be probed). Saving again is a no-op that returns the
 * original save.
 */
export async function saveListing(userId: string, listingId: unknown) {
  const id = savedListingIdSchema.parse(listingId);
  const existing = await db.savedListing.findUnique({ where: { userId_listingId: { userId, listingId: id } } });
  if (existing) return { listingId: id, savedAt: existing.createdAt, created: false };
  if (!(await getPublicListingsByIds([id])).has(id)) throw notFound();
  return db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    // Re-checked under the lock: a concurrent save of the same listing may have just landed.
    const raced = await tx.savedListing.findUnique({ where: { userId_listingId: { userId, listingId: id } } });
    if (raced) return { listingId: id, savedAt: raced.createdAt, created: false };
    if ((await tx.savedListing.count({ where: { userId } })) >= MAX_SAVED_LISTINGS) throw limitReached();
    const saved = await tx.savedListing.create({ data: { userId, listingId: id } });
    return { listingId: id, savedAt: saved.createdAt, created: true };
  });
}

/** Removes one of the caller's saves. Idempotent, and can only ever touch the caller's rows. */
export async function removeSavedListing(userId: string, listingId: unknown) {
  const id = savedListingIdSchema.parse(listingId);
  await db.savedListing.deleteMany({ where: { userId, listingId: id } });
}

/**
 * Merges a device's saved list into the account: currently public listings not yet saved are
 * added (oldest of the device list first, so the device's newest stays newest), up to the limit.
 * Ineligible, duplicate and already-saved ids are skipped. Safe to repeat.
 */
export async function importSavedListings(userId: string, input: unknown) {
  const { listingIds } = importSavedListingsSchema.parse(input);
  const unique = [...new Set(listingIds)];
  const already = new Set(
    (await db.savedListing.findMany({ where: { userId, listingId: { in: unique } }, select: { listingId: true } })).map((row) => row.listingId),
  );
  const eligible = await getPublicListingsByIds(unique.filter((id) => !already.has(id)));
  return db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    // Under the lock: re-read what is saved now, so concurrent writes can't push past the limit.
    const saved = new Set((await tx.savedListing.findMany({ where: { userId }, select: { listingId: true } })).map((row) => row.listingId));
    const room = Math.max(0, MAX_SAVED_LISTINGS - saved.size);
    // The device list is newest first: give the oldest the earliest timestamp so order is kept.
    const toAdd = unique.filter((id) => eligible.has(id) && !saved.has(id)).slice(0, room).reverse();
    const now = Date.now();
    const { count: imported } = await tx.savedListing.createMany({
      data: toAdd.map((listingId, index) => ({ userId, listingId, createdAt: new Date(now + index) })),
      skipDuplicates: true,
    });
    return { imported, skipped: listingIds.length - imported, total: saved.size + imported };
  });
}
