import { z } from "zod";
import type { PlatformPrincipal, Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { PLATFORM_PERMISSIONS, platformRoleHasPermission, type PlatformPermission } from "@/platform/platform-admin/permissions";
import { recordPlatformAudit } from "@/modules/platform-admin/service";
import { clearGeoCatalogCache } from "./catalog";
import { normalizeGeoName } from "./normalize";
import { resolveLocation } from "./resolve";
import { geoIdSchema } from "./schemas";

/**
 * Platform tools for shared geography: browse areas, localities and aliases, review imports and
 * unresolved locations, add aliases, deactivate (never delete) and preview merges. Every change is
 * recorded in the platform audit log. These permissions are separate from business approval and
 * listing moderation: fixing where something is approves or publishes nothing.
 */
function requireGeo(principal: PlatformPrincipal, permission: PlatformPermission) {
  if (!platformRoleHasPermission(principal.role, permission)) throw new AppError("FORBIDDEN", 403, "You do not have permission to perform this action.");
}

const listSchema = z.object({
  country: z.string().length(2).default("GH").transform((value) => value.toUpperCase()),
  type: z.enum(["REGION", "DISTRICT", "CONSTITUENCY", "LOCALITY"]).default("REGION"),
  parentId: geoIdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  includeInactive: z.coerce.boolean().default(false),
  take: z.coerce.number().int().min(1).max(200).default(50),
}).strict();

export async function listGeographyForPlatform(principal: PlatformPrincipal, input: unknown) {
  requireGeo(principal, PLATFORM_PERMISSIONS.geographyRead);
  const query = listSchema.parse(input);
  const needle = query.q ? normalizeGeoName(query.q) : null;
  if (query.type === "LOCALITY") {
    const rows = await db.geoLocality.findMany({
      where: {
        countryCode: query.country,
        ...(query.includeInactive ? {} : { active: true }),
        ...(needle ? { OR: [{ normalizedName: { contains: needle } }, { aliases: { some: { normalizedAlias: { contains: needle } } } }] } : {}),
        ...(query.parentId ? { areaLinks: { some: { areaId: query.parentId } } } : {}),
      },
      include: {
        aliases: { select: { id: true, alias: true, kind: true, active: true } },
        areaLinks: { select: { relation: true, verificationStatus: true, note: true, area: { select: { id: true, name: true, type: true } } } },
        source: { select: { id: true, name: true, licence: true } },
        _count: { select: { locations: true, coverage: true } },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: query.take,
    });
    return { type: query.type, items: rows };
  }
  const rows = await db.geoArea.findMany({
    where: {
      countryCode: query.country, type: query.type,
      ...(query.includeInactive ? {} : { active: true }),
      ...(query.parentId ? { parentId: query.parentId } : {}),
      ...(needle ? { OR: [{ normalizedName: { contains: needle } }, { aliases: { some: { normalizedAlias: { contains: needle } } } }] } : {}),
    },
    include: {
      aliases: { select: { id: true, alias: true, kind: true, active: true } },
      parent: { select: { id: true, name: true } },
      source: { select: { id: true, name: true, licence: true } },
      _count: { select: { children: true, localityLinks: true, regionLocations: true, districtLocations: true, coverage: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: query.take,
  });
  return { type: query.type, items: rows };
}

export async function listGeoSourcesForPlatform(principal: PlatformPrincipal) {
  requireGeo(principal, PLATFORM_PERMISSIONS.geographyRead);
  const [sources, runs, pending] = await Promise.all([
    db.geoDataSource.findMany({ orderBy: { id: "asc" }, include: { _count: { select: { areas: true, localities: true } } } }),
    db.geoImportRun.findMany({ orderBy: { startedAt: "desc" }, take: 30 }),
    db.geoImportChange.findMany({ where: { status: "PENDING_REVIEW" }, orderBy: { createdAt: "asc" }, take: 200 }),
  ]);
  return { sources, runs, pending };
}

const aliasSchema = z.object({
  areaId: geoIdSchema.optional(),
  localityId: geoIdSchema.optional(),
  alias: z.string().trim().min(2).max(150),
  kind: z.enum(["ALTERNATE_NAME", "FORMER_NAME", "SPELLING", "ABBREVIATION"]).default("ALTERNATE_NAME"),
}).strict().refine((value) => Boolean(value.areaId) !== Boolean(value.localityId), "Give exactly one area or locality.");

/** Adds an alias. An alias that already names another place under the same parent is refused (it would make matches ambiguous). */
export async function addGeoAlias(principal: PlatformPrincipal, input: unknown) {
  requireGeo(principal, PLATFORM_PERMISSIONS.geographyReview);
  const data = aliasSchema.parse(input);
  const normalizedAlias = normalizeGeoName(data.alias);
  const alias = await db.$transaction(async (tx) => {
    if (data.areaId) {
      const area = await tx.geoArea.findUnique({ where: { id: data.areaId } });
      if (!area) throw notFound();
      const clash = await tx.geoArea.findFirst({ where: { id: { not: area.id }, countryCode: area.countryCode, type: area.type, parentId: area.parentId, OR: [{ normalizedName: normalizedAlias }, { aliases: { some: { normalizedAlias, active: true } } }] } });
      if (clash) throw new AppError("GEO_ALIAS_CLASH", 409, `"${data.alias}" already names ${clash.name}.`);
    } else {
      const locality = await tx.geoLocality.findUnique({ where: { id: data.localityId! } });
      if (!locality) throw notFound();
    }
    return tx.geoAlias.upsert({
      where: data.areaId ? { areaId_normalizedAlias: { areaId: data.areaId, normalizedAlias } } : { localityId_normalizedAlias: { localityId: data.localityId!, normalizedAlias } },
      create: { areaId: data.areaId ?? null, localityId: data.localityId ?? null, alias: data.alias, normalizedAlias, kind: data.kind, createdByUserId: principal.userId },
      update: { active: true, alias: data.alias, kind: data.kind },
    });
  });
  clearGeoCatalogCache();
  await recordPlatformAudit(principal, "geography.alias_added", data.areaId ? "geo_area" : "geo_locality", (data.areaId ?? data.localityId)!, undefined, { alias: data.alias, kind: data.kind });
  return alias;
}

const statusSchema = z.object({
  entityType: z.enum(["area", "locality", "alias"]),
  id: z.string().min(2).max(80),
  active: z.boolean(),
  reason: z.string().trim().min(3).max(500),
}).strict();

/**
 * Deactivates (or reactivates) a record. Nothing is deleted: saved locations and coverage keep
 * pointing at it, so history stays readable, but it is no longer offered or matched.
 */
export async function setGeoRecordActive(principal: PlatformPrincipal, input: unknown) {
  requireGeo(principal, PLATFORM_PERMISSIONS.geographyManage);
  const data = statusSchema.parse(input);
  const stamp = data.active ? { deactivatedAt: null, deactivationReason: null } : { deactivatedAt: new Date(), deactivationReason: data.reason };
  if (data.entityType === "area") await db.geoArea.update({ where: { id: data.id }, data: { active: data.active, ...stamp } }).catch(() => { throw notFound(); });
  else if (data.entityType === "locality") await db.geoLocality.update({ where: { id: data.id }, data: { active: data.active, ...stamp } }).catch(() => { throw notFound(); });
  else await db.geoAlias.update({ where: { id: data.id }, data: { active: data.active } }).catch(() => { throw notFound(); });
  clearGeoCatalogCache();
  await recordPlatformAudit(principal, data.active ? "geography.record_reactivated" : "geography.record_deactivated", `geo_${data.entityType}`, data.id, undefined, { reason: data.reason });
  return { id: data.id, active: data.active };
}

const mergeSchema = z.object({ entityType: z.enum(["area", "locality"]), fromId: geoIdSchema, intoId: geoIdSchema }).strict();

/**
 * Shows what merging one duplicate into another would move. Preview only: merging is done by a
 * reviewer deactivating the duplicate and adding its name as an alias, so no saved location is
 * silently re-pointed.
 */
export async function previewGeoMerge(principal: PlatformPrincipal, input: unknown) {
  requireGeo(principal, PLATFORM_PERMISSIONS.geographyRead);
  const data = mergeSchema.parse(input);
  if (data.fromId === data.intoId) throw new AppError("GEO_MERGE_SAME", 422, "Choose two different records.");
  if (data.entityType === "area") {
    const [from, into] = await Promise.all([db.geoArea.findUnique({ where: { id: data.fromId } }), db.geoArea.findUnique({ where: { id: data.intoId } })]);
    if (!from || !into) throw notFound();
    const problems = [from.type !== into.type ? "Different levels." : null, from.countryCode !== into.countryCode ? "Different countries." : null, from.parentId !== into.parentId ? "Different parents." : null].filter(Boolean);
    const [locations, coverage, links, children, aliases] = await Promise.all([
      db.geoLocation.count({ where: { OR: [{ regionId: from.id }, { districtId: from.id }] } }),
      db.geoCoverageArea.count({ where: { areaId: from.id } }),
      db.geoLocalityArea.count({ where: { areaId: from.id } }),
      db.geoArea.count({ where: { parentId: from.id } }),
      db.geoAlias.count({ where: { areaId: from.id } }),
    ]);
    return { from: { id: from.id, name: from.name }, into: { id: into.id, name: into.name }, problems, wouldMove: { locations, coverage, links, children, aliases } };
  }
  const [from, into] = await Promise.all([db.geoLocality.findUnique({ where: { id: data.fromId } }), db.geoLocality.findUnique({ where: { id: data.intoId } })]);
  if (!from || !into) throw notFound();
  const [locations, coverage, links, aliases] = await Promise.all([
    db.geoLocation.count({ where: { localityId: from.id } }),
    db.geoCoverageArea.count({ where: { localityId: from.id } }),
    db.geoLocalityArea.count({ where: { localityId: from.id } }),
    db.geoAlias.count({ where: { localityId: from.id } }),
  ]);
  return { from: { id: from.id, name: from.name }, into: { id: into.id, name: into.name }, problems: from.countryCode !== into.countryCode ? ["Different countries."] : [], wouldMove: { locations, coverage, links, aliases } };
}

const reviewSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(500).optional() }).strict();

/** Approves or rejects one change an import held for review (rename, re-parent, re-code, deactivate). */
export async function reviewGeoImportChange(principal: PlatformPrincipal, changeId: string, input: unknown) {
  requireGeo(principal, PLATFORM_PERMISSIONS.geographyManage);
  const data = reviewSchema.parse(input);
  const result = await db.$transaction(async (tx) => {
    const [change] = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "GeoImportChange" WHERE "id" = ${changeId}::uuid AND "status" = 'PENDING_REVIEW' FOR UPDATE`;
    if (!change) throw new AppError("GEO_CHANGE_NOT_PENDING", 409, "This change is no longer waiting for review.");
    const row = await tx.geoImportChange.findUniqueOrThrow({ where: { id: changeId } });
    if (data.decision === "APPROVE" && row.entityId) await applyHeldChange(tx, row.action, row.entityType, row.entityId, row.payload as Record<string, unknown>, principal.userId);
    return tx.geoImportChange.update({ where: { id: changeId }, data: { status: data.decision === "APPROVE" ? "APPLIED" : "REJECTED", reviewedByUserId: principal.userId, reviewedAt: new Date(), reason: data.note ?? row.reason } });
  });
  clearGeoCatalogCache();
  await recordPlatformAudit(principal, data.decision === "APPROVE" ? "geography.import_change_approved" : "geography.import_change_rejected", "geo_import_change", changeId, undefined, { action: result.action, entityId: result.entityId });
  return result;
}

async function applyHeldChange(tx: Prisma.TransactionClient, action: string, entityType: string, id: string, payload: Record<string, unknown>, userId: string) {
  const to = payload.to as string | null | undefined;
  if (entityType === "area") {
    const area = await tx.geoArea.findUniqueOrThrow({ where: { id } });
    if (action === "RENAME" && typeof to === "string") {
      // The old name stays findable as a former name.
      await tx.geoAlias.upsert({ where: { areaId_normalizedAlias: { areaId: id, normalizedAlias: area.normalizedName } }, create: { areaId: id, alias: area.name, normalizedAlias: area.normalizedName, kind: "FORMER_NAME", createdByUserId: userId }, update: { active: true } });
      await tx.geoArea.update({ where: { id }, data: { name: to, normalizedName: normalizeGeoName(to) } });
    } else if (action === "REPARENT") await tx.geoArea.update({ where: { id }, data: { parentId: to ?? null } });
    else if (action === "RECODE" && typeof to === "string") await tx.geoArea.update({ where: { id }, data: { code: to } });
    else if (action === "DEACTIVATE") await tx.geoArea.update({ where: { id }, data: { active: false, deactivatedAt: new Date(), deactivationReason: "No longer listed by its source (import review)." } });
  } else if (entityType === "locality") {
    const locality = await tx.geoLocality.findUniqueOrThrow({ where: { id } });
    if (action === "RENAME" && typeof to === "string") {
      await tx.geoAlias.upsert({ where: { localityId_normalizedAlias: { localityId: id, normalizedAlias: locality.normalizedName } }, create: { localityId: id, alias: locality.name, normalizedAlias: locality.normalizedName, kind: "FORMER_NAME", createdByUserId: userId }, update: { active: true } });
      await tx.geoLocality.update({ where: { id }, data: { name: to, normalizedName: normalizeGeoName(to) } });
    } else if (action === "DEACTIVATE") await tx.geoLocality.update({ where: { id }, data: { active: false, deactivatedAt: new Date(), deactivationReason: "No longer listed by its source (import review)." } });
  }
}

// ---------------------------------------------------------------------------------------------
// Unresolved locations
// ---------------------------------------------------------------------------------------------

const unresolvedSchema = z.object({
  status: z.enum(["UNRESOLVED", "AMBIGUOUS", "NEEDS_REVIEW", "PARTIAL"]).default("UNRESOLVED"),
  take: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

/**
 * Locations people could not match, or that need a second look. Reviewers see the typed text and
 * the selected areas, never the private pin, street or access notes.
 */
export async function listUnresolvedLocations(principal: PlatformPrincipal, input: unknown) {
  requireGeo(principal, PLATFORM_PERMISSIONS.geographyRead);
  const query = unresolvedSchema.parse(input);
  const rows = await db.geoLocation.findMany({
    where: { resolutionStatus: query.status },
    select: {
      id: true, purpose: true, countryCode: true, originalText: true, resolutionStatus: true, resolutionSource: true, resolutionNote: true, candidates: true, updatedAt: true,
      listingId: true, propertyId: true, marketplaceProfessionalId: true, serviceProviderId: true,
      region: { select: { id: true, name: true } }, district: { select: { id: true, name: true } }, locality: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "asc" },
    take: query.take,
  });
  return { items: rows };
}

const resolveSchema = z.object({ regionId: geoIdSchema, districtId: geoIdSchema.nullish(), localityId: geoIdSchema.nullish(), note: z.string().trim().max(500).optional() }).strict();

/**
 * A reviewer sets the areas of an unresolved location. The original text is kept, nothing is
 * approved or published, and the owner's own later edit replaces this.
 */
export async function resolveLocationForPlatform(principal: PlatformPrincipal, locationId: string, input: unknown) {
  requireGeo(principal, PLATFORM_PERMISSIONS.geographyReview);
  const data = resolveSchema.parse(input);
  const location = await db.geoLocation.findUnique({ where: { id: locationId } });
  if (!location) throw notFound();
  const resolved = await resolveLocation({ countryCode: location.countryCode, regionId: data.regionId, districtId: data.districtId ?? null, localityId: data.localityId ?? null });
  const invalid = resolved.issues.filter((issue) => !["LOCALITY_LINK_UNVERIFIED", "DISTRICT_REQUIRED"].includes(issue));
  if (invalid.length) throw new AppError("INVALID_LOCATION", 422, `The selection is not consistent (${invalid.join(", ")}).`);
  const updated = await db.geoLocation.update({
    where: { id: locationId },
    data: {
      regionId: resolved.region?.id ?? null, districtId: resolved.district?.id ?? null, localityId: resolved.locality?.id ?? null,
      resolutionStatus: resolved.status === "AMBIGUOUS" ? "AMBIGUOUS" : resolved.status, resolutionSource: "ADMIN", resolutionNote: data.note ?? null,
      candidates: undefined, reviewedByUserId: principal.userId, reviewedAt: new Date(),
    },
  });
  await recordPlatformAudit(principal, "geography.location_resolved", "geo_location", locationId, undefined, { purpose: location.purpose, status: updated.resolutionStatus, regionId: updated.regionId, districtId: updated.districtId, localityId: updated.localityId });
  return { id: updated.id, status: updated.resolutionStatus };
}
