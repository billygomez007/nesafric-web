import type { Prisma } from "@/platform/database/generated/client";

/**
 * The company logo has exactly one source of truth: `MarketplaceProfessional.logoUrl`. Uploaded
 * bytes live in the shared object storage as a PUBLIC `StorageObject` whose target is the
 * professional; the homepage rail, public profile and directory all read `logoUrl` directly, so a
 * new logo shows everywhere on the next fetch without anything being re-added.
 */
export const MARKETPLACE_PROFESSIONAL_LOGO_TARGET = "MARKETPLACE_PROFESSIONAL_LOGO";

/** Browser-renderable raster formats only (no HEIC). */
export const LOGO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** Logos are small; this keeps uploads well under serverless request-body limits. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Archives every active logo object for a professional except `keepStorageObjectId`. Bytes are
 * never deleted here — archiving just stops the object being served or listed as current. */
export async function archivePreviousLogos(
  tx: Prisma.TransactionClient,
  marketplaceProfessionalId: string,
  actorUserId: string,
  reason: string,
  keepStorageObjectId?: string,
) {
  const previous = await tx.storageObject.findMany({
    where: {
      targetType: MARKETPLACE_PROFESSIONAL_LOGO_TARGET,
      targetId: marketplaceProfessionalId,
      archivedAt: null,
      ...(keepStorageObjectId ? { id: { not: keepStorageObjectId } } : {}),
    },
    select: { id: true },
  });
  for (const { id } of previous) {
    await tx.storageObject.update({ where: { id }, data: { archivedAt: new Date(), archivedByUserId: actorUserId, archiveReason: reason } });
    await tx.storageObjectHistory.create({ data: { storageObjectId: id, actorUserId, action: "ARCHIVED", reason } });
  }
  return previous.length;
}

/** Removes the logo: clears `logoUrl`, archives the stored object(s) and records the removal in
 * the professional's own audit trail with the acting user. Returns whether a logo was present. */
export async function clearMarketplaceProfessionalLogo(
  tx: Prisma.TransactionClient,
  professional: { id: string; backingOrganisationId: string; logoUrl: string | null },
  actorUserId: string,
) {
  const archived = await archivePreviousLogos(tx, professional.id, actorUserId, "Logo removed.");
  if (!professional.logoUrl && archived === 0) return false;
  await tx.marketplaceProfessional.update({ where: { id: professional.id }, data: { logoUrl: null } });
  await tx.auditEvent.create({
    data: {
      organisationId: professional.backingOrganisationId,
      actorUserId,
      action: "marketplace_professional.logo_removed",
      entityType: "marketplace_professional",
      entityId: professional.id,
      metadata: { previousLogoUrl: professional.logoUrl, archivedObjects: archived },
    },
  });
  return true;
}
