import { createHash } from "node:crypto";
import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { AppError, notFound } from "@/platform/errors";
import { geocodingProviders, getActiveGeocodingAdapter, type GeocodingProviderRegistry } from "./provider";
import { recordIntegrationOutcome } from "@/modules/integrations/service";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const EARTH_RADIUS_KM = 6371;

export function listAvailableGeocodingProviders(registry: GeocodingProviderRegistry = geocodingProviders) {
  return registry.list().map((adapter) => ({ key: adapter.key, displayName: adapter.displayName, available: adapter.isConfigured() }));
}

/** Whether a real (non-fallback) geocoding provider is configured — used by public listing projections to report `credentialsRequired` honestly instead of a hardcoded value. */
export function isRealGeocodingProviderConfigured(registry: GeocodingProviderRegistry = geocodingProviders) {
  return registry.get("http").isConfigured();
}

/** Great-circle distance between two coordinates, in kilometres — the shared proximity/radius primitive (item 5). */
export function haversineDistanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function isWithinRadiusKm(center: { latitude: number; longitude: number }, point: { latitude: number; longitude: number }, radiusKm: number) {
  return haversineDistanceKm(center, point) <= radiusKm;
}

/**
 * Derives a public-safe approximate coordinate from a precise one (item 5: "public location
 * projection must approximate/private coordinates protected"). Never returns the exact input:
 * rounding is grid-snapped to the requested precision, and a small deterministic per-source jitter
 * is applied so identical inputs are stable but the exact private point is never reconstructible
 * from the public value alone.
 */
export function approximateCoordinate(latitude: number, longitude: number, precision: "APPROXIMATE" | "DISTRICT" | "CITY" | "REGION", jitterSeed: string) {
  const decimals = { REGION: 1, CITY: 2, DISTRICT: 3, APPROXIMATE: 2 }[precision];
  const seedHash = createHash("sha256").update(jitterSeed).digest();
  const jitterMagnitude = precision === "APPROXIMATE" ? 0.01 : 0.002;
  const jitterLat = ((seedHash[0] / 255) - 0.5) * 2 * jitterMagnitude;
  const jitterLng = ((seedHash[1] / 255) - 0.5) * 2 * jitterMagnitude;
  const round = (value: number) => Number(value.toFixed(decimals));
  return { latitude: round(latitude + jitterLat), longitude: round(longitude + jitterLng) };
}

/** Attempts to resolve a property's address to coordinates (item 5). Always succeeds as a request — a NOT_FOUND/ERROR/NOT_CONFIGURED outcome is recorded, never thrown, so property management is never blocked by geocoding. */
export async function geocodeProperty(userId: string, organisationId: string, propertyId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.propertyUpdate);
  const property = await db.property.findFirst({ where: { id: propertyId, organisationId, archivedAt: null } });
  if (!property) throw notFound();
  const adapter = getActiveGeocodingAdapter();
  const queryText = [property.addressLine1, property.digitalAddress, property.district, property.city, property.region, property.countryCode].filter(Boolean).join(", ");
  const result = await adapter.geocode({
    addressLine1: property.addressLine1, city: property.city, region: property.region, district: property.district, countryCode: property.countryCode,
  });
  return db.$transaction(async (tx) => {
    await tx.geocodeLookup.create({
      data: {
        organisationId, propertyId, provider: adapter.key, queryText, queryHash: createHash("sha256").update(queryText).digest("hex"),
        status: result.status, latitude: result.latitude, longitude: result.longitude, precision: result.precision, providerReference: result.providerReference, failureReason: result.failureReason,
      },
    });
    const updated = await tx.property.update({
      where: { id: propertyId },
      data: {
        ...(result.status === "OK" ? { latitude: result.latitude, longitude: result.longitude } : {}),
        geocodeStatus: result.status,
        geocodedAt: new Date(),
      },
    });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "geocode.completed", entityType: "property", entityId: propertyId, metadata: json({ status: result.status, provider: adapter.key }) } });
    await tx.domainEvent.create({ data: { organisationId, name: "geocode.completed", aggregateType: "property", aggregateId: propertyId, payload: json({ status: result.status, provider: adapter.key, precision: result.precision ?? null }) } });
    return { property: updated, result };
  }).then(async (outcome) => {
    if (outcome.result.status === "OK") await recordIntegrationOutcome(organisationId, "GEOCODING", adapter.key, "SUCCESS");
    else if (outcome.result.status === "ERROR") await recordIntegrationOutcome(organisationId, "GEOCODING", adapter.key, "FAILURE", outcome.result.failureReason);
    return outcome;
  });
}

/** Copies a property's geocoded location onto a listing as an APPROXIMATE public pin, never the exact private coordinate — explicit opt-in, not automatic. */
export async function applyPropertyLocationToListing(userId: string, organisationId: string, listingId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.listingManage);
  const listing = await db.listing.findFirst({ where: { id: listingId, organisationId }, include: { property: true } });
  if (!listing || !listing.property || !listing.propertyId) throw notFound();
  if (listing.property.latitude == null || listing.property.longitude == null) {
    throw new AppError("PROPERTY_NOT_GEOCODED", 409, "This property has no geocoded coordinates yet. Geocode the property first.");
  }
  const approx = approximateCoordinate(Number(listing.property.latitude), Number(listing.property.longitude), "CITY", listing.propertyId);
  return db.listing.update({ where: { id: listingId }, data: { mapLatitude: new Prisma.Decimal(approx.latitude), mapLongitude: new Prisma.Decimal(approx.longitude), mapPrecision: "CITY" } });
}

/** Proximity search foundation: properties within `radiusKm` of a centre point (bounding-box prefilter + exact haversine filter, no PostGIS dependency required). */
export async function findPropertiesNearby(organisationId: string, center: { latitude: number; longitude: number }, radiusKm: number) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((center.latitude * Math.PI) / 180) || 1);
  const candidates = await db.property.findMany({
    where: {
      organisationId,
      archivedAt: null,
      latitude: { gte: new Prisma.Decimal(center.latitude - latDelta), lte: new Prisma.Decimal(center.latitude + latDelta) },
      longitude: { gte: new Prisma.Decimal(center.longitude - lngDelta), lte: new Prisma.Decimal(center.longitude + lngDelta) },
    },
  });
  return candidates
    .map((property) => ({ property, distanceKm: haversineDistanceKm(center, { latitude: Number(property.latitude), longitude: Number(property.longitude) }) }))
    .filter(({ distanceKm }) => distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
