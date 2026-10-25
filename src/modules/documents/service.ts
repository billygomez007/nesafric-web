import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PlatformPrincipal } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { assertGuardedWorkActive } from "@/platform/database/guarded";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";
import { AppError, forbidden, notFound } from "@/platform/errors";
import { ownsProvider } from "@/modules/providers/service";
import { PLATFORM_PERMISSIONS, platformRoleHasPermission } from "@/platform/platform-admin/permissions";
import {
  getMalwareScanner,
  getObjectStorageAdapter,
  maxUploadBytes,
  safeFileName,
  sniffFileType,
  readImageDimensions,
  buildInternalPublicMediaUrl,
  type StorageClassificationValue,
} from "@/platform/storage";
import { PROCESSED_IMAGE_MIME_TYPES, processUploadedImage } from "@/platform/storage/image-processing";
import { LISTING_PHOTO_MAX_EDGE } from "@/lib/listing-media-rules";
import { formatMegabytes, MAX_LISTING_MEDIA_ITEMS, MAX_LISTING_PHOTOS, MAX_LISTING_PHOTO_UPLOAD_BYTES } from "@/lib/listing-media-rules";
import { ensureListingCover, lockListingMedia } from "@/modules/listings/cover";
import { PLACEMENT_CREATIVE_SPECS, aspectRatioLabel, dimensionMismatch } from "@/modules/campaigns/creative-spec";
import { getUploadDescriptor } from "./targets";
import { isUuid } from "@/platform/validation/uuid";
import { archiveStorageObjectSchema, documentCenterQuerySchema, listingMediaOrderSchema, uploadDocumentSchema } from "./schemas";
import { recordIntegrationOutcome } from "@/modules/integrations/service";
import { assertOperational } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import { requireMarketplaceRole } from "@/modules/marketplace-professionals/permissions";
import { assertWritableMarketplaceProfessional } from "@/modules/marketplace-professionals/entitlements";
import { clearMarketplaceProfessionalLogo, MARKETPLACE_PROFESSIONAL_LOGO_TARGET, MAX_LOGO_BYTES } from "@/modules/marketplace-professionals/logo";
import { clearServiceProviderLogo, SERVICE_PROVIDER_LOGO_TARGET } from "@/modules/providers/logo";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const UPLOAD_TARGET_TYPES = ["LISTING_MEDIA", "MAINTENANCE_ATTACHMENT", "MOVE_IN_INSPECTION_MEDIA", "MOVE_OUT_INSPECTION_MEDIA", "APPLICATION_DOCUMENT", "PROVIDER_EVIDENCE"] as const;
/** Human-readable object-key namespace segment per upload target — purely cosmetic/organisational
 * (bucket browsing, lifecycle/CORS rules scoped by prefix); never read back to resolve a target. */
const UPLOAD_TARGET_NAMESPACES: Record<string, string> = {
  PROVIDER_EVIDENCE: "provider-evidence",
  CAMPAIGN_CREATIVE: "campaigns",
  LISTING_MEDIA: "properties",
  MAINTENANCE_ATTACHMENT: "maintenance-attachments",
  MOVE_IN_INSPECTION_MEDIA: "move-in-inspections",
  MOVE_OUT_INSPECTION_MEDIA: "move-out-inspections",
  APPLICATION_DOCUMENT: "application-documents",
  ORGANISATION_LOGO: "organisations/branding",
  MARKETPLACE_PROFESSIONAL_LOGO: "marketplace-professionals/branding",
  PROVIDER_PORTFOLIO_IMAGE: "provider-portfolio",
};
const GENERATED_DOCUMENT_TYPES = ["RECEIPT", "TENANT_STATEMENT", "MOVE_OUT_STATEMENT", "LEASE_AGREEMENT"] as const;

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

async function record(tx: Tx, organisationId: string | null, actorUserId: string, name: string, entityType: string, entityId: string, payload: Record<string, unknown> = {}) {
  if (!organisationId) return;
  await tx.auditEvent.create({ data: { organisationId, actorUserId, action: name, entityType, entityId, metadata: json(payload) } });
  await tx.domainEvent.create({ data: { organisationId, name, aggregateType: entityType, aggregateId: entityId, payload: json(payload) } });
}

/**
 * Shared upload core (item 1 + item 2). Every controlled upload endpoint funnels through this:
 * bytes are sniffed and validated by content (never trusting the declared MIME alone), scanned
 * for malware before ever touching durable storage, hashed, and only then written to the active
 * `ObjectStorageAdapter`. The `StorageObject` metadata row and the domain-specific attachment row
 * are created together in one transaction; if the domain attach fails, the just-written bytes are
 * best-effort deleted so nothing is left referencing a record that was never created.
 */
/**
 * Whose plan governs an upload. PropertyOS uploads (the default) are checked against the
 * organisation's `OrganisationSubscription`. A marketplace professional's listing belongs to the
 * professional's hidden backing organisation, which by design has no `OrganisationSubscription`
 * (see `MarketplaceProfessional` in schema.prisma) — checking it there always failed with a bare
 * NOT_FOUND — so those uploads are checked against the professional's `MarketplaceSubscription`.
 * Only `uploadMarketplaceListingMedia`, after its own role and ownership checks, passes this.
 */
type UploadEntitlementScope =
  | { kind: "organisation" }
  | { kind: "marketplace"; marketplaceProfessionalId: string }
  /** Platform-admin action on a customer's behalf: never limited by the customer's plan. */
  | { kind: "platform" };

/** Smallest edge accepted for images shown publicly as photos (not for documents or evidence). */
const MINIMUM_IMAGE_EDGE: Record<string, number> = { LISTING_MEDIA: 200, PROVIDER_PORTFOLIO_IMAGE: 200, MARKETPLACE_PROFESSIONAL_LOGO: 64, SERVICE_PROVIDER_LOGO: 64, ORGANISATION_LOGO: 64 };
const MAXIMUM_IMAGE_EDGE = 12_000;
/** Public photo targets, resized to LISTING_PHOTO_MAX_EDGE on their longest edge. */
const PHOTO_TARGETS = new Set(["LISTING_MEDIA", "PROVIDER_PORTFOLIO_IMAGE"]);

async function performUpload(params: {
  userId: string;
  organisationId: string | null;
  targetType: string;
  input: ReturnType<typeof uploadDocumentSchema.parse>;
  entitlementScope?: UploadEntitlementScope;
}) {
  const { userId, targetType, input } = params;
  const descriptor = getUploadDescriptor(targetType);
  // Resolved up front, before any work (sniffing, malware scan) is wasted on bytes that could
  // never actually be stored — this throws immediately in a cloud deployment with no durable
  // storage configured, rather than only failing once we reach the actual write.
  const adapter = getObjectStorageAdapter();
  let bytes = Buffer.from(input.dataBase64, "base64");
  if (bytes.length === 0) throw new AppError("EMPTY_FILE", 422, "The uploaded file is empty.");
  if (bytes.length > maxUploadBytes()) {
    throw new AppError("FILE_TOO_LARGE", 413, `The uploaded file exceeds the ${Math.floor(maxUploadBytes() / (1024 * 1024))}MB limit.`);
  }
  // Representative entitlement check (item 2): total stored bytes (uploads + generated
  // documents) is capped per plan. Provider-evidence uploads have no organisation (organisationId
  // is null) and are never plan-limited.
  const entitlementScope = params.entitlementScope ?? { kind: "organisation" };
  if (entitlementScope.kind === "marketplace") {
    await assertWritableMarketplaceProfessional(entitlementScope.marketplaceProfessionalId);
  } else if (entitlementScope.kind === "platform") {
    // Deliberately unmetered — see UploadEntitlementScope.
  } else if (params.organisationId) {
    await assertOperational(params.organisationId, ENTITLEMENTS.storageBytesMax.key, bytes.length);
  }
  const sniffed = sniffFileType(bytes);
  if (!sniffed) throw new AppError("UNSUPPORTED_FILE_TYPE", 422, "The file's contents are not a supported, recognisable file type.");
  if (!descriptor.allowedMimeTypes.includes(sniffed.mimeType)) {
    throw new AppError("UNSUPPORTED_FILE_TYPE", 422, `Files of type '${sniffed.mimeType}' are not accepted for this upload target.`);
  }
  if ((targetType === MARKETPLACE_PROFESSIONAL_LOGO_TARGET || targetType === SERVICE_PROVIDER_LOGO_TARGET) && bytes.length > MAX_LOGO_BYTES) {
    throw new AppError("LOGO_TOO_LARGE", 413, `This logo is ${formatMegabytes(bytes.length)}. Logos must be ${formatMegabytes(MAX_LOGO_BYTES)} or smaller.`);
  }
  if (targetType === "LISTING_MEDIA") {
    // Explicit, JSON-reported photo limit. Anything much larger never reaches this code on Vercel
    // (the platform rejects the request body first), so the browser compresses photos below it.
    if (sniffed.kind === "IMAGE" && bytes.length > MAX_LISTING_PHOTO_UPLOAD_BYTES) {
      throw new AppError("PHOTO_TOO_LARGE", 413, `This photo is ${formatMegabytes(bytes.length)}. Property photos must be ${formatMegabytes(MAX_LISTING_PHOTO_UPLOAD_BYTES)} or smaller after compression.`);
    }
    const mediaType = input.mediaType ?? "PHOTO";
    if (mediaType === "VIDEO" && sniffed.kind !== "VIDEO") throw new AppError("MEDIA_TYPE_MISMATCH", 422, "A video media type requires a video file.");
    if (mediaType !== "VIDEO" && sniffed.kind === "VIDEO") throw new AppError("MEDIA_TYPE_MISMATCH", 422, "Photo/floor plan media cannot be a video file.");
  }
  if (sniffed.kind === "IMAGE" && PROCESSED_IMAGE_MIME_TYPES.includes(sniffed.mimeType)) {
    // Fully decoded, turned upright and re-encoded without metadata: camera, device and location
    // data never reach storage, and a damaged or mislabelled file is refused, on every upload path.
    const processed = await processUploadedImage(bytes, sniffed.mimeType, {
      minEdge: MINIMUM_IMAGE_EDGE[targetType],
      maxEdge: MAXIMUM_IMAGE_EDGE,
      resizeTo: PHOTO_TARGETS.has(targetType) ? LISTING_PHOTO_MAX_EDGE : undefined,
    });
    bytes = Buffer.from(processed.bytes);
  }
  // Dimension check for campaign creative (item: server-side dimension/aspect-ratio validation).
  // Mirrors the admin UI's own client-side check (same `dimensionMismatch` helper) rather than
  // duplicating the threshold — a caller that bypasses the UI still gets this recorded, but a
  // near-miss is never hard-rejected: the public carousel always renders the image via
  // `background-size: cover`, so an off-ratio image is cropped to fit, never stretched.
  let creativeDimensionWarning: string | null = null;
  if (targetType === "CAMPAIGN_CREATIVE") {
    const dimensions = readImageDimensions(bytes, sniffed.mimeType);
    if (dimensions) {
      const campaign = await db.campaign.findUnique({ where: { id: input.targetId }, select: { placement: true } });
      const spec = campaign ? PLACEMENT_CREATIVE_SPECS[campaign.placement] : undefined;
      const recommended = spec
        ? input.mediaSlot === "nativeApp"
          ? spec.nativeApp
          : input.mediaSlot === "mobile"
            ? spec.mobile
            : spec.desktop
        : undefined;
      if (recommended && dimensionMismatch(dimensions, recommended)) {
        creativeDimensionWarning = `Uploaded image is ${dimensions.width} × ${dimensions.height}px (${aspectRatioLabel(dimensions)}); recommended is ${recommended.width} × ${recommended.height}px (${aspectRatioLabel(recommended)}). It will display cropped to fit rather than stretched.`;
      }
    }
  }
  const classification: StorageClassificationValue = descriptor.allowedClassifications.includes(input.classification) ? input.classification : "PRIVATE";

  const scanner = getMalwareScanner();
  const scan = await scanner.scan(bytes, { fileName: input.fileName, contentType: sniffed.mimeType });
  if (scanner.isConfigured() && params.organisationId) {
    await recordIntegrationOutcome(params.organisationId, "MALWARE_SCAN", scanner.providerKey, scan.status === "ERROR" ? "FAILURE" : "SUCCESS", scan.detail);
  }
  if (scan.status === "INFECTED") throw new AppError("MALWARE_DETECTED", 422, scan.detail ?? "The uploaded file failed a malware scan.");
  if (scan.status === "ERROR") throw new AppError("MALWARE_SCAN_FAILED", 502, scan.detail ?? "The malware scan provider could not be reached.");

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const finalName = safeFileName(input.fileName, sniffed);
  // Namespaced by classification first (`public/`/`private/`) so a bucket policy, CDN caching
  // rule, or lifecycle rule can be scoped to one without any risk of it ever matching the other —
  // Ghana Card evidence and public campaign creative must never be reachable under the same
  // prefix. Existing rows keep whatever key they already have; this only shapes new uploads.
  const storageKey = `${classification === "PUBLIC" ? "public" : "private"}/${UPLOAD_TARGET_NAMESPACES[targetType] ?? targetType.toLowerCase()}/${params.organisationId ?? "unowned"}/${input.targetId}/${randomUUID()}-${finalName}`;

  try {
    // Guarded work whose guard has ended must not store files (see platform/database/guarded.ts).
    await assertGuardedWorkActive();
    await adapter.putObject({ key: storageKey, body: bytes, contentType: sniffed.mimeType, classification });
  } catch (error) {
    if (params.organisationId) await recordIntegrationOutcome(params.organisationId, "STORAGE", adapter.providerKey, "FAILURE", error instanceof Error ? error.message : "Storage write failed.");
    throw error;
  }
  if (params.organisationId) await recordIntegrationOutcome(params.organisationId, "STORAGE", adapter.providerKey, "SUCCESS");

  try {
    return await db.$transaction(async (tx) => {
      const authorization = await descriptor.authorize(tx, { userId, organisationId: params.organisationId, targetId: input.targetId, input });
      const storageObject = await tx.storageObject.create({
        data: {
          organisationId: authorization.organisationId,
          storageKey,
          origin: "UPLOADED",
          classification,
          targetType,
          targetId: input.targetId,
          originalFileName: input.fileName,
          safeFileName: finalName,
          declaredContentType: input.contentType,
          contentType: sniffed.mimeType,
          sizeBytes: bytes.length,
          sha256,
          uploadedByUserId: userId,
          malwareScanStatus: scan.status,
          malwareScanDetail: scan.detail,
          malwareScannedAt: scan.status === "SKIPPED" ? null : new Date(),
          metadata: input.areaId ? json({ areaId: input.areaId }) : undefined,
        },
      });
      const attached = await descriptor.attach(tx, {
        targetId: input.targetId,
        storageObject: { id: storageObject.id, storageKey },
        fileName: finalName,
        contentType: sniffed.mimeType,
        sizeBytes: bytes.length,
        checksum: sha256,
        uploadedByUserId: userId,
        input,
      });
      await record(tx, authorization.organisationId, userId, "document.uploaded", "storage_object", storageObject.id, {
        targetType, targetId: input.targetId, classification, contentType: sniffed.mimeType, sizeBytes: bytes.length,
      });
      return { storageObject, attached, dimensionWarning: creativeDimensionWarning };
    });
  } catch (error) {
    await adapter.deleteObject(storageKey, classification).catch(() => undefined);
    throw error;
  }
}

const ORG_SCOPED_TARGETS = ["LISTING_MEDIA", "MAINTENANCE_ATTACHMENT", "MOVE_IN_INSPECTION_MEDIA", "MOVE_OUT_INSPECTION_MEDIA", "APPLICATION_DOCUMENT", "ORGANISATION_LOGO"];

export async function uploadOrganisationDocument(userId: string, organisationId: string, input: unknown) {
  let data = uploadDocumentSchema.parse(input);

  if (!ORG_SCOPED_TARGETS.includes(data.targetType)) {
    throw new AppError("INVALID_UPLOAD_TARGET", 400, "This endpoint does not accept that upload target type.");
  }

  if (data.targetType === "ORGANISATION_LOGO") {
    if (data.targetId !== organisationId) {
      throw new AppError(
        "INVALID_UPLOAD_TARGET",
        400,
        "Organisation logo target must match the active organisation.",
      );
    }

    data = uploadDocumentSchema.parse({
      ...data,
      classification: "PUBLIC",
    });
  }

  return performUpload({
    userId,
    organisationId,
    targetType: data.targetType,
    input: data,
  });
}

async function logoTarget(marketplaceProfessionalId: string) {
  if (!isUuid(marketplaceProfessionalId)) throw notFound();
  const professional = await db.marketplaceProfessional.findFirst({
    where: { id: marketplaceProfessionalId, archivedAt: null },
    select: { id: true, backingOrganisationId: true, logoUrl: true },
  });
  if (!professional) throw notFound();
  return professional;
}

function logoUploadInput(marketplaceProfessionalId: string, input: unknown) {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  return uploadDocumentSchema.parse({
    fileName: raw.fileName,
    contentType: raw.contentType,
    dataBase64: raw.dataBase64,
    targetType: MARKETPLACE_PROFESSIONAL_LOGO_TARGET,
    targetId: marketplaceProfessionalId,
    classification: "PUBLIC",
  });
}

/** Business self-service: an OWNER or ADMIN of this professional uploads or replaces its logo. */
export async function uploadMarketplaceProfessionalLogo(userId: string, marketplaceProfessionalId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  const professional = await logoTarget(marketplaceProfessionalId);
  const result = await performUpload({
    userId,
    organisationId: professional.backingOrganisationId,
    targetType: MARKETPLACE_PROFESSIONAL_LOGO_TARGET,
    input: logoUploadInput(marketplaceProfessionalId, input),
    entitlementScope: { kind: "marketplace", marketplaceProfessionalId },
  });
  return result.attached;
}

export async function removeMarketplaceProfessionalLogo(userId: string, marketplaceProfessionalId: string) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  const professional = await logoTarget(marketplaceProfessionalId);
  await db.$transaction((tx) => clearMarketplaceProfessionalLogo(tx, professional, userId));
  return { id: professional.id, logoUrl: null };
}

/** Platform-admin path: requires `marketplaceVerify` (checked here, and again by the upload
 * target inside the transaction). Also recorded in the platform audit log. */
function requireLogoPlatformPermission(principal: PlatformPrincipal) {
  if (principal.status !== "ACTIVE" || !platformRoleHasPermission(principal.role, PLATFORM_PERMISSIONS.marketplaceVerify)) throw forbidden();
}

export async function uploadMarketplaceProfessionalLogoAsPlatform(principal: PlatformPrincipal, marketplaceProfessionalId: string, input: unknown) {
  requireLogoPlatformPermission(principal);
  const professional = await logoTarget(marketplaceProfessionalId);
  const result = await performUpload({
    userId: principal.userId,
    organisationId: professional.backingOrganisationId,
    targetType: MARKETPLACE_PROFESSIONAL_LOGO_TARGET,
    input: logoUploadInput(marketplaceProfessionalId, input),
    entitlementScope: { kind: "platform" },
  });
  await db.platformAuditEvent.create({
    data: {
      platformPrincipalId: principal.id, action: "marketplace_professional.logo_updated", entityType: "marketplace_professional",
      entityId: marketplaceProfessionalId, organisationId: professional.backingOrganisationId,
      metadata: json({ storageObjectId: result.storageObject.id, actorUserId: principal.userId }),
    },
  });
  return result.attached;
}

export async function removeMarketplaceProfessionalLogoAsPlatform(principal: PlatformPrincipal, marketplaceProfessionalId: string) {
  requireLogoPlatformPermission(principal);
  const professional = await logoTarget(marketplaceProfessionalId);
  await db.$transaction(async (tx) => {
    const removed = await clearMarketplaceProfessionalLogo(tx, professional, principal.userId);
    if (!removed) return;
    await tx.platformAuditEvent.create({
      data: {
        platformPrincipalId: principal.id, action: "marketplace_professional.logo_removed", entityType: "marketplace_professional",
        entityId: marketplaceProfessionalId, organisationId: professional.backingOrganisationId,
        metadata: json({ previousLogoUrl: professional.logoUrl, actorUserId: principal.userId }),
      },
    });
  });
  return { id: professional.id, logoUrl: null };
}

/** Same cap the listing form and `createListingSchema.mediaUrls` already state to users. */

export async function uploadMarketplaceListingMedia(
  userId: string,
  marketplaceProfessionalId: string,
  listingId: string,
  input: unknown,
) {
  await requireMarketplaceRole(
    userId,
    marketplaceProfessionalId,
    "AGENT",
  );

  const listing = await db.listing.findUnique({
    where: {
      id: listingId,
    },
    select: {
      id: true,
      organisationId: true,
      marketplaceProfessionalId: true,
      status: true,
      _count: { select: { media: true } },
      media: { where: { type: "PHOTO" }, select: { id: true } },
    },
  });

  if (!listing) {
    console.error("[marketplace-listing-media] listing not found", {
      listingId,
      marketplaceProfessionalId,
    });
    throw new AppError(
      "MARKETPLACE_LISTING_NOT_FOUND",
      404,
      "The property listing could not be found for photo upload.",
    );
  }

  if (listing.marketplaceProfessionalId !== marketplaceProfessionalId) {
    console.error("[marketplace-listing-media] professional mismatch", {
      listingId,
      requestedProfessionalId: marketplaceProfessionalId,
      listingProfessionalId: listing.marketplaceProfessionalId,
    });
    throw new AppError(
      "MARKETPLACE_LISTING_PROFESSIONAL_MISMATCH",
      409,
      "The property listing is not attached to the active professional account.",
    );
  }

  // Photos change only while the listing itself is editable (draft, rejected, paused), so a listing
  // in review or live on the marketplace can't be altered outside the moderation lifecycle.
  if (!["DRAFT", "REJECTED", "PAUSED"].includes(listing.status)) {
    throw new AppError("LISTING_NOT_EDITABLE", 409, "Photos can only be changed while the listing is a draft, rejected, or paused.");
  }

  // A fast, friendly answer; the authoritative check runs again under the listing lock.
  const requestedType = typeof input === "object" && input !== null ? (input as { mediaType?: unknown }).mediaType ?? "PHOTO" : "PHOTO";
  if ((requestedType === "PHOTO" && (listing.media?.length ?? 0) >= MAX_LISTING_PHOTOS) || listing._count.media >= MAX_LISTING_MEDIA_ITEMS) {
    throw new AppError(
      "LISTING_MEDIA_LIMIT_REACHED",
      422,
      `A property listing can contain up to ${MAX_LISTING_PHOTOS} photos. Remove one to add another.`,
    );
  }

  const data = uploadDocumentSchema.parse({
    ...(input as object),
    targetType: "LISTING_MEDIA",
    targetId: listing.id,
    classification: "PUBLIC",
  });

  try {
    const result = await performUpload({
      userId,
      organisationId: listing.organisationId,
      targetType: "LISTING_MEDIA",
      input: data,
      entitlementScope: { kind: "marketplace", marketplaceProfessionalId },
    });
    console.info("[marketplace-listing-media] uploaded", {
      listingId,
      marketplaceProfessionalId,
      storageObjectId: result.storageObject.id,
      mediaId: result.attached.id,
    });
    return result;
  } catch (error) {
    // Identifiers and error codes only — never file contents, URLs with credentials or secrets.
    console.error("[marketplace-listing-media] upload failed", {
      listingId,
      marketplaceProfessionalId,
      code: error instanceof AppError ? error.code : undefined,
      status: error instanceof AppError ? error.status : undefined,
      name: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}

export async function uploadProviderEvidenceDocument(userId: string, providerId: string, input: unknown) {
  const data = uploadDocumentSchema.parse({ ...(input as object), targetType: "PROVIDER_EVIDENCE", targetId: providerId });
  return performUpload({ userId, organisationId: null, targetType: "PROVIDER_EVIDENCE", input: data });
}

/** A service provider's owner uploads or replaces its public logo: `{ fileName, contentType,
 * dataBase64 }`. Always PUBLIC (forced here, never trusted from the request); ownership is checked
 * by the upload target inside the transaction. Not plan-metered, like provider evidence. */
export async function uploadServiceProviderLogo(userId: string, providerId: string, input: unknown) {
  if (!isUuid(providerId)) throw notFound();
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const data = uploadDocumentSchema.parse({
    fileName: raw.fileName,
    contentType: raw.contentType,
    dataBase64: raw.dataBase64,
    targetType: SERVICE_PROVIDER_LOGO_TARGET,
    targetId: providerId,
    classification: "PUBLIC",
  });
  const result = await performUpload({ userId, organisationId: null, targetType: SERVICE_PROVIDER_LOGO_TARGET, input: data });
  return result.attached;
}

export async function removeServiceProviderLogo(userId: string, providerId: string) {
  if (!isUuid(providerId)) throw notFound();
  const provider = await ownsProvider(userId, providerId);
  if (!provider) throw forbidden();
  await db.$transaction((tx) => clearServiceProviderLogo(tx, providerId, userId));
  return { id: providerId, logo: null };
}

/** Campaign creative is always PUBLIC regardless of what a caller sends — forced here rather
 * than trusted from the request, since the target's `allowedClassifications` would otherwise
 * silently downgrade an omitted/wrong value to PRIVATE (unusable for a public promotional image). */
export async function uploadCampaignCreative(userId: string, campaignId: string, input: unknown) {
  const data = uploadDocumentSchema.parse({ ...(input as object), targetType: "CAMPAIGN_CREATIVE", targetId: campaignId, classification: "PUBLIC" });
  return performUpload({ userId, organisationId: null, targetType: "CAMPAIGN_CREATIVE", input: data });
}

export async function reorderListingMedia(userId: string, organisationId: string, listingId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.listingManage);
  const data = listingMediaOrderSchema.parse(input);
  return db.$transaction(async (tx) => {
    const listing = await tx.listing.findFirst({ where: { id: listingId, organisationId } });
    if (!listing) throw notFound();
    await lockListingMedia(tx, listing.id);
    const media = await tx.listingMedia.findMany({ where: { listingId } });
    const mediaIds = new Set(media.map(({ id }) => id));
    for (const item of data.order) {
      if (!mediaIds.has(item.mediaId)) throw new AppError("INVALID_LISTING_MEDIA", 422, "Every reordered item must belong to this listing.");
    }
    if (data.coverMediaId && !mediaIds.has(data.coverMediaId)) throw new AppError("INVALID_LISTING_MEDIA", 422, "The cover image must belong to this listing.");
    if (data.coverMediaId && media.find(({ id }) => id === data.coverMediaId)?.type !== "PHOTO") throw new AppError("COVER_MUST_BE_PHOTO", 422, "Only a photo can be the cover image.");
    await Promise.all(data.order.map((item) => tx.listingMedia.update({ where: { id: item.mediaId }, data: { sortOrder: item.sortOrder } })));
    if (data.coverMediaId !== undefined) {
      await tx.listingMedia.updateMany({ where: { listingId }, data: { isCover: false } });
      if (data.coverMediaId) await tx.listingMedia.update({ where: { id: data.coverMediaId }, data: { isCover: true } });
    }
    // A listing with photos always keeps exactly one cover, even if the request cleared it.
    await ensureListingCover(tx, listingId);
    await record(tx, organisationId, userId, "listing.media_reordered", "listing", listingId, { coverMediaId: data.coverMediaId });
    return tx.listingMedia.findMany({ where: { listingId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  });
}

/** Resolves temporary signed access for a StorageObject the caller is authorised to read, scoped through the owning domain's own permission model. Never returns the raw storage key. */
export async function getSignedStorageAccess(userId: string, organisationId: string | null, storageObjectId: string) {
  const storageObject = await db.storageObject.findUnique({ where: { id: storageObjectId } });
  if (!storageObject || storageObject.archivedAt) throw notFound();
  await requireStorageObjectRead(userId, organisationId, storageObject);
  const adapter = getObjectStorageAdapter();
  if (storageObject.classification === "PUBLIC") {
    return { url: adapter.getPublicUrl(storageObject.storageKey) ?? buildInternalPublicMediaUrl(storageObject.storageKey), expiresAt: null };
  }
  const expiresInSeconds = 300;
  const url = await adapter.getSignedUrl(storageObject.storageKey, storageObject.classification, { expiresInSeconds, fileName: storageObject.originalFileName });
  return { url, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
}

async function requireStorageObjectRead(userId: string, organisationId: string | null, storageObject: { id: string; organisationId: string | null; targetType: string; targetId: string | null }) {
  if (storageObject.targetType === "PROVIDER_EVIDENCE") {
    if (storageObject.targetId) {
      const owner = await ownsProvider(userId, storageObject.targetId);
      if (owner) return;
    }
    if (organisationId && storageObject.organisationId === organisationId) {
      if (await hasPermission(userId, organisationId, PERMISSIONS.providerVerify)) return;
    }
    if (organisationId && storageObject.targetId) {
      const directory = await db.providerOrganisation.findFirst({ where: { landlordOrganisationId: organisationId, providerId: storageObject.targetId, status: "ACTIVE" } });
      if (directory && (await hasPermission(userId, organisationId, PERMISSIONS.providerVerify))) return;
    }
    // A NesAfric platform reviewer (Ghana Card / identity evidence queue) — checked directly
    // against `PlatformPrincipal` rather than `requirePlatformPrincipal`, since this function only
    // has a userId, not the full authenticated `User` row that helper expects, and bootstrap has
    // already run by the time anyone reaches the platform-admin review surface that calls this.
    const principal = await db.platformPrincipal.findUnique({ where: { userId } });
    if (principal && principal.status === "ACTIVE" && platformRoleHasPermission(principal.role, PLATFORM_PERMISSIONS.providerIdentityReview)) return;
    throw forbidden();
  }
  if (!organisationId || storageObject.organisationId !== organisationId) throw forbidden();
  if (await hasPermission(userId, organisationId, PERMISSIONS.documentManage)) return;
  if (storageObject.targetType === "GENERATED_DOCUMENT") {
    const generated = await db.generatedDocument.findUnique({ where: { storageObjectId: storageObject.id } });
    if (!generated) throw forbidden();
    const readPermissionByDocumentType: Record<string, string> = {
      RECEIPT: PERMISSIONS.paymentRead,
      TENANT_STATEMENT: PERMISSIONS.paymentRead,
      MOVE_OUT_STATEMENT: PERMISSIONS.moveOutRead,
      LEASE_AGREEMENT: PERMISSIONS.leaseExecutionRead,
    };
    if (await hasPermission(userId, organisationId, readPermissionByDocumentType[generated.documentType])) return;
    if (generated.tenantOrganisationId) {
      const tenant = await db.tenantOrganisation.findFirst({ where: { id: generated.tenantOrganisationId, organisationId, userId, archivedAt: null } });
      if (tenant) return;
    }
    if (generated.leaseId) {
      const party = await db.leaseParty.findFirst({ where: { leaseId: generated.leaseId, lease: { organisationId }, tenantOrganisation: { userId, archivedAt: null } } });
      if (party) return;
    }
    throw forbidden();
  }
  const permissionByTarget: Record<string, string> = {
    LISTING_MEDIA: PERMISSIONS.listingRead,
    MAINTENANCE_ATTACHMENT: PERMISSIONS.maintenanceRead,
    MOVE_IN_INSPECTION_MEDIA: PERMISSIONS.moveInRead,
    MOVE_OUT_INSPECTION_MEDIA: PERMISSIONS.moveOutRead,
    APPLICATION_DOCUMENT: PERMISSIONS.applicationRead,
  };
  const permission = permissionByTarget[storageObject.targetType];
  if (permission && (await hasPermission(userId, organisationId, permission))) return;
  if (storageObject.targetType === "MAINTENANCE_ATTACHMENT" && storageObject.targetId) {
    const request = await db.maintenanceRequest.findFirst({ where: { id: storageObject.targetId, organisationId } });
    if (request?.tenantOrganisationId) {
      const tenant = await db.tenantOrganisation.findFirst({ where: { id: request.tenantOrganisationId, organisationId, userId, archivedAt: null } });
      if (tenant) return;
    }
  }
  throw forbidden();
}

/**
 * Archiving/restoring is a destructive, organisation-scoped *write* action, not merely viewing —
 * so it must never be reachable by everyone who can merely read a document (the various narrow
 * read permissions and tenant self-view bypasses in `requireStorageObjectRead`). Every
 * organisation-scoped `StorageObject` requires the holder to hold `PERMISSIONS.documentManage`
 * within the exact organisation that owns it. `PROVIDER_EVIDENCE` objects have no owning
 * organisation (`organisationId` is null): they use the same explicit owner/administrator write
 * pattern already established by `ownsProvider` for uploads, rather than the read-oriented
 * `providerVerify` permission a landlord org can hold — that permission lets a landlord *review*
 * a provider's evidence, not archive/restore someone else's document.
 */
async function requireStorageObjectWrite(userId: string, organisationId: string | null, storageObject: { organisationId: string | null; targetType: string; targetId: string | null }) {
  if (storageObject.targetType === "PROVIDER_EVIDENCE") {
    if (storageObject.targetId && (await ownsProvider(userId, storageObject.targetId))) return;
    throw forbidden();
  }
  if (!organisationId || storageObject.organisationId !== organisationId) throw forbidden();
  if (await hasPermission(userId, organisationId, PERMISSIONS.documentManage)) return;
  throw forbidden();
}

export async function archiveStorageObject(userId: string, organisationId: string | null, storageObjectId: string, input: unknown) {
  const data = archiveStorageObjectSchema.parse(input);
  return db.$transaction(async (tx) => {
    const storageObject = await tx.storageObject.findUnique({ where: { id: storageObjectId } });
    if (!storageObject) throw notFound();
    await requireStorageObjectWrite(userId, organisationId, storageObject);
    if (storageObject.archivedAt) throw new AppError("ALREADY_ARCHIVED", 409, "This document is already archived.");
    const updated = await tx.storageObject.update({ where: { id: storageObjectId }, data: { archivedAt: new Date(), archivedByUserId: userId, archiveReason: data.reason } });
    await tx.storageObjectHistory.create({ data: { storageObjectId, actorUserId: userId, action: "ARCHIVED", reason: data.reason } });
    await record(tx, storageObject.organisationId, userId, "document.archived", "storage_object", storageObjectId, { reason: data.reason });
    return updated;
  });
}

export async function restoreStorageObject(userId: string, organisationId: string | null, storageObjectId: string) {
  return db.$transaction(async (tx) => {
    const storageObject = await tx.storageObject.findUnique({ where: { id: storageObjectId } });
    if (!storageObject) throw notFound();
    await requireStorageObjectWrite(userId, organisationId, storageObject);
    if (!storageObject.archivedAt) throw new AppError("NOT_ARCHIVED", 409, "This document is not archived.");
    const updated = await tx.storageObject.update({ where: { id: storageObjectId }, data: { archivedAt: null, archivedByUserId: null, archiveReason: null } });
    await tx.storageObjectHistory.create({ data: { storageObjectId, actorUserId: userId, action: "RESTORED" } });
    await record(tx, storageObject.organisationId, userId, "document.restored", "storage_object", storageObjectId, {});
    return updated;
  });
}

export type DocumentCenterQuery = ReturnType<typeof documentCenterQuerySchema.parse>;

/**
 * Unified, permission-checked Document Center listing across both uploaded attachments
 * (`StorageObject`) and generated PDFs (`GeneratedDocument`). Staff-only: tenants use their own
 * narrow statement/receipt/lease views (`listTenantDocuments`), never this endpoint, so "internal"
 * documents (maintenance/application/inspection/provider files) are never reachable by a tenant.
 */
export async function listDocumentCenter(userId: string, organisationId: string, query: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.documentRead);
  const filters = documentCenterQuerySchema.parse(query);
  const wantsUploads = !filters.type || (UPLOAD_TARGET_TYPES as readonly string[]).includes(filters.type);
  const wantsGenerated = !filters.type || (GENERATED_DOCUMENT_TYPES as readonly string[]).includes(filters.type);

  const uploaded = wantsUploads ? await queryUploadedDocuments(organisationId, filters) : [];
  const generated = wantsGenerated ? await queryGeneratedDocuments(organisationId, filters) : [];

  const combined = [...uploaded, ...generated].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const start = (filters.page - 1) * filters.pageSize;
  return {
    items: combined.slice(start, start + filters.pageSize),
    pagination: { page: filters.page, pageSize: filters.pageSize, total: combined.length, totalPages: Math.ceil(combined.length / filters.pageSize) || 1 },
  };
}

type DocumentCenterEntry = {
  id: string;
  kind: "UPLOADED" | "GENERATED";
  type: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  classification: string;
  createdAt: Date;
  scope: Record<string, string | null>;
};

async function resolveMaintenanceIds(organisationId: string, filters: DocumentCenterQuery) {
  if (!filters.leaseId && !filters.propertyId && !filters.tenantOrganisationId) return undefined;
  const rows = await db.maintenanceRequest.findMany({
    where: {
      organisationId,
      ...(filters.leaseId ? { leaseId: filters.leaseId } : {}),
      ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(filters.tenantOrganisationId ? { tenantOrganisationId: filters.tenantOrganisationId } : {}),
    },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

async function resolveListingIds(organisationId: string, filters: DocumentCenterQuery) {
  if (!filters.propertyId && !filters.unitId) return undefined;
  const rows = await db.listing.findMany({
    where: { organisationId, ...(filters.propertyId ? { propertyId: filters.propertyId } : {}), ...(filters.unitId ? { unitId: filters.unitId } : {}) },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

async function resolveApplicationIds(organisationId: string, filters: DocumentCenterQuery) {
  if (!filters.leaseId && !filters.tenantOrganisationId) return undefined;
  const rows = await db.rentalApplication.findMany({
    where: { organisationId, ...(filters.leaseId ? { leaseId: filters.leaseId } : {}), ...(filters.tenantOrganisationId ? { tenantOrganisationId: filters.tenantOrganisationId } : {}) },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

async function resolveInspectionIds(organisationId: string, filters: DocumentCenterQuery, kind: "IN" | "OUT") {
  if (!filters.leaseId && !filters.propertyId) return undefined;
  const leaseWhere = { organisationId, ...(filters.leaseId ? { id: filters.leaseId } : {}), ...(filters.propertyId ? { propertyId: filters.propertyId } : {}) };
  if (kind === "IN") {
    const rows = await db.moveInInspection.findMany({ where: { moveIn: { lease: leaseWhere } }, select: { id: true } });
    return rows.map(({ id }) => id);
  }
  // MOVE_OUT_INSPECTION_MEDIA is stored against the MoveOut record itself (see targets.ts), not the specific inspection.
  const rows = await db.moveOut.findMany({ where: { lease: leaseWhere }, select: { id: true } });
  return rows.map(({ id }) => id);
}

/** Resolves a caller-supplied `inspectionId` filter to the actual StorageObject.targetId(s) it should match, accounting for MOVE_OUT_INSPECTION_MEDIA being keyed by the parent MoveOut, not the specific MoveOutInspection. */
async function resolveInspectionFilterTargetIds(inspectionId: string, kind: "IN" | "OUT") {
  if (kind === "IN") return [inspectionId];
  const inspection = await db.moveOutInspection.findUnique({ where: { id: inspectionId }, select: { moveOutId: true } });
  return inspection ? [inspection.moveOutId] : [inspectionId];
}

async function queryUploadedDocuments(organisationId: string, filters: DocumentCenterQuery): Promise<DocumentCenterEntry[]> {
  const targetType = filters.type && (UPLOAD_TARGET_TYPES as readonly string[]).includes(filters.type) ? filters.type : undefined;
  if (filters.maintenanceRequestId && targetType && targetType !== "MAINTENANCE_ATTACHMENT") return [];
  if (filters.applicationId && targetType && targetType !== "APPLICATION_DOCUMENT") return [];
  if (filters.inspectionId && targetType && !["MOVE_IN_INSPECTION_MEDIA", "MOVE_OUT_INSPECTION_MEDIA"].includes(targetType)) return [];

  const perType: Array<{ type: string; targetIds?: string[] }> = [];
  // A specific-ID filter (maintenanceRequestId/applicationId/inspectionId) narrows the searched
  // target types to only the type(s) that filter could possibly match — otherwise every other
  // upload target type would be resolved by its own unrelated logic and leak into the results.
  const types: readonly string[] = targetType
    ? [targetType]
    : filters.maintenanceRequestId
      ? ["MAINTENANCE_ATTACHMENT"]
      : filters.applicationId
        ? ["APPLICATION_DOCUMENT"]
        : filters.inspectionId
          ? ["MOVE_IN_INSPECTION_MEDIA", "MOVE_OUT_INSPECTION_MEDIA"]
          : UPLOAD_TARGET_TYPES;
  for (const type of types) {
    if (type === "MAINTENANCE_ATTACHMENT") {
      if (filters.maintenanceRequestId) perType.push({ type, targetIds: [filters.maintenanceRequestId] });
      else {
        const ids = await resolveMaintenanceIds(organisationId, filters);
        if (ids) { if (ids.length) perType.push({ type, targetIds: ids }); } else perType.push({ type });
      }
    } else if (type === "LISTING_MEDIA") {
      const ids = await resolveListingIds(organisationId, filters);
      if (ids) { if (ids.length) perType.push({ type, targetIds: ids }); } else perType.push({ type });
    } else if (type === "APPLICATION_DOCUMENT") {
      if (filters.applicationId) perType.push({ type, targetIds: [filters.applicationId] });
      else {
        const ids = await resolveApplicationIds(organisationId, filters);
        if (ids) { if (ids.length) perType.push({ type, targetIds: ids }); } else perType.push({ type });
      }
    } else if (type === "MOVE_IN_INSPECTION_MEDIA" || type === "MOVE_OUT_INSPECTION_MEDIA") {
      const kind = type === "MOVE_IN_INSPECTION_MEDIA" ? "IN" : "OUT";
      if (filters.inspectionId) perType.push({ type, targetIds: await resolveInspectionFilterTargetIds(filters.inspectionId, kind) });
      else {
        const ids = await resolveInspectionIds(organisationId, filters, kind);
        if (ids) { if (ids.length) perType.push({ type, targetIds: ids }); } else perType.push({ type });
      }
    } else if (type === "PROVIDER_EVIDENCE") {
      if (!filters.leaseId && !filters.propertyId && !filters.tenantOrganisationId && !filters.maintenanceRequestId && !filters.applicationId && !filters.inspectionId) {
        perType.push({ type });
      }
    }
  }
  if (!perType.length) return [];

  const rows = await db.storageObject.findMany({
    where: {
      organisationId,
      archivedAt: null,
      OR: perType.map(({ type, targetIds }) => ({ targetType: type, ...(targetIds ? { targetId: { in: targetIds } } : {}) })),
      ...(filters.dateFrom || filters.dateTo ? { createdAt: { gte: filters.dateFrom, lte: filters.dateTo } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return rows.map((row) => ({
    id: row.id,
    kind: "UPLOADED" as const,
    type: row.targetType,
    fileName: row.originalFileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    classification: row.classification,
    createdAt: row.createdAt,
    scope: { targetType: row.targetType, targetId: row.targetId },
  }));
}

async function queryGeneratedDocuments(organisationId: string, filters: DocumentCenterQuery): Promise<DocumentCenterEntry[]> {
  let paymentReceiptId: string | undefined;
  if (filters.paymentId) {
    const receipt = await db.receipt.findUnique({ where: { paymentId: filters.paymentId } });
    if (!receipt) return [];
    paymentReceiptId = receipt.id;
  }
  const rows = await db.generatedDocument.findMany({
    where: {
      organisationId,
      ...(filters.type && GENERATED_DOCUMENT_TYPES.includes(filters.type as (typeof GENERATED_DOCUMENT_TYPES)[number]) ? { documentType: filters.type as (typeof GENERATED_DOCUMENT_TYPES)[number] } : {}),
      ...(filters.leaseId ? { leaseId: filters.leaseId } : {}),
      ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(filters.tenantOrganisationId ? { tenantOrganisationId: filters.tenantOrganisationId } : {}),
      ...(paymentReceiptId ? { sourceType: "RECEIPT", sourceId: paymentReceiptId } : {}),
      ...(filters.dateFrom || filters.dateTo ? { generatedAt: { gte: filters.dateFrom, lte: filters.dateTo } } : {}),
    },
    include: { storageObject: true },
    orderBy: { generatedAt: "desc" },
    take: 500,
  });
  return rows.map((row) => ({
    id: row.id,
    kind: "GENERATED" as const,
    type: row.documentType,
    fileName: row.storageObject.originalFileName,
    contentType: row.storageObject.contentType,
    sizeBytes: row.storageObject.sizeBytes,
    classification: row.storageObject.classification,
    createdAt: row.generatedAt,
    scope: { leaseId: row.leaseId, propertyId: row.propertyId, tenantOrganisationId: row.tenantOrganisationId, referenceNumber: row.referenceNumber, version: String(row.version) },
  }));
}

/** Tenant-safe document access (item 8): only their own executed lease agreement, receipts, statements, and move-out statement — never uploaded/internal files. */
export async function listTenantDocuments(userId: string, organisationId: string, tenantOrganisationId: string) {
  const tenant = await db.tenantOrganisation.findFirst({ where: { id: tenantOrganisationId, organisationId, userId, archivedAt: null } });
  if (!tenant) {
    const internal = await hasPermission(userId, organisationId, PERMISSIONS.documentRead);
    if (!internal) throw forbidden();
  }
  const leaseParties = await db.leaseParty.findMany({ where: { tenantOrganisationId, lease: { organisationId } }, select: { leaseId: true } });
  const leaseIds = leaseParties.map(({ leaseId }) => leaseId);
  const rows = await db.generatedDocument.findMany({
    where: {
      organisationId,
      OR: [
        { documentType: { in: ["RECEIPT", "MOVE_OUT_STATEMENT"] }, tenantOrganisationId },
        { documentType: { in: ["LEASE_AGREEMENT", "TENANT_STATEMENT"] }, leaseId: { in: leaseIds } },
      ],
    },
    include: { storageObject: true },
    orderBy: { generatedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.documentType,
    referenceNumber: row.referenceNumber,
    version: row.version,
    fileName: row.storageObject.originalFileName,
    generatedAt: row.generatedAt,
    leaseId: row.leaseId,
  }));
}

const PROVIDER_PORTFOLIO_TARGET = "PROVIDER_PORTFOLIO_IMAGE";

/** Adds one portfolio image to a provider's public profile (owner only, at most 10). */
export async function uploadProviderPortfolioImage(userId: string, providerId: string, input: unknown) {
  if (!isUuid(providerId)) throw notFound();
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const data = uploadDocumentSchema.parse({
    fileName: raw.fileName,
    contentType: raw.contentType,
    dataBase64: raw.dataBase64,
    title: raw.title,
    sourceMediaId: raw.sourceMediaId,
    targetType: PROVIDER_PORTFOLIO_TARGET,
    targetId: providerId,
    classification: "PUBLIC",
  });
  const result = await performUpload({ userId, organisationId: null, targetType: PROVIDER_PORTFOLIO_TARGET, input: data });
  return result.attached as { id: string; publicUrl: string; sortOrder: number };
}

export async function listProviderPortfolioImages(userId: string, providerId: string) {
  if (!isUuid(providerId)) throw notFound();
  if (!(await ownsProvider(userId, providerId))) throw forbidden();
  return db.providerPortfolioImage.findMany({ where: { providerId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, publicUrl: true, sortOrder: true, caption: true } });
}

/** Removes a portfolio image and its stored file. */
export async function removeProviderPortfolioImage(userId: string, providerId: string, imageId: string) {
  if (!isUuid(providerId) || !isUuid(imageId)) throw notFound();
  if (!(await ownsProvider(userId, providerId))) throw forbidden();
  const removed = await db.$transaction(async (tx) => {
    const image = await tx.providerPortfolioImage.findFirst({ where: { id: imageId, providerId } });
    if (!image) throw notFound();
    await tx.providerPortfolioImage.delete({ where: { id: image.id } });
    await tx.storageObject.updateMany({ where: { id: image.storageObjectId, archivedAt: null }, data: { archivedAt: new Date() } });
    return image;
  });
  await getObjectStorageAdapter().deleteObject(removed.storageKey, "PUBLIC").catch(() => undefined);
  return { id: removed.id };
}
