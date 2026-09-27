import type { Prisma } from "@/platform/database/generated/client";
import { buildInternalPublicMediaUrl, getObjectStorageAdapter } from "@/platform/storage";

/**
 * A service provider's public logo / profile image. The only source of truth is
 * `ServiceProvider.logoStorageObjectId`, pointing at a PUBLIC `StorageObject` uploaded through the
 * shared controlled-upload pipeline (content sniffing, malware scan, storage adapter). There is no
 * free-form URL field: public payloads derive the URL from the stored object and stop rendering it
 * as soon as that object is archived.
 */
export const SERVICE_PROVIDER_LOGO_TARGET = "SERVICE_PROVIDER_LOGO";

/** The render URL for a provider logo — only for a PUBLIC, non-archived stored object, and
 * nothing else about the object (no id, key, bucket or classification). */
export function providerLogoView(logo: { storageKey: string; classification: string; archivedAt: Date | null } | null) {
  if (!logo || logo.classification !== "PUBLIC" || logo.archivedAt) return null;
  return { url: getObjectStorageAdapter().getPublicUrl(logo.storageKey) ?? buildInternalPublicMediaUrl(logo.storageKey) };
}

/** Archives every active logo object for a provider except `keepStorageObjectId` (bytes are kept). */
export async function archivePreviousProviderLogos(
  tx: Prisma.TransactionClient,
  providerId: string,
  actorUserId: string,
  reason: string,
  keepStorageObjectId?: string,
) {
  const previous = await tx.storageObject.findMany({
    where: {
      targetType: SERVICE_PROVIDER_LOGO_TARGET,
      targetId: providerId,
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

/** Removes the provider's logo. Returns whether a logo was present. */
export async function clearServiceProviderLogo(tx: Prisma.TransactionClient, providerId: string, actorUserId: string) {
  const provider = await tx.serviceProvider.findUniqueOrThrow({ where: { id: providerId }, select: { logoStorageObjectId: true, companyOrganisationId: true } });
  const archived = await archivePreviousProviderLogos(tx, providerId, actorUserId, "Logo removed.");
  if (!provider.logoStorageObjectId && archived === 0) return false;
  await tx.serviceProvider.update({ where: { id: providerId }, data: { logoStorageObjectId: null } });
  if (provider.companyOrganisationId) {
    await tx.auditEvent.create({
      data: {
        organisationId: provider.companyOrganisationId,
        actorUserId,
        action: "provider.logo_removed",
        entityType: "service_provider",
        entityId: providerId,
        metadata: { archivedObjects: archived },
      },
    });
  }
  return true;
}
