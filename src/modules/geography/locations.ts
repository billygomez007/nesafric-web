import { Prisma, type GeoLocationPurpose, type GeoResolutionSource } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { resolveLocation, type GeoIssue, type ResolvedLocation } from "./resolve";
import { coverageSchema, type CoverageInput, type StructuredLocationInput } from "./schemas";

export { structuredLocationSchema, coverageSchema, type CoverageInput, type StructuredLocationInput } from "./schemas";

type Client = typeof db | Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;


/** Input problems that make a selection invalid (as opposed to merely unconfirmed). */
const REJECTED: Partial<Record<GeoIssue, string>> = {
  COUNTRY_NOT_CONFIGURED: "Locations are not available for this country yet.",
  UNKNOWN_ID: "One of the selected places no longer exists. Please choose it again.",
  INACTIVE_RECORD: "One of the selected places is no longer available. Please choose another.",
  WRONG_COUNTRY: "The selected place is in a different country.",
  WRONG_LEVEL: "The selected place is not the right kind (region, district or locality).",
  DISTRICT_NOT_IN_REGION: "The selected district is not in the selected region.",
  LOCALITY_NOT_IN_DISTRICT: "The selected locality is not recorded in the selected district. Choose another district, or say you can't find your area.",
  LOCALITY_NOT_IN_REGION: "The selected locality is not in the selected region.",
  PIN_INVALID: "The map pin is not a valid location.",
  PIN_OUTSIDE_COUNTRY: "The map pin is outside the country.",
};

export type PreparedLocation = {
  resolved: ResolvedLocation;
  /** Canonical names to write into the legacy text columns (null keeps what was typed). */
  text: { region: string | null; district: string | null; locality: string | null };
  confirmed: boolean;
};

/**
 * Validates a structured location against reference data before it is saved. Invalid selections
 * are refused with a plain message (a manual location is never refused for not matching).
 */
export async function prepareLocation(client: Client, countryCode: string, input: StructuredLocationInput, legacyText: Record<string, string | null | undefined> = {}, coordinateSource: "USER_PIN" | "WHATSAPP_PIN" = "USER_PIN"): Promise<PreparedLocation> {
  const text = Object.fromEntries(Object.entries({ ...legacyText, freeText: input.manualText }).filter(([, value]) => typeof value === "string" && value.trim())) as Record<string, string>;
  const resolved = await resolveLocation({
    countryCode,
    regionId: input.regionId ?? null,
    districtId: input.districtId ?? null,
    localityId: input.localityId ?? null,
    // The resolver matches text only when nothing was selected: a selection is never
    // second-guessed, and the typed text is always kept as the original.
    text,
    streetOrEstate: input.streetOrEstate ?? null,
    landmark: input.landmark ?? null,
    accessNotes: input.accessNotes ?? null,
    coordinates: input.pin ? { latitude: input.pin.latitude, longitude: input.pin.longitude, accuracyM: input.pin.accuracyM ?? null, source: coordinateSource } : null,
    manual: input.manual,
  }, client);
  for (const issue of resolved.issues) {
    const message = REJECTED[issue];
    if (message && !(issue === "COUNTRY_NOT_CONFIGURED" && input.manual)) throw new AppError("INVALID_LOCATION", 422, message);
  }
  // Text matching is advisory here: only what the person selected (ids) becomes the record's
  // resolution. A text match is offered back to them as a suggestion, never saved as theirs.
  if (!input.regionId && !input.manual) {
    resolved.region = null;
    resolved.district = null;
    resolved.locality = null;
    resolved.status = "UNRESOLVED";
    resolved.verification = null;
  }
  return {
    resolved,
    text: { region: resolved.region?.name ?? null, district: resolved.district?.name ?? null, locality: resolved.locality?.name ?? null },
    confirmed: Boolean(input.confirmed),
  };
}

export type LocationOwner =
  | { purpose: "LISTING"; listingId: string }
  | { purpose: "PROPERTY"; propertyId: string }
  | { purpose: "BUSINESS_OFFICE"; marketplaceProfessionalId: string }
  | { purpose: "PROVIDER_BASE"; serviceProviderId: string };

const ownerWhere = (owner: LocationOwner): Prisma.GeoLocationWhereUniqueInput =>
  owner.purpose === "LISTING" ? { listingId: owner.listingId }
    : owner.purpose === "PROPERTY" ? { propertyId: owner.propertyId }
      : owner.purpose === "BUSINESS_OFFICE" ? { marketplaceProfessionalId: owner.marketplaceProfessionalId }
        : { serviceProviderId: owner.serviceProviderId };

/**
 * Saves the structured location of one owner. Writes only when something changed, so an edit that
 * leaves the location as it was does not create a new listing revision. Coordinates from a pin
 * are kept privately with their source and accuracy.
 */
export async function saveLocation(tx: Prisma.TransactionClient, owner: LocationOwner, prepared: PreparedLocation, source: GeoResolutionSource) {
  const { resolved } = prepared;
  const status = resolved.status;
  const data = {
    countryCode: resolved.countryCode,
    regionId: resolved.region?.id ?? null,
    districtId: resolved.district?.id ?? null,
    localityId: resolved.locality?.id ?? null,
    originalText: Object.keys(resolved.originalText).length ? json(resolved.originalText) : Prisma.DbNull,
    streetOrEstate: resolved.streetOrEstate,
    landmark: resolved.landmark,
    accessNotes: resolved.accessNotes,
    latitude: resolved.coordinates ? new Prisma.Decimal(resolved.coordinates.latitude) : null,
    longitude: resolved.coordinates ? new Prisma.Decimal(resolved.coordinates.longitude) : null,
    coordinateSource: resolved.coordinates ? resolved.coordinates.source as "USER_PIN" | "WHATSAPP_PIN" : null,
    coordinateAccuracyM: resolved.coordinates?.accuracyM ?? null,
    resolutionStatus: status === "RESOLVED" && resolved.issues.includes("PIN_FAR_FROM_SELECTION") && !prepared.confirmed ? "NEEDS_REVIEW" as const : status,
    resolutionSource: source,
    resolutionNote: resolved.issues.length ? resolved.issues.join(",") : null,
    candidates: resolved.candidates.length ? json(resolved.candidates) : Prisma.DbNull,
  };
  const existing = await tx.geoLocation.findUnique({ where: ownerWhere(owner) });
  if (existing && sameLocation(existing, data) && (!prepared.confirmed || existing.userConfirmedAt)) return existing;
  const ownerFields = owner.purpose === "LISTING" ? { listingId: owner.listingId } : owner.purpose === "PROPERTY" ? { propertyId: owner.propertyId } : owner.purpose === "BUSINESS_OFFICE" ? { marketplaceProfessionalId: owner.marketplaceProfessionalId } : { serviceProviderId: owner.serviceProviderId };
  const confirmed = prepared.confirmed ? { userConfirmedAt: new Date() } : existing && sameLocation(existing, data) ? {} : { userConfirmedAt: null };
  const coordinateCapturedAt = resolved.coordinates && !(existing && Number(existing.latitude) === resolved.coordinates.latitude && Number(existing.longitude) === resolved.coordinates.longitude) ? { coordinateCapturedAt: new Date() } : {};
  if (existing) return tx.geoLocation.update({ where: { id: existing.id }, data: { ...data, ...confirmed, ...coordinateCapturedAt, reviewedAt: null, reviewedByUserId: null } });
  return tx.geoLocation.create({ data: { purpose: owner.purpose as GeoLocationPurpose, ...ownerFields, ...data, ...confirmed, ...coordinateCapturedAt } });
}

function sameLocation(existing: Prisma.GeoLocationGetPayload<object>, data: Record<string, unknown>) {
  const scalar = (value: unknown) => value === Prisma.DbNull || value === undefined ? null : value instanceof Prisma.Decimal ? value.toString() : typeof value === "object" && value !== null ? JSON.stringify(value) : value;
  return (["countryCode", "regionId", "districtId", "localityId", "streetOrEstate", "landmark", "accessNotes", "coordinateSource", "coordinateAccuracyM", "resolutionStatus"] as const)
    .every((key) => scalar(existing[key]) === scalar(data[key]))
    && scalar(existing.latitude) === scalar(data.latitude) && scalar(existing.longitude) === scalar(data.longitude)
    && JSON.stringify(existing.originalText ?? null) === (data.originalText === Prisma.DbNull ? "null" : JSON.stringify(data.originalText));
}

/** Removes an owner's structured location (the legacy text stays as it was). */
export async function clearLocation(tx: Prisma.TransactionClient, owner: LocationOwner) {
  await tx.geoLocation.deleteMany({ where: ownerWhere(owner) });
}

const locationInclude = { region: { select: { id: true, name: true } }, district: { select: { id: true, name: true, assemblyKind: true } }, locality: { select: { id: true, name: true } } } as const;
type LocationRow = Prisma.GeoLocationGetPayload<{ include: typeof locationInclude }>;

/** The owner's own view: everything, including the private pin and access notes. */
export function privateLocationView(row: LocationRow | null) {
  if (!row) return null;
  return {
    countryCode: row.countryCode,
    region: row.region, district: row.district, locality: row.locality,
    originalText: row.originalText, streetOrEstate: row.streetOrEstate, landmark: row.landmark, accessNotes: row.accessNotes,
    pin: row.latitude !== null && row.longitude !== null ? { latitude: Number(row.latitude), longitude: Number(row.longitude), accuracyM: row.coordinateAccuracyM, source: row.coordinateSource } : null,
    status: row.resolutionStatus, confirmed: row.userConfirmedAt !== null,
  };
}

/**
 * The public view: area names and ids only. Never the pin, street, landmark or access notes,
 * whatever the owner chose for the listing's public map (which stays on the listing itself).
 */
export function publicLocationView(row: Pick<LocationRow, "region" | "district" | "locality" | "resolutionStatus"> | null) {
  if (!row || row.resolutionStatus === "UNRESOLVED") return null;
  return { region: row.region, district: row.district ? { id: row.district.id, name: row.district.name } : null, locality: row.locality };
}

export async function getLocation(owner: LocationOwner, client: Client = db) {
  return client.geoLocation.findUnique({ where: ownerWhere(owner), include: locationInclude });
}
export { locationInclude as geoLocationInclude };

// ---------------------------------------------------------------------------------------------
// Coverage (where a provider or professional works). Separate from any office or base address.
// ---------------------------------------------------------------------------------------------


export type CoverageHolder = { serviceProviderId: string } | { marketplaceProfessionalId: string };

/**
 * Replaces a holder's structured coverage. Every id must be an active region, district or
 * locality of the country (constituencies are electoral, not coverage). Unknown coverage is
 * simply no rows, never nationwide; nationwide must be chosen explicitly.
 */
export async function replaceCoverage(tx: Prisma.TransactionClient, holder: CoverageHolder, input: CoverageInput, source: "USER" | "WHATSAPP" | "ADMIN" | "BACKFILL", originalText: Array<string | null> = []) {
  const data = coverageSchema.parse(input);
  const country = await tx.country.findUnique({ where: { code: data.countryCode }, select: { geographyEnabled: true, isActive: true } });
  if (!country?.isActive || !country.geographyEnabled) throw new AppError("INVALID_LOCATION", 422, "Locations are not available for this country yet.");
  const areaIds = [...new Set(data.items.map((item) => item.areaId).filter((id): id is string => Boolean(id)))];
  const localityIds = [...new Set(data.items.map((item) => item.localityId).filter((id): id is string => Boolean(id)))];
  const [areas, localities] = await Promise.all([
    tx.geoArea.findMany({ where: { id: { in: areaIds }, countryCode: data.countryCode, active: true, type: { in: ["REGION", "DISTRICT"] } }, select: { id: true } }),
    tx.geoLocality.findMany({ where: { id: { in: localityIds }, countryCode: data.countryCode, active: true }, select: { id: true } }),
  ]);
  if (areas.length !== areaIds.length || localities.length !== localityIds.length) throw new AppError("INVALID_LOCATION", 422, "One of the selected areas is not available. Please choose it again.");
  const categoryIds = [...new Set(data.items.map((item) => item.categoryId).filter((id): id is string => Boolean(id)))];
  if (categoryIds.length && await tx.serviceCategory.count({ where: { id: { in: categoryIds }, active: true } }) !== categoryIds.length) throw new AppError("INVALID_LOCATION", 422, "One of the selected service categories is not available.");
  const keyOf = (item: { areaId?: string | null; localityId?: string | null; nationwide?: boolean | null; categoryId?: string | null }) => `${item.areaId ?? ""}|${item.localityId ?? ""}|${item.nationwide ? "N" : ""}|${item.categoryId ?? ""}`;
  const unique = [...new Map(data.items.map((item, index) => [keyOf(item), { item, text: originalText[index] ?? null }])).values()];
  const where = "serviceProviderId" in holder ? { serviceProviderId: holder.serviceProviderId } : { marketplaceProfessionalId: holder.marketplaceProfessionalId };
  const current = await tx.geoCoverageArea.findMany({ where });
  const wanted = new Set(unique.map(({ item }) => keyOf(item)));
  const removed = current.filter((row) => !wanted.has(keyOf(row)));
  if (removed.length) await tx.geoCoverageArea.deleteMany({ where: { id: { in: removed.map((row) => row.id) } } });
  const have = new Set(current.map((row) => keyOf(row)));
  const added = unique.filter(({ item }) => !have.has(keyOf(item)));
  if (added.length) {
    await tx.geoCoverageArea.createMany({
      data: added.map(({ item, text }) => ({ ...where, countryCode: data.countryCode, areaId: item.areaId ?? null, localityId: item.localityId ?? null, nationwide: Boolean(item.nationwide), categoryId: item.categoryId ?? null, originalText: text, source })),
    });
  }
  return { added: added.length, removed: removed.length };
}

export async function listCoverage(holder: CoverageHolder, client: Client = db) {
  const where = "serviceProviderId" in holder ? { serviceProviderId: holder.serviceProviderId } : { marketplaceProfessionalId: holder.marketplaceProfessionalId };
  const rows = await client.geoCoverageArea.findMany({
    where,
    include: { area: { select: { id: true, name: true, type: true } }, locality: { select: { id: true, name: true } }, category: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    countryCode: row.countryCode, nationwide: row.nationwide,
    area: row.area, locality: row.locality, category: row.category,
    label: row.nationwide ? "Nationwide" : row.locality?.name ?? row.area?.name ?? row.originalText ?? "",
  }));
}
