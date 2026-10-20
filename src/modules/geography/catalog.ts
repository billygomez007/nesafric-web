import { z } from "zod";
import { Prisma, type GeoAreaType } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { GEO_LEVEL_LABELS } from "./config";
import { normalizeGeoName } from "./normalize";

type Client = typeof db | Prisma.TransactionClient;

/** Test fixtures are reference data for automated tests only and never offered to the public. */
const PUBLIC_VERIFICATION = { not: "TEST_FIXTURE" } as const;
const publicOnly = () => process.env.GEO_ALLOW_TEST_FIXTURES === "true" ? {} : { verificationStatus: PUBLIC_VERIFICATION };

const country = z.string().trim().length(2).transform((value) => value.toUpperCase()).refine((value) => /^[A-Z]{2}$/.test(value), "Country must be a two-letter code.");
const geoId = z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9:_.-]+$/, "Invalid id.");

export const geoIdSchema = geoId;
export const geoCountrySchema = country;

/** A short-lived per-process cache for the small, rarely changing region/district lists. */
const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}
/** Imports and admin changes clear the cache so the next read sees them. */
export function clearGeoCatalogCache() {
  cache.clear();
}

/** The countries whose geography is configured. Unconfigured countries are never offered. */
export async function listGeoCountries(client: Client = db) {
  return cached("countries", () => client.country.findMany({
    where: { isActive: true, geographyEnabled: true },
    select: { code: true, name: true },
    orderBy: { name: "asc" },
  })).then((rows) => rows.map((row) => ({ ...row, labels: GEO_LEVEL_LABELS[row.code] ?? { region: "Region", district: "District", locality: "Locality" } })));
}

export async function isGeographyEnabled(countryCode: string, client: Client = db) {
  const row = await client.country.findUnique({ where: { code: countryCode }, select: { isActive: true, geographyEnabled: true } });
  return Boolean(row?.isActive && row.geographyEnabled);
}

export async function requireGeographyEnabled(countryCode: string, client: Client = db) {
  if (!await isGeographyEnabled(countryCode, client)) throw new AppError("GEOGRAPHY_NOT_CONFIGURED", 404, "Locations are not available for this country yet.");
}

export type GeoAreaView = { id: string; type: GeoAreaType; name: string; assemblyKind: string | null; parentId: string | null; code: string | null };
const areaSelect = { id: true, type: true, name: true, assemblyKind: true, parentId: true, code: true } as const;

export async function listRegions(countryInput: string): Promise<GeoAreaView[]> {
  const countryCode = country.parse(countryInput);
  await requireGeographyEnabled(countryCode);
  return cached(`regions:${countryCode}`, () => db.geoArea.findMany({
    where: { countryCode, type: "REGION", active: true, ...publicOnly() },
    select: areaSelect,
    orderBy: { name: "asc" },
  }));
}

export async function listDistricts(regionInput: string): Promise<GeoAreaView[]> {
  const regionId = geoId.parse(regionInput);
  return cached(`districts:${regionId}`, async () => {
    const region = await db.geoArea.findFirst({ where: { id: regionId, type: "REGION", active: true, ...publicOnly() }, select: { countryCode: true } });
    if (!region) throw new AppError("GEO_AREA_NOT_FOUND", 404, "That region was not found.");
    await requireGeographyEnabled(region.countryCode);
    return db.geoArea.findMany({ where: { parentId: regionId, type: "DISTRICT", active: true, ...publicOnly() }, select: areaSelect, orderBy: { name: "asc" } });
  });
}

export const localitySearchSchema = z.object({
  country,
  regionId: geoId.optional(),
  districtId: geoId.optional(),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(200).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export type LocalityView = {
  id: string;
  name: string;
  kind: string;
  /** Districts this locality is linked to, with how each link is known. */
  districts: Array<{ id: string; name: string; relation: string; verification: string }>;
  regionNames: string[];
  matchedAlias: string | null;
};

/**
 * Localities in a country, optionally within a region or district, optionally matching a search
 * (name or alias prefix/substring). Cursor-paginated by (name, id) so large lists load lazily.
 */
export async function searchLocalities(input: unknown) {
  const filters = localitySearchSchema.parse(input);
  await requireGeographyEnabled(filters.country);
  const needle = filters.q ? normalizeGeoName(filters.q) : "";
  const like = needle ? `%${needle.replace(/[\\%_]/g, (character) => `\\${character}`)}%` : null;
  const scope = filters.districtId
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM "GeoLocalityArea" la WHERE la."localityId" = l."id" AND la."areaId" = ${filters.districtId})`
    : filters.regionId
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "GeoLocalityArea" la JOIN "GeoArea" a ON a."id" = la."areaId" WHERE la."localityId" = l."id" AND (a."id" = ${filters.regionId} OR a."parentId" = ${filters.regionId}))`
      : Prisma.empty;
  const textMatch = like
    ? Prisma.sql`AND (l."normalizedName" LIKE ${like} OR EXISTS (SELECT 1 FROM "GeoAlias" al WHERE al."localityId" = l."id" AND al."active" = true AND al."normalizedAlias" LIKE ${like}))`
    : Prisma.empty;
  const [cursorName, cursorId] = filters.cursor ? decodeCursor(filters.cursor) : [null, null];
  const after = cursorName !== null ? Prisma.sql`AND (l."name", l."id") > (${cursorName}, ${cursorId})` : Prisma.empty;
  const fixtures = process.env.GEO_ALLOW_TEST_FIXTURES === "true" ? Prisma.empty : Prisma.sql`AND l."verificationStatus" <> 'TEST_FIXTURE'`;
  const rows = await db.$queryRaw<Array<{ id: string; name: string }>>(Prisma.sql`
    SELECT l."id", l."name" FROM "GeoLocality" l
    WHERE l."countryCode" = ${filters.country} AND l."active" = true ${fixtures} ${scope} ${textMatch} ${after}
    ORDER BY l."name" ASC, l."id" ASC
    LIMIT ${filters.pageSize + 1}
  `);
  const page = rows.slice(0, filters.pageSize);
  const items = await describeLocalities(page.map((row) => row.id), needle);
  const last = page[page.length - 1];
  return { items, nextCursor: rows.length > filters.pageSize && last ? encodeCursor(last.name, last.id) : null };
}

const encodeCursor = (name: string, id: string) => Buffer.from(JSON.stringify([name, id])).toString("base64url");
function decodeCursor(cursor: string): [string, string] | [null, null] {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "string" ? [value[0], value[1]] : [null, null];
  } catch {
    return [null, null];
  }
}

/** Public descriptions of localities, in the order given (district links with their status). */
export async function describeLocalities(ids: string[], needle = "", client: Client = db): Promise<LocalityView[]> {
  if (!ids.length) return [];
  const rows = await client.geoLocality.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, kind: true,
      aliases: { where: { active: true }, select: { alias: true, normalizedAlias: true } },
      areaLinks: { select: { relation: true, verificationStatus: true, area: { select: { id: true, name: true, type: true, active: true, parent: { select: { name: true } } } } } },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const districts = row.areaLinks.filter((link) => link.area.type === "DISTRICT" && link.area.active);
    const regionNames = [...new Set([
      ...districts.map((link) => link.area.parent?.name).filter((name): name is string => Boolean(name)),
      ...row.areaLinks.filter((link) => link.area.type === "REGION").map((link) => link.area.name),
    ])];
    const alias = needle && !normalizeGeoName(row.name).includes(needle) ? row.aliases.find((item) => item.normalizedAlias.includes(needle))?.alias ?? null : null;
    return [{
      id: row.id, name: row.name, kind: row.kind,
      districts: districts.map((link) => ({ id: link.area.id, name: link.area.name, relation: link.relation, verification: link.verificationStatus })),
      regionNames, matchedAlias: alias,
    }];
  });
}
