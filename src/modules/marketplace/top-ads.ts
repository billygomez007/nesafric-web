import { db } from "@/platform/database/client";
import { Prisma, type PlatformPrincipal } from "@/platform/database/generated/client";
import { AppError } from "@/platform/errors";
import { PLATFORM_PERMISSIONS, platformRoleHasPermission } from "@/platform/platform-admin/permissions";
import { isUuid } from "@/platform/validation/uuid";
import { publiclyEligibleListingIds, searchEligibleListingsForPinning } from "@/modules/listings/service";

/**
 * Top Ads: published marketplace listings a platform admin pins to the top of the public property
 * marketplace. This module only manages the selection (which listing, order, on/off, schedule).
 * Whether a pinned listing is actually shown is decided at read time by public search, which
 * applies every marketplace eligibility rule and the visitor's own filters — so a listing that is
 * unpublished, rejected, archived or let stops appearing immediately, with nothing to clean up.
 */

/** Upper bound on switched-on Top Ads: roughly one screen of results, so organic listings still show. */
export const MAX_ACTIVE_TOP_ADS = 12;

export type TopAdStatus = "active" | "scheduled" | "expired" | "paused" | "unavailable";

type TopAdInput = { listingId?: unknown; isActive?: unknown; startsAt?: unknown; endsAt?: unknown };

function requireTopAdsPermission(principal: PlatformPrincipal) {
  if (!platformRoleHasPermission(principal.role, PLATFORM_PERMISSIONS.topAdsManage)) {
    throw new AppError("FORBIDDEN", 403, "You do not have permission to manage Top Ads.");
  }
}

const inputObject = (input: unknown): TopAdInput => (typeof input === "object" && input !== null ? (input as TopAdInput) : {});

const topAdNotFound = () => new AppError("NOT_FOUND", 404, "Top Ad not found.");
const duplicateTopAd = () => new AppError("TOP_AD_DUPLICATE", 409, "This listing is already a Top Ad.");
const ineligibleListing = () =>
  new AppError(
    "TOP_AD_LISTING_INELIGIBLE",
    422,
    "Only published, verified listings that are currently live on the marketplace can be Top Ads.",
  );
const tooManyActive = () =>
  new AppError("TOP_AD_LIMIT_REACHED", 422, `Up to ${MAX_ACTIVE_TOP_ADS} Top Ads can be switched on at once. Pause or remove one first.`);

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** `undefined` = not provided; `null` = clear; otherwise a valid date. */
function parseOptionalDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new AppError("VALIDATION_ERROR", 422, `${field} must be a valid date.`);
  return date;
}

function assertSchedule(startsAt: Date | null, endsAt: Date | null) {
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new AppError("VALIDATION_ERROR", 422, "The end date must be after the start date.");
  }
}

function parseBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new AppError("VALIDATION_ERROR", 422, `${field} must be true or false.`);
  return value;
}

export function topAdStatus(item: { isActive: boolean; startsAt: Date | null; endsAt: Date | null }, eligible: boolean, now = new Date()): TopAdStatus {
  if (!eligible) return "unavailable";
  if (!item.isActive) return "paused";
  if (item.startsAt && item.startsAt > now) return "scheduled";
  if (item.endsAt && item.endsAt <= now) return "expired";
  return "active";
}

const listingSelect = {
  id: true,
  title: true,
  status: true,
  verificationStatus: true,
  listingType: true,
  category: true,
  city: true,
  region: true,
  publicLocationLabel: true,
  currencyCode: true,
  rentAmountMinor: true,
  askingAmountMinor: true,
  frequency: true,
  publishedAt: true,
  organisation: { select: { name: true } },
  marketplaceProfessional: { select: { displayName: true } },
  media: { where: { classification: "PUBLIC" }, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], take: 1, select: { publicUrl: true, altText: true } },
} satisfies Prisma.ListingSelect;

type ListingSummarySource = Prisma.ListingGetPayload<{ select: typeof listingSelect }>;

function listingSummary(listing: ListingSummarySource) {
  return {
    id: listing.id,
    title: listing.title,
    status: listing.status,
    verificationStatus: listing.verificationStatus,
    listingType: listing.listingType,
    category: listing.category,
    location: listing.publicLocationLabel ?? [listing.city, listing.region].filter(Boolean).join(", "),
    price: {
      amountMinor: (listing.rentAmountMinor ?? listing.askingAmountMinor)?.toString() ?? null,
      currencyCode: listing.currencyCode,
      frequency: listing.frequency,
    },
    listedBy: listing.marketplaceProfessional?.displayName ?? listing.organisation.name,
    coverUrl: listing.media[0]?.publicUrl ?? null,
    publishedAt: listing.publishedAt,
  };
}

const topAdInclude = { listing: { select: listingSelect } } satisfies Prisma.MarketplaceTopAdInclude;
type TopAdRow = Prisma.MarketplaceTopAdGetPayload<{ include: typeof topAdInclude }>;

async function presentTopAds(rows: TopAdRow[], now = new Date()) {
  const eligible = await publiclyEligibleListingIds(rows.map((row) => row.listingId));
  return rows.map((row) => ({
    id: row.id,
    listingId: row.listingId,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    status: topAdStatus(row, eligible.has(row.listingId), now),
    listing: listingSummary(row.listing),
  }));
}

async function audit(tx: Prisma.TransactionClient, principal: PlatformPrincipal, action: string, entityId: string, metadata: Record<string, unknown>) {
  await tx.platformAuditEvent.create({
    data: { platformPrincipalId: principal.id, action, entityType: "marketplace_top_ad", entityId, metadata: metadata as Prisma.InputJsonValue },
  });
}

const ORDER = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];

export async function listTopAdsForPlatform(principal: PlatformPrincipal) {
  requireTopAdsPermission(principal);
  const rows = await db.marketplaceTopAd.findMany({ orderBy: ORDER, include: topAdInclude });
  return { items: await presentTopAds(rows), maxActive: MAX_ACTIVE_TOP_ADS };
}

/** Listings an admin may pin: live on the public marketplace right now, and not already pinned. */
export async function searchTopAdCandidates(principal: PlatformPrincipal, search: string | undefined) {
  requireTopAdsPermission(principal);
  const ids = await searchEligibleListingsForPinning(search, 20);
  if (!ids.length) return { items: [] };
  const [listings, pinned] = await Promise.all([
    db.listing.findMany({ where: { id: { in: ids } }, select: listingSelect }),
    db.marketplaceTopAd.findMany({ where: { listingId: { in: ids } }, select: { listingId: true } }),
  ]);
  const pinnedIds = new Set(pinned.map((row) => row.listingId));
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  return {
    items: ids.flatMap((id) => {
      const listing = byId.get(id);
      return listing ? [{ ...listingSummary(listing), isTopAd: pinnedIds.has(id) }] : [];
    }),
  };
}

async function assertEligible(listingId: string) {
  if (!isUuid(listingId) || !(await publiclyEligibleListingIds([listingId])).has(listingId)) throw ineligibleListing();
}

async function assertActiveCapacity(tx: Prisma.TransactionClient, excludingId?: string) {
  const active = await tx.marketplaceTopAd.count({ where: { isActive: true, ...(excludingId ? { id: { not: excludingId } } : {}) } });
  if (active >= MAX_ACTIVE_TOP_ADS) throw tooManyActive();
}

export async function createTopAd(principal: PlatformPrincipal, actorUserId: string, rawInput: unknown) {
  requireTopAdsPermission(principal);
  const input = inputObject(rawInput);
  const listingId = typeof input.listingId === "string" ? input.listingId.trim() : "";
  if (!listingId) throw new AppError("VALIDATION_ERROR", 422, "Select a published listing.");
  const isActive = parseBoolean(input.isActive, "isActive") ?? true;
  const startsAt = parseOptionalDate(input.startsAt, "Start date") ?? null;
  const endsAt = parseOptionalDate(input.endsAt, "End date") ?? null;
  assertSchedule(startsAt, endsAt);
  await assertEligible(listingId);

  try {
    const row = await db.$transaction(async (tx) => {
      if (await tx.marketplaceTopAd.findUnique({ where: { listingId }, select: { id: true } })) throw duplicateTopAd();
      if (isActive) await assertActiveCapacity(tx);
      const last = await tx.marketplaceTopAd.aggregate({ _max: { sortOrder: true } });
      const sortOrder = (last._max.sortOrder ?? -1) + 1;
      const created = await tx.marketplaceTopAd.create({
        data: { listingId, sortOrder, isActive, startsAt, endsAt, createdByUserId: actorUserId, updatedByUserId: actorUserId },
        include: topAdInclude,
      });
      await audit(tx, principal, "top_ad.added", created.id, { listingId, title: created.listing.title, sortOrder, isActive, startsAt, endsAt, actorUserId });
      return created;
    });
    return (await presentTopAds([row]))[0];
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateTopAd();
    throw error;
  }
}

export async function updateTopAd(principal: PlatformPrincipal, actorUserId: string, id: string, rawInput: unknown) {
  requireTopAdsPermission(principal);
  const input = inputObject(rawInput);
  const existing = isUuid(id) ? await db.marketplaceTopAd.findUnique({ where: { id } }) : null;
  if (!existing) throw topAdNotFound();

  const isActive = parseBoolean(input.isActive, "isActive") ?? existing.isActive;
  const startsAtInput = parseOptionalDate(input.startsAt, "Start date");
  const endsAtInput = parseOptionalDate(input.endsAt, "End date");
  const startsAt = startsAtInput === undefined ? existing.startsAt : startsAtInput;
  const endsAt = endsAtInput === undefined ? existing.endsAt : endsAtInput;
  assertSchedule(startsAt, endsAt);
  // Switching on requires the listing to be live now. Pausing or rescheduling a listing that has
  // since become ineligible stays possible; public search hides it regardless.
  const activating = isActive && !existing.isActive;
  if (activating) await assertEligible(existing.listingId);

  const row = await db.$transaction(async (tx) => {
    if (activating) await assertActiveCapacity(tx, id);
    const updated = await tx.marketplaceTopAd.update({
      where: { id },
      data: { isActive, startsAt, endsAt, updatedByUserId: actorUserId },
      include: topAdInclude,
    });
    const action = isActive !== existing.isActive ? (isActive ? "top_ad.activated" : "top_ad.paused") : "top_ad.rescheduled";
    await audit(tx, principal, action, id, {
      listingId: existing.listingId,
      from: { isActive: existing.isActive, startsAt: existing.startsAt, endsAt: existing.endsAt },
      to: { isActive, startsAt, endsAt },
      actorUserId,
    });
    return updated;
  });
  return (await presentTopAds([row]))[0];
}

/** Sets the whole order at once. `ids` must list every Top Ad exactly once, so a stale screen can't drop or duplicate a position. */
export async function reorderTopAds(principal: PlatformPrincipal, actorUserId: string, rawInput: unknown) {
  requireTopAdsPermission(principal);
  const ids = (rawInput as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length > 1000 || !ids.every((value): value is string => typeof value === "string" && isUuid(value)) || new Set(ids).size !== ids.length) {
    throw new AppError("VALIDATION_ERROR", 422, "Provide the Top Ads in their new order.");
  }
  const rows = await db.$transaction(async (tx) => {
    const current = await tx.marketplaceTopAd.findMany({ select: { id: true } });
    const known = new Set(current.map((item) => item.id));
    if (current.length !== ids.length || !ids.every((value) => known.has(value))) {
      throw new AppError("TOP_ADS_CHANGED", 409, "Top Ads changed since you opened this page. Reload and try again.");
    }
    for (const [index, itemId] of ids.entries()) {
      await tx.marketplaceTopAd.update({ where: { id: itemId }, data: { sortOrder: index, updatedByUserId: actorUserId } });
    }
    await audit(tx, principal, "top_ad.reordered", "*", { order: ids, actorUserId });
    return tx.marketplaceTopAd.findMany({ orderBy: ORDER, include: topAdInclude });
  });
  return { items: await presentTopAds(rows), maxActive: MAX_ACTIVE_TOP_ADS };
}

export async function deleteTopAd(principal: PlatformPrincipal, id: string) {
  requireTopAdsPermission(principal);
  const existing = isUuid(id) ? await db.marketplaceTopAd.findUnique({ where: { id }, select: { id: true, listingId: true, isActive: true } }) : null;
  if (!existing) throw topAdNotFound();
  await db.$transaction(async (tx) => {
    await tx.marketplaceTopAd.delete({ where: { id } });
    await audit(tx, principal, "top_ad.removed", id, { listingId: existing.listingId, wasActive: existing.isActive, actorUserId: principal.userId });
  });
  return { deleted: true };
}
