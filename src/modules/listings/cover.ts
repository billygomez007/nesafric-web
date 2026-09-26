import type { Prisma } from "@/platform/database/generated/client";

type Tx = Prisma.TransactionClient;

/**
 * Serialises every change to one listing's photos — upload, remove, set cover, reorder — by
 * locking the listing row for the rest of the transaction. Without it two concurrent first
 * uploads could both see "no photos yet" and both become the cover.
 */
export async function lockListingMedia(tx: Tx, listingId: string) {
  await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${listingId}::uuid FOR UPDATE`;
}

/**
 * The single-cover invariant: a listing with photos has exactly one cover, and it is a PHOTO; a
 * listing without photos has none. A valid existing cover is kept; otherwise the first photo in
 * gallery order (sortOrder, then upload time) becomes the cover — deterministic, never random.
 * Call it inside a transaction that already holds `lockListingMedia`. Returns the cover id.
 */
export async function ensureListingCover(tx: Tx, listingId: string) {
  const media = await tx.listingMedia.findMany({
    where: { listingId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, type: true, isCover: true },
  });
  const photos = media.filter((item) => item.type === "PHOTO");
  const cover = photos.find((item) => item.isCover) ?? photos[0] ?? null;
  for (const item of media) {
    const shouldBeCover = item.id === cover?.id;
    if (item.isCover !== shouldBeCover) {
      await tx.listingMedia.update({ where: { id: item.id }, data: { isCover: shouldBeCover } });
    }
  }
  return cover?.id ?? null;
}
