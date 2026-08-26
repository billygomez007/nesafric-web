import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";
import { AppError, forbidden, notFound } from "@/platform/errors";
import { ownsProvider } from "@/modules/providers/service";
import { DOCUMENT_MIME_TYPES, IMAGE_MIME_TYPES, VIDEO_MIME_TYPES, getObjectStorageAdapter, buildInternalPublicMediaUrl } from "@/platform/storage";
import type { z } from "zod";
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
      if (!organisationId) throw forbidden();
      await requirePermission(userId, organisationId, PERMISSIONS.listingManage);
      const listing = await tx.listing.findFirst({ where: { id: targetId, organisationId } });
      if (!listing) throw notFound();
      return { organisationId };
    },
    attach: async (tx, { targetId, storageObject, contentType, sizeBytes, checksum, input }) => {
      const mediaType = input.mediaType ?? "PHOTO";
      const isPublic = input.classification === "PUBLIC";
      const adapter = getObjectStorageAdapter();
      const publicUrl = isPublic ? (adapter.getPublicUrl(storageObject.storageKey) ?? buildInternalPublicMediaUrl(storageObject.storageKey)) : "private:pending-signed-url";
      const highestSortOrder = await tx.listingMedia.aggregate({ where: { listingId: targetId }, _max: { sortOrder: true } });
      return tx.listingMedia.create({
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
        },
      });
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
};

export function getUploadDescriptor(targetType: string): UploadTargetDescriptor {
  const descriptor = targetDescriptors[targetType];
  if (!descriptor) throw new AppError("UNKNOWN_UPLOAD_TARGET", 400, `'${targetType}' is not a supported upload target.`);
  return descriptor;
}
