import {
  ListingStatus,
  ListingVerificationStatus,
  MarketplaceLeadStatus,
  Prisma,
  ViewingRequestStatus,
} from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { AppError, notFound } from "@/platform/errors";
import { getActiveGeocodingAdapter } from "@/modules/geocoding/provider";
import { isRealGeocodingProviderConfigured } from "@/modules/geocoding/service";
import { upsertCalendarEvent } from "@/modules/calendar/service";
import { assertOperational } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import {
  createListingSchema,
  createMarketplaceLeadSchema,
  createViewingRequestSchema,
  leadIdSchema,
  listingIdSchema,
  listingManagementListSchema,
  listingTransitionSchema,
  listingVerificationSchema,
  marketplaceLeadListSchema,
  publicListingSearchSchema,
  updateListingSchema,
  updateMarketplaceLeadSchema,
  updateViewingRequestSchema,
  viewingRequestIdSchema,
  viewingRequestListSchema,
} from "./schemas";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;

export const PUBLIC_LISTING_RATE_LIMIT = {
  policy: "public-listing-marketplace",
  limit: 120,
  windowSeconds: 60,
  keyStrategy: "ip+route",
  enforcement: "gateway-ready",
} as const;

export const PUBLIC_LISTING_WRITE_RATE_LIMIT = {
  policy: "public-listing-enquiry",
  limit: 20,
  windowSeconds: 60,
  keyStrategy: "ip+listing",
  enforcement: "gateway-ready",
} as const;

const listingInclude = {
  property: { select: { id: true, name: true, referenceNumber: true, status: true, archivedAt: true } },
  unit: { select: { id: true, name: true, status: true, archivedAt: true } },
  amenities: { orderBy: [{ category: "asc" as const }, { label: "asc" as const }] },
  media: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] },
  statusHistory: { orderBy: { createdAt: "asc" as const }, take: 200 },
  verificationHistory: { orderBy: { createdAt: "asc" as const }, take: 200 },
  verificationEvidence: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.ListingInclude;

const publicListingInclude = {
  amenities: { orderBy: [{ category: "asc" as const }, { label: "asc" as const }] },
  media: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] },
} satisfies Prisma.ListingInclude;

async function record(
  tx: Tx,
  organisationId: string,
  actorUserId: string | undefined,
  name: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown> = {},
) {
  await tx.auditEvent.create({
    data: { organisationId, actorUserId, action: name, entityType: aggregateType, entityId: aggregateId, metadata: json(payload) },
  });
  await tx.domainEvent.create({
    data: { organisationId, name, aggregateType, aggregateId, payload: json(payload) },
  });
}

function decimal(value: string | number | null | undefined) {
  return value == null ? null : new Prisma.Decimal(value);
}

function listingWriteData(data: ReturnType<typeof createListingSchema.parse>) {
  const { amenities, media, ...fields } = data;
  return {
    ...fields,
    unitId: fields.unitId ?? null,
    askingAmountMinor: decimal(fields.askingAmountMinor),
    rentAmountMinor: decimal(fields.rentAmountMinor),
    bathrooms: decimal(fields.bathrooms),
    sizeSqm: decimal(fields.sizeSqm),
    mapLatitude: decimal(fields.mapLatitude),
    mapLongitude: decimal(fields.mapLongitude),
    amenities: {
      create: amenities.map((amenity) => ({
        ...amenity,
        category: amenity.category ?? null,
        metadata: amenity.metadata ? json(amenity.metadata) : undefined,
      })),
    },
    media: {
      create: media.map((item) => ({
        ...item,
        storageKey: item.storageKey ?? null,
        mimeType: item.mimeType ?? null,
        title: item.title ?? null,
        altText: item.altText ?? null,
        checksum: item.checksum ?? null,
        fileSizeBytes: decimal(item.fileSizeBytes),
        metadata: item.metadata ? json(item.metadata) : undefined,
      })),
    },
  };
}

async function validateAsset(
  tx: Tx | typeof db,
  organisationId: string,
  propertyId: string,
  unitId: string | null | undefined,
  countryCode: string,
  currencyCode: string,
) {
  const property = await tx.property.findFirst({
    where: { id: propertyId, organisationId, archivedAt: null, status: "ACTIVE" },
    select: { id: true, countryCode: true },
  });
  if (!property) throw notFound();
  if (property.countryCode !== countryCode) {
    throw new AppError("LISTING_LOCATION_MISMATCH", 422, "The public country must match the managed property.");
  }
  if (unitId) {
    const unit = await tx.unit.findFirst({
      where: { id: unitId, propertyId, archivedAt: null },
      select: { id: true },
    });
    if (!unit) throw new AppError("INVALID_LISTING_UNIT", 422, "The unit must belong to the listed property.");
  }
  const [country, currency] = await Promise.all([
    tx.country.findUnique({ where: { code: countryCode } }),
    tx.currency.findUnique({ where: { code: currencyCode } }),
  ]);
  if (!country?.isActive || !currency?.isActive) {
    throw new AppError("INVALID_LISTING_CONFIGURATION", 422, "The listing country or currency is not supported.");
  }
}

async function isAssetAvailable(
  tx: Tx | typeof db,
  listing: { propertyId: string; unitId: string | null },
  at = new Date(),
) {
  const property = await tx.property.findFirst({
    where: { id: listing.propertyId, archivedAt: null, status: "ACTIVE" },
    select: { id: true },
  });
  if (!property) return false;
  const activeLeaseWhere: Prisma.LeaseWhereInput = {
    propertyId: listing.propertyId,
    archivedAt: null,
    status: { in: ["ACTIVE", "EXPIRING"] },
    startDate: { lte: at },
    OR: [{ endDate: null }, { endDate: { gte: at } }],
    ...(listing.unitId ? { unitId: listing.unitId } : {}),
  };
  if (await tx.lease.count({ where: activeLeaseWhere })) return false;
  if (listing.unitId) {
    return Boolean(await tx.unit.findFirst({
      where: { id: listing.unitId, propertyId: listing.propertyId, archivedAt: null, status: "AVAILABLE" },
      select: { id: true },
    }));
  }
  return (await tx.unit.count({
    where: { propertyId: listing.propertyId, archivedAt: null, status: { not: "AVAILABLE" } },
  })) === 0;
}

export async function createListing(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.listingCreate);
  // Representative entitlement check (item 2): published/active listing count is capped per plan.
  await assertOperational(organisationId, ENTITLEMENTS.listingsMax.key);
  const data = createListingSchema.parse(input);
  return db.$transaction(async (tx) => {
    await validateAsset(tx, organisationId, data.propertyId, data.unitId, data.countryCode, data.currencyCode);
    const listing = await tx.listing.create({
      data: {
        organisationId,
        createdByUserId: userId,
        ...listingWriteData(data),
        statusHistory: { create: { actorUserId: userId, toStatus: "DRAFT" } },
      },
      include: listingInclude,
    });
    await record(tx, organisationId, userId, "listing.created", "listing", listing.id, {
      propertyId: listing.propertyId,
      unitId: listing.unitId,
      listingType: listing.listingType,
    });
    return listing;
  });
}

function editableListingInput(listing: Prisma.ListingGetPayload<{ include: typeof listingInclude }>) {
  return {
    propertyId: listing.propertyId,
    unitId: listing.unitId,
    listingType: listing.listingType,
    category: listing.category,
    title: listing.title,
    publicDescription: listing.publicDescription,
    askingAmountMinor: listing.askingAmountMinor?.toString() ?? null,
    rentAmountMinor: listing.rentAmountMinor?.toString() ?? null,
    currencyCode: listing.currencyCode,
    frequency: listing.frequency,
    availableFrom: listing.availableFrom,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms?.toNumber() ?? null,
    sizeSqm: listing.sizeSqm?.toNumber() ?? null,
    countryCode: listing.countryCode,
    region: listing.region,
    city: listing.city,
    district: listing.district,
    locality: listing.locality,
    publicLocationLabel: listing.publicLocationLabel,
    mapLatitude: listing.mapLatitude?.toNumber() ?? null,
    mapLongitude: listing.mapLongitude?.toNumber() ?? null,
    mapPrecision: listing.mapPrecision,
    contactName: listing.contactName,
    contactEmail: listing.contactEmail,
    contactPhone: listing.contactPhone,
    showContactEmail: listing.showContactEmail,
    showContactPhone: listing.showContactPhone,
    enquiryEnabled: listing.enquiryEnabled,
    privateNotes: listing.privateNotes,
    amenities: listing.amenities.map(({ key, label, category, metadata }) => ({
      key, label, category, ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { metadata } : {}),
    })),
    media: listing.media.map((item) => ({
      type: item.type,
      publicUrl: item.publicUrl,
      storageKey: item.storageKey,
      mimeType: item.mimeType,
      title: item.title,
      altText: item.altText,
      sortOrder: item.sortOrder,
      width: item.width ?? undefined,
      height: item.height ?? undefined,
      durationSeconds: item.durationSeconds ?? undefined,
      fileSizeBytes: item.fileSizeBytes === null ? undefined : item.fileSizeBytes.toNumber(),
      checksum: item.checksum,
      ...(item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? { metadata: item.metadata } : {}),
    })),
  };
}

export async function updateListing(userId: string, organisationId: string, listingId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.listingManage);
  listingId = listingIdSchema.parse(listingId);
  const patch = updateListingSchema.parse(input);
  const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return db.$transaction(async (tx) => {
    const current = await tx.listing.findFirst({ where: { id: listingId, organisationId }, include: listingInclude });
    if (!current) throw notFound();
    if (!["DRAFT", "REJECTED", "PAUSED"].includes(current.status)) {
      throw new AppError("LISTING_NOT_EDITABLE", 409, "Only draft, rejected, or paused listings can be edited.");
    }
    const data = createListingSchema.parse({ ...editableListingInput(current), ...definedPatch });
    await validateAsset(tx, organisationId, data.propertyId, data.unitId, data.countryCode, data.currencyCode);
    const { amenities, media, ...fields } = listingWriteData(data);
    await tx.listingAmenity.deleteMany({ where: { listingId } });
    await tx.listingMedia.deleteMany({ where: { listingId } });
    const listing = await tx.listing.update({
      where: { id: listingId },
      data: { ...fields, amenities, media },
      include: listingInclude,
    });
    await record(tx, organisationId, userId, "listing.updated", "listing", listing.id, {
      changedFields: Object.keys(definedPatch).sort(),
    });
    return listing;
  });
}

export async function getListing(userId: string, organisationId: string, listingId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.listingRead);
  listingId = listingIdSchema.parse(listingId);
  const listing = await db.listing.findFirst({ where: { id: listingId, organisationId }, include: listingInclude });
  if (!listing) throw notFound();
  return { ...listing, evidenceReady: listing.verificationEvidence.length > 0 };
}

export async function listListings(userId: string, organisationId: string, query: unknown = {}) {
  await requirePermission(userId, organisationId, PERMISSIONS.listingRead);
  const filters = listingManagementListSchema.parse(query);
  const where: Prisma.ListingWhereInput = {
    organisationId,
    ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
    ...(filters.unitId ? { unitId: filters.unitId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.listingType ? { listingType: filters.listingType } : {}),
  };
  const [items, total] = await db.$transaction([
    db.listing.findMany({
      where,
      include: listingInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.listing.count({ where }),
  ]);
  return {
    items,
    pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) },
  };
}

export async function getListingHistory(userId: string, organisationId: string, listingId: string) {
  const listing = await getListing(userId, organisationId, listingId);
  return {
    listingId: listing.id,
    status: listing.status,
    verificationStatus: listing.verificationStatus,
    statusHistory: listing.statusHistory,
    verificationHistory: listing.verificationHistory,
  };
}

const listingTransitions: Record<ListingStatus, ListingStatus[]> = {
  DRAFT: ["PENDING_REVIEW", "ARCHIVED"],
  PENDING_REVIEW: ["PUBLISHED", "REJECTED", "DRAFT", "ARCHIVED"],
  PUBLISHED: ["PAUSED", "RESERVED", "RENTED", "ARCHIVED"],
  PAUSED: ["PUBLISHED", "RESERVED", "RENTED", "ARCHIVED", "DRAFT"],
  RESERVED: ["PUBLISHED", "PAUSED", "RENTED", "ARCHIVED"],
  RENTED: ["ARCHIVED"],
  ARCHIVED: [],
  REJECTED: ["DRAFT", "ARCHIVED"],
};

async function ensurePublicationReady(tx: Tx, listing: Prisma.ListingGetPayload<{ include: typeof listingInclude }>) {
  if (listing.verificationStatus !== "VERIFIED") {
    throw new AppError("LISTING_NOT_VERIFIED", 409, "A listing must be verified before publication.");
  }
  if (!listing.media.some(({ type }) => type === "PHOTO")) {
    throw new AppError("LISTING_PHOTO_REQUIRED", 409, "At least one public photo is required before publication.");
  }
  if (!await isAssetAvailable(tx, listing)) {
    throw new AppError("ASSET_NOT_AVAILABLE", 409, "The managed property or unit is not actually available.");
  }
  const conflictingListing = await tx.listing.findFirst({
    where: {
      id: { not: listing.id },
      propertyId: listing.propertyId,
      status: { in: ["PUBLISHED", "PAUSED", "RESERVED"] },
      OR: listing.unitId
        ? [{ unitId: listing.unitId }, { unitId: null }]
        : [{}],
    },
    select: { id: true },
  });
  if (conflictingListing) {
    throw new AppError("ACTIVE_LISTING_EXISTS", 409, "This managed asset already has an active listing.");
  }
}

export async function transitionListing(userId: string, organisationId: string, listingId: string, input: unknown) {
  listingId = listingIdSchema.parse(listingId);
  const data = listingTransitionSchema.parse(input);
  await requirePermission(
    userId,
    organisationId,
    data.status === "PUBLISHED" || data.status === "REJECTED" ? PERMISSIONS.listingPublish : PERMISSIONS.listingManage,
  );
  return db.$transaction(async (tx) => {
    const listing = await tx.listing.findFirst({ where: { id: listingId, organisationId }, include: listingInclude });
    if (!listing) throw notFound();
    if (!listingTransitions[listing.status].includes(data.status)) {
      throw new AppError("INVALID_LISTING_TRANSITION", 409, `A ${listing.status} listing cannot transition to ${data.status}.`);
    }
    if (data.status === "PENDING_REVIEW" && !listing.media.some(({ type }) => type === "PHOTO")) {
      throw new AppError("LISTING_PHOTO_REQUIRED", 409, "At least one public photo is required before review.");
    }
    if (data.status === "PUBLISHED" && listing.status === "RESERVED" && listing.unitId) {
      const released = await tx.unit.updateMany({
        where: { id: listing.unitId, propertyId: listing.propertyId, status: "RESERVED", archivedAt: null },
        data: { status: "AVAILABLE" },
      });
      if (released.count !== 1) throw new AppError("ASSET_NOT_AVAILABLE", 409, "The reserved unit is no longer available.");
    }
    if (data.status === "PUBLISHED") await ensurePublicationReady(tx, listing);
    if (data.status === "RENTED" && listing.listingType !== "RENT") {
      throw new AppError("INVALID_LISTING_TRANSITION", 409, "Only rental listings can be marked rented.");
    }
    const now = new Date();
    if (listing.unitId) {
      if (data.status === "RESERVED") {
        const changed = await tx.unit.updateMany({
          where: { id: listing.unitId, propertyId: listing.propertyId, status: "AVAILABLE", archivedAt: null },
          data: { status: "RESERVED" },
        });
        if (changed.count !== 1) throw new AppError("ASSET_NOT_AVAILABLE", 409, "The unit is no longer available.");
      }
      if (data.status === "RENTED") {
        await tx.unit.update({ where: { id: listing.unitId }, data: { status: "OCCUPIED" } });
      }
      if (listing.status === "RESERVED" && ["PUBLISHED", "ARCHIVED"].includes(data.status)) {
        await tx.unit.updateMany({ where: { id: listing.unitId, status: "RESERVED" }, data: { status: "AVAILABLE" } });
      }
    }
    const timestamps = {
      ...(data.status === "PENDING_REVIEW" ? { submittedAt: now } : {}),
      ...(data.status === "PUBLISHED" ? { publishedAt: listing.publishedAt ?? now, pausedAt: null } : {}),
      ...(data.status === "PAUSED" ? { pausedAt: now } : {}),
      ...(data.status === "RESERVED" ? { reservedAt: now } : {}),
      ...(data.status === "RENTED" ? { rentedAt: now } : {}),
      ...(data.status === "ARCHIVED" ? { archivedAt: now } : {}),
      ...(data.status === "REJECTED" ? { rejectedAt: now } : {}),
    };
    const updated = await tx.listing.update({
      where: { id: listing.id },
      data: {
        status: data.status,
        ...timestamps,
        statusHistory: {
          create: { actorUserId: userId, fromStatus: listing.status, toStatus: data.status, note: data.note },
        },
      },
      include: listingInclude,
    });
    const payload = { fromStatus: listing.status, toStatus: data.status, propertyId: listing.propertyId, unitId: listing.unitId };
    await record(tx, organisationId, userId, "listing.status_changed", "listing", listing.id, payload);
    await record(tx, organisationId, userId, `listing.${data.status.toLowerCase()}`, "listing", listing.id, payload);
    return updated;
  });
}

const verificationTransitions: Record<ListingVerificationStatus, ListingVerificationStatus[]> = {
  UNVERIFIED: ["PENDING"],
  PENDING: ["VERIFIED", "REJECTED", "SUSPENDED"],
  VERIFIED: ["SUSPENDED"],
  REJECTED: ["PENDING"],
  SUSPENDED: ["PENDING"],
};

export async function updateListingVerification(
  userId: string,
  organisationId: string,
  listingId: string,
  input: unknown,
) {
  listingId = listingIdSchema.parse(listingId);
  const data = listingVerificationSchema.parse(input);
  await requirePermission(
    userId,
    organisationId,
    data.status === "PENDING" ? PERMISSIONS.listingManage : PERMISSIONS.listingVerify,
  );
  return db.$transaction(async (tx) => {
    const listing = await tx.listing.findFirst({ where: { id: listingId, organisationId }, include: listingInclude });
    if (!listing) throw notFound();
    if (!verificationTransitions[listing.verificationStatus].includes(data.status)) {
      throw new AppError("INVALID_VERIFICATION_TRANSITION", 409, "The listing verification cannot transition to that status.");
    }
    if (data.status === "PENDING") {
      const newEvidence = data.evidence ?? [];
      const currentUsable = listing.verificationEvidence.filter(({ expiresAt }) => !expiresAt || expiresAt > new Date()).length;
      if (!newEvidence.length && !currentUsable) {
        throw new AppError("VERIFICATION_EVIDENCE_REQUIRED", 422, "Verification evidence metadata is required.");
      }
      if (newEvidence.length) {
        await tx.listingVerificationEvidence.createMany({
          data: newEvidence.map((evidence) => ({
            listingId,
            submittedByUserId: userId,
            type: evidence.type,
            privateReference: evidence.privateReference,
            metadata: evidence.metadata ? json(evidence.metadata) : undefined,
            expiresAt: evidence.expiresAt,
          })),
        });
      }
    }
    const pause = data.status === "SUSPENDED" && listing.status === "PUBLISHED";
    const now = new Date();
    const updated = await tx.listing.update({
      where: { id: listing.id },
      data: {
        verificationStatus: data.status,
        evidenceReady: data.status === "PENDING" || data.status === "VERIFIED",
        verificationHistory: {
          create: {
            actorUserId: userId,
            fromStatus: listing.verificationStatus,
            toStatus: data.status,
            note: data.note,
          },
        },
        ...(pause ? {
          status: "PAUSED",
          pausedAt: now,
          statusHistory: {
            create: { actorUserId: userId, fromStatus: "PUBLISHED", toStatus: "PAUSED", note: "Verification suspended." },
          },
        } : {}),
      },
      include: listingInclude,
    });
    const eventName = data.status === "PENDING"
      ? "listing.verification_submitted"
      : `listing.verification_${data.status.toLowerCase()}`;
    await record(tx, organisationId, userId, eventName, "listing", listing.id, {
      fromStatus: listing.verificationStatus,
      toStatus: data.status,
      evidenceReady: updated.evidenceReady,
    });
    if (pause) {
      await record(tx, organisationId, userId, "listing.status_changed", "listing", listing.id, {
        fromStatus: "PUBLISHED",
        toStatus: "PAUSED",
        reason: "verification_suspended",
      });
    }
    return updated;
  });
}

type ListingSearchRow = { id: string; total: bigint };

function publicSearchSql(filters: ReturnType<typeof publicListingSearchSchema.parse>) {
  const region = filters.region ?? filters.state;
  const price = Prisma.sql`COALESCE(l."rentAmountMinor", l."askingAmountMinor")`;
  const conditions: Prisma.Sql[] = [
    Prisma.sql`l."status" = 'PUBLISHED'::"ListingStatus"`,
    Prisma.sql`l."verificationStatus" = 'VERIFIED'::"ListingVerificationStatus"`,
    Prisma.sql`p."archivedAt" IS NULL AND p."status" = 'ACTIVE'::"PropertyStatus"`,
    Prisma.sql`(
      (l."unitId" IS NOT NULL
        AND u."archivedAt" IS NULL
        AND u."status" = 'AVAILABLE'::"UnitStatus"
        AND NOT EXISTS (
          SELECT 1 FROM "Lease" lease
          WHERE lease."unitId" = l."unitId"
            AND lease."archivedAt" IS NULL
            AND lease."status" IN ('ACTIVE', 'EXPIRING')
            AND lease."startDate" <= CURRENT_DATE
            AND (lease."endDate" IS NULL OR lease."endDate" >= CURRENT_DATE)
        )
      )
      OR
      (l."unitId" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "Unit" pu
          WHERE pu."propertyId" = l."propertyId"
            AND pu."archivedAt" IS NULL
            AND pu."status" <> 'AVAILABLE'::"UnitStatus"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "Lease" lease
          WHERE lease."propertyId" = l."propertyId"
            AND lease."archivedAt" IS NULL
            AND lease."status" IN ('ACTIVE', 'EXPIRING')
            AND lease."startDate" <= CURRENT_DATE
            AND (lease."endDate" IS NULL OR lease."endDate" >= CURRENT_DATE)
        )
      )
    )`,
  ];
  if (filters.q) conditions.push(Prisma.sql`(
    to_tsvector('simple', l."title" || ' ' || l."publicDescription" || ' ' || l."category")
      @@ plainto_tsquery('simple', ${filters.q})
  )`);
  if (filters.listingType) conditions.push(Prisma.sql`l."listingType" = ${filters.listingType}::"ListingType"`);
  if (filters.category) conditions.push(Prisma.sql`lower(l."category") = lower(${filters.category})`);
  if (filters.scope === "PROPERTY") conditions.push(Prisma.sql`l."unitId" IS NULL`);
  if (filters.scope === "UNIT") conditions.push(Prisma.sql`l."unitId" IS NOT NULL`);
  if (filters.currencyCode) conditions.push(Prisma.sql`l."currencyCode" = ${filters.currencyCode}`);
  if (filters.minPriceMinor) conditions.push(Prisma.sql`${price} >= ${filters.minPriceMinor}::numeric`);
  if (filters.maxPriceMinor) conditions.push(Prisma.sql`${price} <= ${filters.maxPriceMinor}::numeric`);
  if (filters.frequency) conditions.push(Prisma.sql`l."frequency" = ${filters.frequency}::"RentFrequency"`);
  if (filters.availableOn) conditions.push(Prisma.sql`l."availableFrom" <= ${filters.availableOn}`);
  if (filters.bedroomsMin !== undefined) conditions.push(Prisma.sql`l."bedrooms" >= ${filters.bedroomsMin}`);
  if (filters.bedroomsMax !== undefined) conditions.push(Prisma.sql`l."bedrooms" <= ${filters.bedroomsMax}`);
  if (filters.bathroomsMin !== undefined) conditions.push(Prisma.sql`l."bathrooms" >= ${filters.bathroomsMin}`);
  if (filters.bathroomsMax !== undefined) conditions.push(Prisma.sql`l."bathrooms" <= ${filters.bathroomsMax}`);
  if (filters.sizeMinSqm !== undefined) conditions.push(Prisma.sql`l."sizeSqm" >= ${filters.sizeMinSqm}`);
  if (filters.sizeMaxSqm !== undefined) conditions.push(Prisma.sql`l."sizeSqm" <= ${filters.sizeMaxSqm}`);
  if (filters.country) conditions.push(Prisma.sql`l."countryCode" = ${filters.country}`);
  if (region) conditions.push(Prisma.sql`lower(l."region") = lower(${region})`);
  if (filters.city) conditions.push(Prisma.sql`lower(l."city") = lower(${filters.city})`);
  if (filters.district) conditions.push(Prisma.sql`lower(l."district") = lower(${filters.district})`);
  for (const amenity of [...new Set(filters.amenities ?? [])]) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ListingAmenity" amenity
      WHERE amenity."listingId" = l."id" AND amenity."key" = ${amenity}
    )`);
  }
  for (const mediaType of [...new Set(filters.mediaTypes ?? [])]) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ListingMedia" media
      WHERE media."listingId" = l."id" AND media."type" = ${mediaType}::"ListingMediaType"
    )`);
  }
  const offset = (filters.page - 1) * filters.pageSize;
  return Prisma.sql`
    SELECT l."id", count(*) OVER() AS total
    FROM "Listing" l
    JOIN "Property" p ON p."id" = l."propertyId"
    LEFT JOIN "Unit" u ON u."id" = l."unitId"
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY l."publishedAt" DESC NULLS LAST, l."availableFrom" ASC, l."id" ASC
    LIMIT ${filters.pageSize} OFFSET ${offset}
  `;
}

function publicProjection(listing: Prisma.ListingGetPayload<{ include: typeof publicListingInclude }>) {
  return {
    id: listing.id,
    listingType: listing.listingType,
    scope: listing.unitId ? "UNIT" : "PROPERTY",
    category: listing.category,
    title: listing.title,
    description: listing.publicDescription,
    pricing: {
      askingAmountMinor: listing.askingAmountMinor?.toString() ?? null,
      rentAmountMinor: listing.rentAmountMinor?.toString() ?? null,
      currencyCode: listing.currencyCode,
      frequency: listing.frequency,
    },
    availability: { availableFrom: listing.availableFrom, actual: true },
    attributes: {
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms?.toString() ?? null,
      sizeSqm: listing.sizeSqm?.toString() ?? null,
    },
    location: {
      countryCode: listing.countryCode,
      region: listing.region,
      city: listing.city,
      district: listing.district,
      locality: listing.locality,
      label: listing.publicLocationLabel,
      map: {
        latitude: listing.mapLatitude?.toString() ?? null,
        longitude: listing.mapLongitude?.toString() ?? null,
        precision: listing.mapPrecision,
        geocodingRequired: listing.mapLatitude === null,
        credentialsRequired: listing.mapLatitude === null && !isRealGeocodingProviderConfigured(),
      },
    },
    amenities: listing.amenities.map(({ key, label, category, metadata }) => ({ key, label, category, metadata })),
    media: listing.media
      .filter((media) => media.classification === "PUBLIC")
      .map((media) => ({
        id: media.id,
        type: media.type,
        url: media.publicUrl,
        mimeType: media.mimeType,
        title: media.title,
        altText: media.altText,
        sortOrder: media.sortOrder,
        isCover: media.isCover,
        width: media.width,
        height: media.height,
        durationSeconds: media.durationSeconds,
        fileSizeBytes: media.fileSizeBytes?.toString() ?? null,
        checksum: media.checksum,
        metadata: media.metadata,
      })),
    contact: {
      name: listing.contactName,
      email: listing.showContactEmail ? listing.contactEmail : null,
      phone: listing.showContactPhone ? listing.contactPhone : null,
      enquiryEnabled: listing.enquiryEnabled,
    },
    verification: { status: listing.verificationStatus, evidenceReady: listing.evidenceReady },
    publishedAt: listing.publishedAt,
  };
}

export async function searchPublicListings(query: unknown = {}) {
  const filters = publicListingSearchSchema.parse(query);
  const rows = await db.$queryRaw<ListingSearchRow[]>(publicSearchSql(filters));
  const listings = rows.length
    ? await db.listing.findMany({ where: { id: { in: rows.map(({ id }) => id) } }, include: publicListingInclude })
    : [];
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  const items = rows.flatMap(({ id }) => {
    const listing = byId.get(id);
    return listing ? [publicProjection(listing)] : [];
  });
  let total = rows.length ? Number(rows[0].total) : 0;
  if (!rows.length && filters.page > 1) {
    const first = await db.$queryRaw<ListingSearchRow[]>(publicSearchSql({ ...filters, page: 1, pageSize: 1 }));
    total = Number(first[0]?.total ?? 0);
  }
  return {
    items,
    pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) },
    meta: {
      rateLimit: PUBLIC_LISTING_RATE_LIMIT,
      amenityMatching: "intersection",
      availability: "managed-asset-and-active-lease-linked",
      map: { provider: getActiveGeocodingAdapter().key, credentialsRequired: !isRealGeocodingProviderConfigured(), countryNeutral: true },
    },
  };
}

export async function getPublicListing(listingId: string) {
  listingId = listingIdSchema.parse(listingId);
  const listing = await db.listing.findFirst({
    where: { id: listingId, status: "PUBLISHED", verificationStatus: "VERIFIED" },
    include: publicListingInclude,
  });
  if (!listing || !await isAssetAvailable(db, listing)) throw notFound();
  return { listing: publicProjection(listing), meta: { rateLimit: PUBLIC_LISTING_RATE_LIMIT } };
}

const leadInclude = {
  listing: { select: { id: true, title: true, listingType: true, status: true } },
  user: { select: { id: true, displayName: true, email: true } },
  assignee: { select: { id: true, user: { select: { id: true, displayName: true, email: true } } } },
  history: { orderBy: { createdAt: "asc" as const } },
  activities: { orderBy: { createdAt: "asc" as const } },
  rentalApplications: {
    select: { id: true, applicantId: true, status: true, submittedAt: true, decisionAt: true, tenantOrganisationId: true, leaseId: true },
    orderBy: { createdAt: "desc" as const },
  },
  viewingRequests: {
    include: { preferredTimes: { orderBy: { startsAt: "asc" as const } }, history: { orderBy: { createdAt: "asc" as const } } },
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.MarketplaceLeadInclude;

export async function createMarketplaceLead(listingId: string, userId: string | undefined, input: unknown) {
  listingId = listingIdSchema.parse(listingId);
  const data = createMarketplaceLeadSchema.parse(input);
  return db.$transaction(async (tx) => {
    const listing = await tx.listing.findFirst({
      where: { id: listingId, status: "PUBLISHED", verificationStatus: "VERIFIED", enquiryEnabled: true },
    });
    if (!listing || !await isAssetAvailable(tx, listing)) throw notFound();
    const lead = await tx.marketplaceLead.create({
      data: {
        organisationId: listing.organisationId,
        listingId,
        userId,
        ...data,
        history: { create: { actorUserId: userId, toStatus: "NEW" } },
        activities: { create: { actorUserId: userId, type: "lead.created" } },
      },
    });
    await record(tx, listing.organisationId, userId, "listing.lead_created", "marketplace_lead", lead.id, {
      listingId,
      authenticated: Boolean(userId),
      hasEmail: Boolean(lead.email),
      hasPhone: Boolean(lead.phone),
    });
    await tx.domainEvent.create({
      data: {
        organisationId: listing.organisationId,
        name: "marketplace.lead_created",
        aggregateType: "marketplace_lead",
        aggregateId: lead.id,
        payload: json({ listingId, authenticated: Boolean(userId) }),
      },
    });
    return { id: lead.id, listingId, status: lead.status, createdAt: lead.createdAt };
  });
}

export async function listMarketplaceLeads(userId: string, organisationId: string, query: unknown = {}) {
  await requirePermission(userId, organisationId, PERMISSIONS.listingLeadRead);
  const filters = marketplaceLeadListSchema.parse(query);
  const where: Prisma.MarketplaceLeadWhereInput = {
    organisationId,
    ...(filters.listingId ? { listingId: filters.listingId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.assigneeMemberId ? { assigneeMemberId: filters.assigneeMemberId } : {}),
  };
  const [items, total] = await db.$transaction([
    db.marketplaceLead.findMany({
      where,
      include: leadInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.marketplaceLead.count({ where }),
  ]);
  return {
    items,
    pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) },
  };
}

export async function getMarketplaceLead(userId: string, organisationId: string, leadId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.listingLeadRead);
  leadId = leadIdSchema.parse(leadId);
  const lead = await db.marketplaceLead.findFirst({ where: { id: leadId, organisationId }, include: leadInclude });
  if (!lead) throw notFound();
  return lead;
}

const leadTransitions: Record<MarketplaceLeadStatus, MarketplaceLeadStatus[]> = {
  NEW: ["CONTACTED", "QUALIFIED", "VIEWING_SCHEDULED", "APPLICATION_STARTED", "CLOSED", "LOST"],
  CONTACTED: ["QUALIFIED", "VIEWING_SCHEDULED", "APPLICATION_STARTED", "CLOSED", "LOST"],
  QUALIFIED: ["VIEWING_SCHEDULED", "APPLICATION_STARTED", "CLOSED", "LOST"],
  VIEWING_SCHEDULED: ["CONTACTED", "QUALIFIED", "VIEWING_COMPLETED", "APPLICATION_STARTED", "CLOSED", "LOST"],
  VIEWING_COMPLETED: ["APPLICATION_STARTED", "CLOSED", "LOST"],
  APPLICATION_STARTED: ["APPLICATION_SUBMITTED", "CLOSED", "LOST"],
  APPLICATION_SUBMITTED: ["CLOSED", "LOST"],
  CLOSED: [],
  LOST: [],
};

export async function updateMarketplaceLead(
  userId: string,
  organisationId: string,
  leadId: string,
  input: unknown,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.listingLeadManage);
  leadId = leadIdSchema.parse(leadId);
  const data = updateMarketplaceLeadSchema.parse(input);
  return db.$transaction(async (tx) => {
    const lead = await tx.marketplaceLead.findFirst({ where: { id: leadId, organisationId } });
    if (!lead) throw notFound();
    if (data.status && !leadTransitions[lead.status].includes(data.status)) {
      throw new AppError("INVALID_LEAD_TRANSITION", 409, "The lead cannot transition to that status.");
    }
    if (data.assigneeMemberId) {
      const assignee = await tx.organisationMember.findFirst({
        where: { id: data.assigneeMemberId, organisationId, status: "ACTIVE", archivedAt: null },
        select: { id: true },
      });
      if (!assignee) throw new AppError("INVALID_LEAD_ASSIGNEE", 422, "The assignee must be an active member of this organisation.");
    }
    const now = new Date();
    const updated = await tx.marketplaceLead.update({
      where: { id: lead.id },
      data: {
        ...(data.privateNotes !== undefined ? { privateNotes: data.privateNotes } : {}),
        ...(data.assigneeMemberId !== undefined ? { assigneeMemberId: data.assigneeMemberId } : {}),
        lastActivityAt: now,
        activities: {
          create: {
            actorUserId: userId,
            type: data.status ? `lead.${data.status.toLowerCase()}` : "lead.updated",
            note: data.note,
            metadata: json({
              ...(data.assigneeMemberId !== undefined ? { assigneeMemberId: data.assigneeMemberId } : {}),
              ...(data.privateNotes !== undefined ? { notesUpdated: true } : {}),
            }),
          },
        },
        ...(data.status ? {
          status: data.status,
          contactedAt: data.status === "CONTACTED" ? now : lead.contactedAt,
          qualifiedAt: data.status === "QUALIFIED" ? now : lead.qualifiedAt,
          viewingScheduledAt: data.status === "VIEWING_SCHEDULED" ? now : lead.viewingScheduledAt,
          viewingCompletedAt: data.status === "VIEWING_COMPLETED" ? now : lead.viewingCompletedAt,
          applicationStartedAt: data.status === "APPLICATION_STARTED" ? now : lead.applicationStartedAt,
          applicationSubmittedAt: data.status === "APPLICATION_SUBMITTED" ? now : lead.applicationSubmittedAt,
          closedAt: data.status === "CLOSED" ? now : lead.closedAt,
          lostAt: data.status === "LOST" ? now : lead.lostAt,
          history: { create: { actorUserId: userId, fromStatus: lead.status, toStatus: data.status, note: data.note } },
        } : {}),
      },
      include: leadInclude,
    });
    await record(tx, organisationId, userId, data.status ? "listing.lead_status_changed" : "listing.lead_updated", "marketplace_lead", lead.id, {
      listingId: lead.listingId,
      ...(data.status ? { fromStatus: lead.status, toStatus: data.status } : {}),
    });
    if (data.status === "QUALIFIED") {
      await record(tx, organisationId, userId, "lead.qualified", "marketplace_lead", lead.id, {
        listingId: lead.listingId,
      });
    }
    return updated;
  });
}

const viewingInclude = {
  listing: { select: { id: true, title: true, listingType: true, status: true } },
  lead: { select: { id: true, name: true, email: true, phone: true, status: true } },
  assignee: { select: { id: true, user: { select: { id: true, displayName: true, email: true } } } },
  preferredTimes: { orderBy: { startsAt: "asc" as const } },
  history: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.ViewingRequestInclude;

export async function createViewingRequest(
  listingId: string,
  userId: string | undefined,
  input: unknown,
) {
  listingId = listingIdSchema.parse(listingId);
  const data = createViewingRequestSchema.parse(input);
  if (data.preferredTimes.some(({ startsAt }) => startsAt <= new Date())) {
    throw new AppError("VIEWING_TIME_IN_PAST", 422, "Preferred viewing times must be in the future.");
  }
  return db.$transaction(async (tx) => {
    const listing = await tx.listing.findFirst({
      where: { id: listingId, status: "PUBLISHED", verificationStatus: "VERIFIED", enquiryEnabled: true },
    });
    if (!listing || !await isAssetAvailable(tx, listing)) throw notFound();
    const lead = await tx.marketplaceLead.findFirst({
      where: { id: data.leadId, listingId, organisationId: listing.organisationId, status: { notIn: ["CLOSED", "LOST"] } },
    });
    if (!lead) throw notFound();
    if (lead.userId && lead.userId !== userId) throw notFound();
    const viewing = await tx.viewingRequest.create({
      data: {
        organisationId: listing.organisationId,
        listingId,
        leadId: lead.id,
        createdByUserId: userId,
        requesterNote: data.requesterNote,
        preferredTimes: { create: data.preferredTimes },
        history: { create: { actorUserId: userId, toStatus: "REQUESTED" } },
      },
      include: { preferredTimes: { orderBy: { startsAt: "asc" } } },
    });
    if (["NEW", "CONTACTED", "QUALIFIED"].includes(lead.status)) {
      const now = new Date();
      await tx.marketplaceLead.update({
        where: { id: lead.id },
        data: {
          status: "VIEWING_SCHEDULED",
          viewingScheduledAt: now,
          lastActivityAt: now,
          history: {
            create: { actorUserId: userId, fromStatus: lead.status, toStatus: "VIEWING_SCHEDULED", note: "Viewing requested." },
          },
          activities: { create: { actorUserId: userId, type: "lead.viewing_scheduled", note: "Viewing requested." } },
        },
      });
    }
    await record(tx, listing.organisationId, userId, "listing.viewing_requested", "viewing_request", viewing.id, {
      listingId,
      leadId: lead.id,
      authenticated: Boolean(userId),
    });
    await record(tx, listing.organisationId, userId, "viewing.requested", "viewing_request", viewing.id, {
      listingId,
      leadId: lead.id,
      authenticated: Boolean(userId),
    });
    return {
      id: viewing.id,
      listingId,
      leadId: lead.id,
      status: viewing.status,
      preferredTimes: viewing.preferredTimes,
      createdAt: viewing.createdAt,
    };
  });
}

export async function listViewingRequests(userId: string, organisationId: string, query: unknown = {}) {
  await requirePermission(userId, organisationId, PERMISSIONS.listingViewingRead);
  const filters = viewingRequestListSchema.parse(query);
  const where: Prisma.ViewingRequestWhereInput = {
    organisationId,
    ...(filters.listingId ? { listingId: filters.listingId } : {}),
    ...(filters.leadId ? { leadId: filters.leadId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.assigneeMemberId ? { assigneeMemberId: filters.assigneeMemberId } : {}),
  };
  const [items, total] = await db.$transaction([
    db.viewingRequest.findMany({
      where,
      include: viewingInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.viewingRequest.count({ where }),
  ]);
  return {
    items,
    pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) },
  };
}

export async function getViewingRequest(userId: string, organisationId: string, viewingRequestId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.listingViewingRead);
  viewingRequestId = viewingRequestIdSchema.parse(viewingRequestId);
  const viewing = await db.viewingRequest.findFirst({
    where: { id: viewingRequestId, organisationId },
    include: viewingInclude,
  });
  if (!viewing) throw notFound();
  return viewing;
}

const viewingTransitions: Record<ViewingRequestStatus, ViewingRequestStatus[]> = {
  REQUESTED: ["CONFIRMED", "RESCHEDULED", "CANCELLED"],
  CONFIRMED: ["RESCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"],
  RESCHEDULED: ["CONFIRMED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export async function updateViewingRequest(
  userId: string,
  organisationId: string,
  viewingRequestId: string,
  input: unknown,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.listingViewingManage);
  viewingRequestId = viewingRequestIdSchema.parse(viewingRequestId);
  const data = updateViewingRequestSchema.parse(input);
  return db.$transaction(async (tx) => {
    const viewing = await tx.viewingRequest.findFirst({ where: { id: viewingRequestId, organisationId } });
    if (!viewing) throw notFound();
    if (data.status && !viewingTransitions[viewing.status].includes(data.status)) {
      throw new AppError("INVALID_VIEWING_TRANSITION", 409, "The viewing request cannot transition to that status.");
    }
    if (data.status === "CONFIRMED") {
      const startsAt = data.confirmedStartsAt ?? viewing.confirmedStartsAt;
      const endsAt = data.confirmedEndsAt ?? viewing.confirmedEndsAt;
      if (!startsAt || !endsAt || endsAt <= startsAt) {
        throw new AppError("CONFIRMED_TIME_REQUIRED", 422, "A valid confirmed viewing time is required.");
      }
    }
    if (data.assigneeMemberId) {
      const assignee = await tx.organisationMember.findFirst({
        where: { id: data.assigneeMemberId, organisationId, status: "ACTIVE", archivedAt: null },
        select: { id: true },
      });
      if (!assignee) throw new AppError("INVALID_VIEWING_ASSIGNEE", 422, "The assignee must be an active member of this organisation.");
    }
    const updated = await tx.viewingRequest.update({
      where: { id: viewing.id },
      data: {
        ...(data.assigneeMemberId !== undefined ? { assigneeMemberId: data.assigneeMemberId } : {}),
        ...(data.privateNotes !== undefined ? { privateNotes: data.privateNotes } : {}),
        ...(data.outcome !== undefined ? { outcome: data.outcome } : {}),
        ...(data.confirmedStartsAt !== undefined ? { confirmedStartsAt: data.confirmedStartsAt } : {}),
        ...(data.confirmedEndsAt !== undefined ? { confirmedEndsAt: data.confirmedEndsAt } : {}),
        ...(data.status ? {
          status: data.status,
          confirmedAt: data.status === "CONFIRMED" ? new Date() : viewing.confirmedAt,
          rescheduledAt: data.status === "RESCHEDULED" ? new Date() : viewing.rescheduledAt,
          completedAt: data.status === "COMPLETED" ? new Date() : viewing.completedAt,
          cancelledAt: data.status === "CANCELLED" ? new Date() : viewing.cancelledAt,
          noShowAt: data.status === "NO_SHOW" ? new Date() : viewing.noShowAt,
          history: {
            create: { actorUserId: userId, fromStatus: viewing.status, toStatus: data.status, note: data.note },
          },
        } : {}),
      },
      include: viewingInclude,
    });
    await record(tx, organisationId, userId, data.status ? "listing.viewing_status_changed" : "listing.viewing_updated", "viewing_request", viewing.id, {
      listingId: viewing.listingId,
      leadId: viewing.leadId,
      ...(data.status ? { fromStatus: viewing.status, toStatus: data.status } : {}),
      assigneeReady: Boolean(updated.assigneeMemberId),
    });
    if (data.status && ["CONFIRMED", "RESCHEDULED", "COMPLETED"].includes(data.status)) {
      await record(tx, organisationId, userId, `viewing.${data.status.toLowerCase()}`, "viewing_request", viewing.id, {
        listingId: viewing.listingId,
        leadId: viewing.leadId,
        outcome: updated.outcome,
      });
    }
    if (data.status === "COMPLETED") {
      const lead = await tx.marketplaceLead.findUnique({ where: { id: viewing.leadId } });
      if (lead?.status === "VIEWING_SCHEDULED") {
        const now = new Date();
        await tx.marketplaceLead.update({
          where: { id: lead.id },
          data: {
            status: "VIEWING_COMPLETED",
            viewingCompletedAt: now,
            lastActivityAt: now,
            history: { create: { actorUserId: userId, fromStatus: lead.status, toStatus: "VIEWING_COMPLETED", note: "Viewing completed." } },
            activities: {
              create: {
                actorUserId: userId,
                type: "lead.viewing_completed",
                metadata: json({ viewingRequestId: viewing.id, outcome: updated.outcome }),
              },
            },
          },
        });
      }
    }
    return updated;
  }).then(async (updated) => {
    // Best-effort calendar sync (item 6): never let a calendar problem block viewing scheduling itself.
    if (updated.status === "CONFIRMED" && updated.confirmedStartsAt && updated.confirmedEndsAt) {
      try {
        const lead = await db.marketplaceLead.findUnique({ where: { id: updated.leadId } });
        await upsertCalendarEvent({
          organisationId,
          type: "VIEWING",
          sourceType: "VIEWING_REQUEST",
          sourceId: updated.id,
          title: `Property viewing${lead ? ` — ${lead.name}` : ""}`,
          startAt: updated.confirmedStartsAt,
          endAt: updated.confirmedEndsAt,
          timezone: "Africa/Accra",
          attendees: lead ? [{ name: lead.name, email: lead.email ?? undefined, role: "PROSPECT" }] : [],
          actorUserId: userId,
        });
      } catch (error) {
        console.error("Calendar sync failed for viewing confirmation", error);
      }
    }
    return updated;
  });
}
