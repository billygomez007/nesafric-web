import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";
import { AppError, forbidden, notFound } from "@/platform/errors";
import { ownsProvider } from "@/modules/providers/service";
import { PLATFORM_PERMISSIONS, platformRoleHasPermission } from "@/platform/platform-admin/permissions";
import { requireMarketplaceRole } from "@/modules/marketplace-professionals/permissions";
import { archivePreviousLogos, LOGO_MIME_TYPES } from "@/modules/marketplace-professionals/logo";
import { archivePreviousProviderLogos } from "@/modules/providers/logo";
import { DOCUMENT_MIME_TYPES, IMAGE_MIME_TYPES, VIDEO_MIME_TYPES, getObjectStorageAdapter, buildInternalPublicMediaUrl } from "@/platform/storage";
import type { z } from "zod";
import { MAX_LISTING_PHOTOS } from "@/lib/listing-media-rules";
import { ensureListingCover, lockListingMedia } from "@/modules/listings/cover";
import type { uploadDocumentSchema } from "./schemas";

type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;

async function membership(userId: string, organisationId: string) {
  return db.organisationMember.findFirst({
    where: { userId, organisationId, status: "ACTIVE", archivedAt: null },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
}

async function hasPermission(userId: string, organisationId: string, permission: string) {
  const member = await membership(userId, organisationId);
  return member ? membershipHasPermission(member.roles, permission) : false;
}

export type ResolvedAuthorization = { organisationId: string | null };

export type AttachContext = {
  targetId: string;
  storageObject: { id: string; storageKey: string };
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  uploadedByUserId: string;
  input: UploadDocumentInput;
};

export type UploadTargetDescriptor = {
  allowedMimeTypes: readonly string[];
  allowedClassifications: readonly ("PRIVATE" | "PUBLIC")[];
  /** Validates auth/org/RBAC/target existence. Returns the organisationId to stamp on the StorageObject (may differ from the caller's header, e.g. an individually-owned provider has none). */
  authorize(tx: Tx, ctx: { userId: string; organisationId: string | null; targetId: string; input: UploadDocumentInput }): Promise<ResolvedAuthorization>;
  /** Creates (or updates) the domain-specific attachment/media record once bytes are safely stored. */
  attach(tx: Tx, ctx: AttachContext): Promise<{ id: string } & Record<string, unknown>>;
};

const targetDescriptors: Record<string, UploadTargetDescriptor> = {
  LISTING_MEDIA: {
    allowedMimeTypes: [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES, "application/pdf"],
    allowedClassifications: ["PRIVATE", "PUBLIC"],
    authorize: async (tx, { userId, organisationId, targetId }) => {
      const listing = await tx.listing.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          organisationId: true,
          marketplaceProfessionalId: true,
        },
      });

      if (!listing) throw notFound();

      if (listing.marketplaceProfessionalId) {
        await requireMarketplaceRole(
          userId,
          listing.marketplaceProfessionalId,
          "AGENT",
        );

        return { organisationId: listing.organisationId };
      }

      if (
        !organisationId ||
        listing.organisationId !== organisationId
      ) {
        throw notFound();
      }

      await requirePermission(
        userId,
        organisationId,
        PERMISSIONS.listingManage,
      );

      return { organisationId };
    },
    attach: async (tx, { targetId, storageObject, contentType, sizeBytes, checksum, input }) => {
      const mediaType = input.mediaType ?? "PHOTO";
      const isPublic = input.classification === "PUBLIC";
      const adapter = getObjectStorageAdapter();
      const publicUrl = isPublic ? (adapter.getPublicUrl(storageObject.storageKey) ?? buildInternalPublicMediaUrl(storageObject.storageKey)) : "private:pending-signed-url";
      // Under the listing lock: the photo limit and the cover can't be raced by parallel uploads.
      await lockListingMedia(tx, targetId);
      if (await tx.listingMedia.count({ where: { listingId: targetId } }) >= MAX_LISTING_PHOTOS) {
        throw new AppError("LISTING_MEDIA_LIMIT_REACHED", 422, `A property listing can contain up to ${MAX_LISTING_PHOTOS} images.`);
      }
      const highestSortOrder = await tx.listingMedia.aggregate({ where: { listingId: targetId }, _max: { sortOrder: true } });
      const created = await tx.listingMedia.create({
        data: {
          listingId: targetId,
          type: mediaType,
          publicUrl,
          storageKey: storageObject.storageKey,
          classification: input.classification,
          mimeType: contentType,
          title: input.title ?? null,
          altText: input.altText ?? null,
          sortOrder: (highestSortOrder._max.sortOrder ?? -1) + 1,
          fileSizeBytes: sizeBytes,
          checksum,
          isCover: false,
        },
      });
      // The first photo becomes the cover; later uploads keep the cover the professional chose.
      const coverId = await ensureListingCover(tx, targetId);
      return coverId === created.id ? { ...created, isCover: true } : created;
    },
  },

  MAINTENANCE_ATTACHMENT: {
    allowedMimeTypes: DOCUMENT_MIME_TYPES,
    allowedClassifications: ["PRIVATE"],
    authorize: async (tx, { userId, organisationId, targetId }) => {
      if (!organisationId) throw forbidden();
      const request = await tx.maintenanceRequest.findFirst({ where: { id: targetId, organisationId } });
      if (!request) throw notFound();
      const internal = await hasPermission(userId, organisationId, PERMISSIONS.maintenanceManage) || await hasPermission(userId, organisationId, PERMISSIONS.maintenanceCreate);
      if (!internal) {
        const tenant = request.tenantOrganisationId
          ? await tx.tenantOrganisation.findFirst({ where: { id: request.tenantOrganisationId, organisationId, userId, archivedAt: null } })
          : null;
        if (!tenant) throw forbidden();
      }
      return { organisationId };
    },
    attach: (tx, { targetId, storageObject, fileName, contentType, sizeBytes }) =>
      tx.maintenanceAttachment.create({
        data: { maintenanceRequestId: targetId, fileKey: storageObject.storageKey, fileName, contentType, sizeBytes },
      }),
  },

  MOVE_IN_INSPECTION_MEDIA: {
    allowedMimeTypes: [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES],
    allowedClassifications: ["PRIVATE"],
    authorize: async (tx, { userId, organisationId, targetId }) => {
      if (!organisationId) throw forbidden();
      await requirePermission(userId, organisationId, PERMISSIONS.moveInManage);
      const inspection = await tx.moveInInspection.findFirst({ where: { id: targetId, moveIn: { organisationId } } });
      if (!inspection) throw notFound();
      return { organisationId };
    },
    attach: async (tx, { targetId, storageObject, fileName, contentType, input }) => {
      const area = await tx.moveInInspectionArea.findFirst({ where: { id: input.areaId, inspectionId: targetId } });
      if (!area) throw new AppError("INVALID_INSPECTION_AREA", 422, "The inspection area does not belong to this inspection.");
      const existing = Array.isArray(area.media) ? (area.media as unknown[]) : [];
      const entry = { storageObjectId: storageObject.id, storageKey: storageObject.storageKey, fileName, contentType };
      const updated = await tx.moveInInspectionArea.update({ where: { id: area.id }, data: { media: json([...existing, entry]) } });
      return { id: storageObject.id, areaId: updated.id, media: updated.media };
    },
  },

  /**
   * Move-out inspection evidence is captured differently from move-in: Phase 12 makes a
   * `MoveOutInspectionArea` permanently immutable (a DB trigger) the instant its parent
   * inspection is completed, and `createMoveOutInspection` always completes atomically at
   * creation — there is no window to attach media to an area afterwards. So this target is
   * scoped to the `MoveOut` record itself: it validates, scans, and stores the file (exactly
   * like every other upload) and returns its storage key with nothing more attached yet; the
   * caller then passes that key into `createMoveOutInspection`'s existing `area.media` field,
   * which is created together with the immutable area in one atomic, already-tested step.
   */
  MOVE_OUT_INSPECTION_MEDIA: {
    allowedMimeTypes: [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES],
    allowedClassifications: ["PRIVATE"],
    authorize: async (tx, { userId, organisationId, targetId }) => {
      if (!organisationId) throw forbidden();
      await requirePermission(userId, organisationId, PERMISSIONS.moveOutManage);
      const moveOut = await tx.moveOut.findFirst({ where: { id: targetId, organisationId } });
      if (!moveOut) throw notFound();
      return { organisationId };
    },
    attach: async (tx, { storageObject }) => {
      const storageObjectRow = await tx.storageObject.findUniqueOrThrow({ where: { id: storageObject.id } });
      return { id: storageObjectRow.id, storageKey: storageObjectRow.storageKey };
    },
  },

  APPLICATION_DOCUMENT: {
    allowedMimeTypes: DOCUMENT_MIME_TYPES,
    allowedClassifications: ["PRIVATE"],
    authorize: async (tx, { userId, organisationId, targetId }) => {
      if (!organisationId) throw forbidden();
      const application = await tx.rentalApplication.findFirst({ where: { id: targetId, organisationId } });
      if (!application) throw notFound();
      const internal = await hasPermission(userId, organisationId, PERMISSIONS.applicationCreate) || await hasPermission(userId, organisationId, PERMISSIONS.applicationReview);
      if (!internal) throw forbidden();
      return { organisationId };
    },
    attach: (tx, { targetId, storageObject, fileName, contentType, sizeBytes, checksum, uploadedByUserId, input }) =>
      tx.rentalApplicationDocument.create({
        data: {
          applicationId: targetId,
          uploadedByUserId,
          type: input.documentType ?? "OTHER",
          storageKey: storageObject.storageKey,
          fileName,
          contentType,
          sizeBytes,
          checksum,
        },
      }),
  },

  PROVIDER_EVIDENCE: {
    allowedMimeTypes: DOCUMENT_MIME_TYPES,
    allowedClassifications: ["PRIVATE"],
    authorize: async (tx, { userId, targetId }) => {
      const provider = await ownsProvider(userId, targetId, tx);
      if (!provider) throw forbidden();
      return { organisationId: provider.companyOrganisationId };
    },
    attach: (tx, { targetId, storageObject, uploadedByUserId, input }) =>
      tx.providerEvidence.upsert({
        where: { providerId_type_reference: { providerId: targetId, type: input.evidenceType ?? "OTHER", reference: storageObject.storageKey } },
        update: { expiresAt: input.evidenceExpiresAt },
        create: { providerId: targetId, type: input.evidenceType ?? "OTHER", reference: storageObject.storageKey, expiresAt: input.evidenceExpiresAt, submittedByUserId: uploadedByUserId },
      }),
  },

  /** Campaign promotional creative (Phase 24) — `targetId` is a `Campaign.id`. Platform-admin
   * only (checked directly against `PlatformPrincipal`, mirroring `PROVIDER_EVIDENCE`'s pattern,
   * since this framework's `authorize` only has a userId, not the full authenticated `User`).
   * Always PUBLIC: campaign creative is meant to be shown to every visitor, never signed/private. */
  ORGANISATION_LOGO: {
    allowedMimeTypes: IMAGE_MIME_TYPES,
    allowedClassifications: ["PUBLIC"],
    authorize: async (tx, { userId, organisationId, targetId }) => {
      if (!organisationId || organisationId !== targetId) throw forbidden();

      await requirePermission(
        userId,
        organisationId,
        PERMISSIONS.organisationManageMembers,
      );

      const organisation = await tx.organisation.findFirst({
        where: {
          id: targetId,
          archivedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (!organisation) throw notFound();

      return { organisationId };
    },
    attach: async (tx, { targetId, storageObject }) => {
      const adapter = getObjectStorageAdapter();
      const publicUrl =
        adapter.getPublicUrl(storageObject.storageKey) ??
        buildInternalPublicMediaUrl(storageObject.storageKey);

      return tx.organisation.update({
        where: { id: targetId },
        data: {
          logoUrl: publicUrl,
          logoStorageObjectId: storageObject.id,
        },
        select: {
          id: true,
          name: true,
          logoUrl: true,
          logoStorageObjectId: true,
        },
      });
    },
  },

  /** A marketplace company's logo. Two separately-authorized callers reach this target: the
   * business itself (OWNER/ADMIN membership, via `uploadMarketplaceProfessionalLogo`) and a
   * platform admin (via `uploadMarketplaceProfessionalLogoAsPlatform`). Each entry point enforces
   * its own path before uploading; this check re-verifies inside the transaction that the actor is
   * one of the two. Always PUBLIC, and always written to `MarketplaceProfessional.logoUrl` — the
   * only logo record — so the homepage rail picks it up without being re-added. */
  MARKETPLACE_PROFESSIONAL_LOGO: {
    allowedMimeTypes: LOGO_MIME_TYPES,
    allowedClassifications: ["PUBLIC"],
    authorize: async (tx, { userId, targetId }) => {
      const professional = await tx.marketplaceProfessional.findFirst({ where: { id: targetId, archivedAt: null }, select: { backingOrganisationId: true } });
      if (!professional) throw notFound();
      const member = await tx.marketplaceProfessionalMember.findUnique({ where: { marketplaceProfessionalId_userId: { marketplaceProfessionalId: targetId, userId } } });
      const isBusinessAdmin = member?.status === "ACTIVE" && (member.role === "OWNER" || member.role === "ADMIN");
      if (!isBusinessAdmin) {
        const principal = await tx.platformPrincipal.findUnique({ where: { userId } });
        if (!principal || principal.status !== "ACTIVE" || !platformRoleHasPermission(principal.role, PLATFORM_PERMISSIONS.marketplaceVerify)) throw forbidden();
      }
      return { organisationId: professional.backingOrganisationId };
    },
    attach: async (tx, { targetId, storageObject, uploadedByUserId }) => {
      const adapter = getObjectStorageAdapter();
      const publicUrl = adapter.getPublicUrl(storageObject.storageKey) ?? buildInternalPublicMediaUrl(storageObject.storageKey);
      const replaced = await archivePreviousLogos(tx, targetId, uploadedByUserId, "Replaced by a new logo.", storageObject.id);
      const professional = await tx.marketplaceProfessional.update({
        where: { id: targetId },
        data: { logoUrl: publicUrl },
        select: { id: true, displayName: true, logoUrl: true, backingOrganisationId: true },
      });
      await tx.auditEvent.create({
        data: {
          organisationId: professional.backingOrganisationId,
          actorUserId: uploadedByUserId,
          action: "marketplace_professional.logo_updated",
          entityType: "marketplace_professional",
          entityId: targetId,
          metadata: { storageObjectId: storageObject.id, replacedObjects: replaced },
        },
      });
      return { id: professional.id, displayName: professional.displayName, logoUrl: professional.logoUrl };
    },
  },

  /** A service provider's public logo / profile image — `targetId` is a `ServiceProvider.id`. Only
   * the provider's owner (individual, administrator, or company owner/administrator — the same
   * `ownsProvider` rule as verification evidence) may upload. Always PUBLIC; the previous logo is
   * archived so only one is ever current. */
  SERVICE_PROVIDER_LOGO: {
    allowedMimeTypes: LOGO_MIME_TYPES,
    allowedClassifications: ["PUBLIC"],
    authorize: async (tx, { userId, targetId }) => {
      const provider = await ownsProvider(userId, targetId, tx);
      if (!provider) throw forbidden();
      return { organisationId: provider.companyOrganisationId };
    },
    attach: async (tx, { targetId, storageObject, uploadedByUserId }) => {
      const replaced = await archivePreviousProviderLogos(tx, targetId, uploadedByUserId, "Replaced by a new logo.", storageObject.id);
      const provider = await tx.serviceProvider.update({
        where: { id: targetId },
        data: { logoStorageObjectId: storageObject.id },
        select: { id: true, displayName: true, companyOrganisationId: true },
      });
      if (provider.companyOrganisationId) {
        await tx.auditEvent.create({
          data: {
            organisationId: provider.companyOrganisationId,
            actorUserId: uploadedByUserId,
            action: "provider.logo_updated",
            entityType: "service_provider",
            entityId: targetId,
            metadata: { storageObjectId: storageObject.id, replacedObjects: replaced },
          },
        });
      }
      const adapter = getObjectStorageAdapter();
      return { id: provider.id, displayName: provider.displayName, logoUrl: adapter.getPublicUrl(storageObject.storageKey) ?? buildInternalPublicMediaUrl(storageObject.storageKey) };
    },
  },

  CAMPAIGN_CREATIVE: {
    allowedMimeTypes: IMAGE_MIME_TYPES,
    allowedClassifications: ["PUBLIC"],
    authorize: async (tx, { userId, targetId }) => {
      const campaign = await tx.campaign.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!campaign) throw notFound();
      const principal = await tx.platformPrincipal.findUnique({ where: { userId } });
      if (!principal || principal.status !== "ACTIVE" || !platformRoleHasPermission(principal.role, PLATFORM_PERMISSIONS.campaignReview)) throw forbidden();
      return { organisationId: null };
    },
    attach: (tx, { targetId, storageObject, input }) => {
      const adapter = getObjectStorageAdapter();
      const publicUrl = adapter.getPublicUrl(storageObject.storageKey) ?? buildInternalPublicMediaUrl(storageObject.storageKey);
      const field =
        input.mediaSlot === "nativeApp"
          ? "nativeAppMediaUrl"
          : input.mediaSlot === "mobile"
            ? "mobileMediaUrl"
            : "desktopMediaUrl";
      return tx.campaign.update({ where: { id: targetId }, data: { [field]: publicUrl } });
    },
  },
};

export function getUploadDescriptor(targetType: string): UploadTargetDescriptor {
  const descriptor = targetDescriptors[targetType];
  if (!descriptor) throw new AppError("UNKNOWN_UPLOAD_TARGET", 400, `'${targetType}' is not a supported upload target.`);
  return descriptor;
}
