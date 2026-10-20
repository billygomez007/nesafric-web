import { z } from "zod";
import type { GeoResolutionStatus, Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { haversineDistanceKm } from "@/modules/geocoding/service";
import { COUNTRY_BOUNDS } from "./config";
import { isGeographyEnabled } from "./catalog";
import { isValidCoordinate, normalizeGeoName, normalizeRegionQuery } from "./normalize";

type Client = typeof db | Prisma.TransactionClient;

const geoId = z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9:_.-]+$/);
const shortText = z.string().trim().max(150);

/**
 * The single input every caller (website, API, WhatsApp, backfill) passes to the resolver.
 * Ids are what a person selected; text is what they typed; `manual` is "I can't find my area".
 */
export const locationInputSchema = z.object({
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  regionId: geoId.nullish(),
  districtId: geoId.nullish(),
  localityId: geoId.nullish(),
  text: z.object({
    region: shortText.nullish(),
    district: shortText.nullish(),
    city: shortText.nullish(),
    locality: shortText.nullish(),
    freeText: z.string().trim().max(300).nullish(),
  }).strict().nullish(),
  streetOrEstate: shortText.nullish(),
  landmark: z.string().trim().max(200).nullish(),
  accessNotes: z.string().trim().max(500).nullish(),
  coordinates: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyM: z.number().int().min(0).max(100_000).nullish(),
    source: z.enum(["USER_PIN", "WHATSAPP_PIN", "GEOCODER", "LEGACY"]),
  }).strict().nullish(),
  manual: z.boolean().optional(),
}).strict();
export type LocationInput = z.input<typeof locationInputSchema>;
type ParsedInput = z.output<typeof locationInputSchema>;

export type GeoCandidate = {
  localityId: string | null;
  districtId: string | null;
  regionId: string | null;
  label: string;
  matchedBy: "name" | "alias";
};

export type GeoIssue =
  | "COUNTRY_NOT_CONFIGURED" | "UNKNOWN_ID" | "INACTIVE_RECORD" | "WRONG_COUNTRY" | "WRONG_LEVEL"
  | "DISTRICT_NOT_IN_REGION" | "LOCALITY_NOT_IN_DISTRICT" | "LOCALITY_NOT_IN_REGION" | "LOCALITY_LINK_UNVERIFIED"
  | "DISTRICT_REQUIRED" | "PIN_INVALID" | "PIN_OUTSIDE_COUNTRY" | "PIN_FAR_FROM_SELECTION";

export type ResolvedLocation = {
  status: GeoResolutionStatus;
  countryCode: string;
  region: { id: string; name: string } | null;
  district: { id: string; name: string; assemblyKind: string | null } | null;
  locality: { id: string; name: string } | null;
  candidates: GeoCandidate[];
  /** Problems with the input. Ids that fail a check are dropped, never silently corrected. */
  issues: GeoIssue[];
  /** Weakest verification among the records and links relied on (official data vs. assertions). */
  verification: "OFFICIAL" | "SOURCE_ASSERTED" | "UNVERIFIED" | "TEST_FIXTURE" | null;
  coordinates: { latitude: number; longitude: number; accuracyM: number | null; source: string } | null;
  originalText: Record<string, string>;
  streetOrEstate: string | null;
  landmark: string | null;
  accessNotes: string | null;
};

const RANK = { OFFICIAL: 0, SOURCE_ASSERTED: 1, UNVERIFIED: 2, TEST_FIXTURE: 3 } as const;
type Verification = keyof typeof RANK;
const weakest = (values: Verification[]): Verification | null => values.length ? values.reduce((a, b) => (RANK[a] >= RANK[b] ? a : b)) : null;
const allowFixtures = () => process.env.GEO_ALLOW_TEST_FIXTURES === "true";
const visible = (status: string) => allowFixtures() || status !== "TEST_FIXTURE";

/** A pin this far (straight line) from a locality/district centre is treated as a conflict to ask about. */
export const PIN_CONFLICT_KM = { locality: 15, district: 60 } as const;
const MAX_CANDIDATES = 10;

function originalTextOf(input: ParsedInput) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.text ?? {})) if (typeof value === "string" && value.trim()) out[key] = value.trim();
  return out;
}

/**
 * Validates and resolves one location. It never invents an id: ids come only from the input or
 * from an exact (normalised) name or alias match inside the same country. Several matches give
 * AMBIGUOUS with candidates for the person to choose from; none gives UNRESOLVED with the text
 * kept. Official verification (the data), geocoder confidence and the person's confirmation are
 * separate: this function reports the first and never claims the other two.
 */
export async function resolveLocation(rawInput: LocationInput, client: Client = db): Promise<ResolvedLocation> {
  const input = locationInputSchema.parse(rawInput);
  const result: ResolvedLocation = {
    status: "UNRESOLVED", countryCode: input.countryCode, region: null, district: null, locality: null, candidates: [], issues: [],
    verification: null, coordinates: null, originalText: originalTextOf(input),
    streetOrEstate: input.streetOrEstate || null, landmark: input.landmark || null, accessNotes: input.accessNotes || null,
  };
  if (input.coordinates) {
    const { latitude, longitude } = input.coordinates;
    const bounds = COUNTRY_BOUNDS[input.countryCode];
    if (!isValidCoordinate(latitude, longitude)) result.issues.push("PIN_INVALID");
    else if (bounds && (latitude < bounds.minLatitude || latitude > bounds.maxLatitude || longitude < bounds.minLongitude || longitude > bounds.maxLongitude)) result.issues.push("PIN_OUTSIDE_COUNTRY");
    else result.coordinates = { latitude, longitude, accuracyM: input.coordinates.accuracyM ?? null, source: input.coordinates.source };
  }
  if (!await isGeographyEnabled(input.countryCode, client)) {
    result.issues.push("COUNTRY_NOT_CONFIGURED");
    return result;
  }
  if (input.manual) {
    // "I can't find my area": kept exactly as typed, clearly unresolved, never verified.
    return result;
  }

  const verifications: Verification[] = [];
  // 1. Selected ids, each checked for existence, activity, country and level.
  const region = input.regionId ? await loadArea(client, input.regionId, "REGION", input.countryCode, result) : null;
  let district = input.districtId ? await loadArea(client, input.districtId, "DISTRICT", input.countryCode, result) : null;
  if (district && region && district.parentId !== region.id) {
    result.issues.push("DISTRICT_NOT_IN_REGION");
    district = null;
  }
  let locality = input.localityId ? await loadLocality(client, input.localityId, input.countryCode, result) : null;

  let regionRow = region;
  if (district && !regionRow && district.parentId) regionRow = await loadArea(client, district.parentId, "REGION", input.countryCode, result);

  if (locality) {
    const districtLinks = locality.areaLinks.filter((link) => link.area.type === "DISTRICT" && link.area.active && visible(link.verificationStatus));
    const regionIds = new Set([
      ...districtLinks.map((link) => link.area.parentId).filter((id): id is string => Boolean(id)),
      ...locality.areaLinks.filter((link) => link.area.type === "REGION").map((link) => link.area.id),
    ]);
    if (district) {
      const link = districtLinks.find((item) => item.areaId === district!.id);
      if (!link && districtLinks.length) {
        result.issues.push("LOCALITY_NOT_IN_DISTRICT");
        locality = null;
      } else if (link) {
        verifications.push(link.verificationStatus as Verification);
      } else {
        // The locality has no recorded district: accepted with the person's district, but the
        // relationship is theirs, not the data's.
        result.issues.push("LOCALITY_LINK_UNVERIFIED");
        verifications.push("UNVERIFIED");
      }
    } else if (regionRow && regionIds.size && !regionIds.has(regionRow.id)) {
      result.issues.push("LOCALITY_NOT_IN_REGION");
      locality = null;
    } else if (districtLinks.length === 1) {
      district = districtLinks[0].area;
      verifications.push(districtLinks[0].verificationStatus as Verification);
    } else if (districtLinks.length > 1) {
      // A locality spanning several districts: ask which, never pick one.
      const inRegion = regionRow ? districtLinks.filter((link) => link.area.parentId === regionRow!.id) : districtLinks;
      if (inRegion.length === 1) {
        district = inRegion[0].area;
        verifications.push(inRegion[0].verificationStatus as Verification);
      } else {
        result.candidates = inRegion.slice(0, MAX_CANDIDATES).map((link) => ({ localityId: locality!.id, districtId: link.area.id, regionId: link.area.parentId, label: `${locality!.name}, ${link.area.name}`, matchedBy: "name" as const }));
      }
    }
    if (locality) verifications.push(locality.verificationStatus as Verification);
    if (district && !regionRow && district.parentId) regionRow = await loadArea(client, district.parentId, "REGION", input.countryCode, result);
  }

  // 2. Text only where nothing was selected at that level.
  if (!regionRow && !district && !locality && !result.candidates.length) {
    const text = input.text ?? {};
    if (text.region) regionRow = await matchArea(client, input.countryCode, "REGION", normalizeRegionQuery(text.region), null);
    if (text.district) {
      const districts = await matchAreas(client, input.countryCode, "DISTRICT", normalizeGeoName(text.district), regionRow?.id ?? null);
      if (districts.length === 1) district = districts[0];
      else if (districts.length > 1) result.candidates = districts.slice(0, MAX_CANDIDATES).map((row) => ({ localityId: null, districtId: row.id, regionId: row.parentId, label: row.name, matchedBy: "name" as const }));
    }
    const placeText = text.locality || text.city || text.freeText;
    if (placeText && !result.candidates.length) {
      const matches = await matchLocalities(client, input.countryCode, normalizeGeoName(placeText), district?.id ?? null, regionRow?.id ?? null);
      if (matches.length === 1 && matches[0].districtIds.length <= 1) {
        locality = await loadLocality(client, matches[0].id, input.countryCode, result);
        if (!district && matches[0].districtIds[0]) district = await loadArea(client, matches[0].districtIds[0], "DISTRICT", input.countryCode, result);
        result.originalText.matchedBy = matches[0].matchedBy;
      } else if (matches.length) {
        result.candidates = matches.flatMap((match) => (match.districtIds.length ? match.districtIds : [null]).map((districtId) => ({
          localityId: match.id, districtId, regionId: match.regionIdFor(districtId), label: match.labelFor(districtId), matchedBy: match.matchedBy,
        }))).slice(0, MAX_CANDIDATES);
      } else if (!regionRow && !district) {
        // A place name can also be a district or region name ("Tema", "Ashanti").
        const districts = await matchAreas(client, input.countryCode, "DISTRICT", normalizeGeoName(placeText), null);
        if (districts.length === 1) district = districts[0];
        else if (districts.length > 1) result.candidates = districts.slice(0, MAX_CANDIDATES).map((row) => ({ localityId: null, districtId: row.id, regionId: row.parentId, label: row.name, matchedBy: "name" as const }));
      }
    }
    if (district && !regionRow && district.parentId) regionRow = await loadArea(client, district.parentId, "REGION", input.countryCode, result);
  }

  // The locality-to-district relationship relied on counts too: a derived link is UNVERIFIED.
  if (locality && district) {
    const link = locality.areaLinks.find((item) => item.areaId === district!.id);
    verifications.push((link?.verificationStatus ?? "UNVERIFIED") as Verification);
  }
  if (regionRow) verifications.push(regionRow.verificationStatus as Verification);
  if (district) verifications.push(district.verificationStatus as Verification);
  result.region = regionRow ? { id: regionRow.id, name: regionRow.name } : null;
  result.district = district ? { id: district.id, name: district.name, assemblyKind: district.assemblyKind } : null;
  result.locality = locality ? { id: locality.id, name: locality.name } : null;
  result.verification = weakest(verifications);
  // RESOLVED needs both the locality and its district. A locality whose district is not recorded
  // (for example one near a boundary) stays PARTIAL until the person chooses the district.
  if (locality && !district && !result.candidates.length) result.issues.push("DISTRICT_REQUIRED");
  result.status = result.candidates.length ? "AMBIGUOUS" : locality && district ? "RESOLVED" : locality || district || regionRow ? "PARTIAL" : "UNRESOLVED";

  // 3. A pin far from the selected place is a conflict to ask about, never a silent override.
  if (result.coordinates) {
    const centre = locality?.centroidLatitude != null && locality.centroidLongitude != null
      ? { lat: Number(locality.centroidLatitude), lng: Number(locality.centroidLongitude), limit: PIN_CONFLICT_KM.locality }
      : district?.centroidLatitude != null && district.centroidLongitude != null
        ? { lat: Number(district.centroidLatitude), lng: Number(district.centroidLongitude), limit: PIN_CONFLICT_KM.district }
        : null;
    if (centre && haversineDistanceKm({ latitude: centre.lat, longitude: centre.lng }, result.coordinates) > centre.limit) result.issues.push("PIN_FAR_FROM_SELECTION");
  }
  return result;
}

type AreaRow = { id: string; name: string; type: string; parentId: string | null; assemblyKind: string | null; verificationStatus: string; active: boolean; centroidLatitude: Prisma.Decimal | null; centroidLongitude: Prisma.Decimal | null };
const areaFields = { id: true, name: true, type: true, parentId: true, assemblyKind: true, verificationStatus: true, active: true, centroidLatitude: true, centroidLongitude: true, countryCode: true } as const;

async function loadArea(client: Client, id: string, type: "REGION" | "DISTRICT", countryCode: string, result: ResolvedLocation): Promise<AreaRow | null> {
  const row = await client.geoArea.findUnique({ where: { id }, select: areaFields });
  if (!row || !visible(row.verificationStatus)) { result.issues.push("UNKNOWN_ID"); return null; }
  if (row.countryCode !== countryCode) { result.issues.push("WRONG_COUNTRY"); return null; }
  if (row.type !== type) { result.issues.push("WRONG_LEVEL"); return null; }
  if (!row.active) { result.issues.push("INACTIVE_RECORD"); return null; }
  return row;
}

async function loadLocality(client: Client, id: string, countryCode: string, result: ResolvedLocation) {
  const row = await client.geoLocality.findUnique({
    where: { id },
    select: {
      id: true, name: true, countryCode: true, active: true, verificationStatus: true, centroidLatitude: true, centroidLongitude: true,
      areaLinks: { select: { areaId: true, verificationStatus: true, area: { select: areaFields } } },
    },
  });
  if (!row || !visible(row.verificationStatus)) { result.issues.push("UNKNOWN_ID"); return null; }
  if (row.countryCode !== countryCode) { result.issues.push("WRONG_COUNTRY"); return null; }
  if (!row.active) { result.issues.push("INACTIVE_RECORD"); return null; }
  return row;
}

async function matchAreas(client: Client, countryCode: string, type: "REGION" | "DISTRICT", needle: string, parentId: string | null): Promise<AreaRow[]> {
  if (!needle) return [];
  const rows = await client.geoArea.findMany({
    where: {
      countryCode, type, active: true, ...(parentId ? { parentId } : {}),
      OR: [{ normalizedName: needle }, { aliases: { some: { normalizedAlias: needle, active: true } } }],
    },
    select: areaFields,
    take: MAX_CANDIDATES + 1,
  });
  return rows.filter((row) => visible(row.verificationStatus));
}

async function matchArea(client: Client, countryCode: string, type: "REGION" | "DISTRICT", needle: string, parentId: string | null) {
  const rows = await matchAreas(client, countryCode, type, needle, parentId);
  return rows.length === 1 ? rows[0] : null;
}

/** Exact (normalised) name or alias matches, within a district or region when one is known. */
async function matchLocalities(client: Client, countryCode: string, needle: string, districtId: string | null, regionId: string | null) {
  if (!needle) return [];
  const rows = await client.geoLocality.findMany({
    where: {
      countryCode, active: true,
      OR: [{ normalizedName: needle }, { aliases: { some: { normalizedAlias: needle, active: true } } }],
      ...(districtId ? { areaLinks: { some: { areaId: districtId } } } : regionId ? { areaLinks: { some: { OR: [{ areaId: regionId }, { area: { parentId: regionId } }] } } } : {}),
    },
    select: {
      id: true, name: true, normalizedName: true, verificationStatus: true,
      areaLinks: { select: { verificationStatus: true, area: { select: { id: true, name: true, type: true, parentId: true, active: true, parent: { select: { name: true } } } } } },
    },
    take: MAX_CANDIDATES + 1,
    orderBy: { name: "asc" },
  });
  return rows.filter((row) => visible(row.verificationStatus)).map((row) => {
    const links = row.areaLinks.filter((link) => link.area.type === "DISTRICT" && link.area.active && visible(link.verificationStatus) && (!districtId || link.area.id === districtId) && (!regionId || link.area.parentId === regionId));
    return {
      id: row.id,
      matchedBy: (row.normalizedName === needle ? "name" : "alias") as "name" | "alias",
      districtIds: links.map((link) => link.area.id),
      regionIdFor: (id: string | null) => links.find((link) => link.area.id === id)?.area.parentId ?? null,
      labelFor: (id: string | null) => {
        const link = links.find((item) => item.area.id === id);
        return link ? `${row.name}, ${link.area.name}${link.area.parent ? `, ${link.area.parent.name}` : ""}` : row.name;
      },
    };
  });
}

/** One line a person can read back: "East Legon, La Nkwantanang Madina, Greater Accra". */
export function describeResolved(location: Pick<ResolvedLocation, "region" | "district" | "locality" | "originalText">) {
  const parts = [location.locality?.name, location.district?.name, location.region?.name].filter(Boolean) as string[];
  if (parts.length) return parts.join(", ");
  const text = location.originalText;
  return [text.locality, text.city, text.district, text.region, text.freeText].filter(Boolean).join(", ") || "Not given";
}
