import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { requirePermission, PERMISSIONS } from "@/platform/authorization/permissions";
import { recordAudit } from "@/modules/audit/service";
import { assertOperational, assertWithinLimit } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import { createPortfolioSchema, createPropertySchema, updatePropertySchema } from "./schemas";
import { activePropertyScope } from "./repository";

export async function createPortfolio(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.portfolioCreate);
  const data = createPortfolioSchema.parse(input);
  const portfolio = await db.portfolio.create({ data: { ...data, organisationId } });
  await recordAudit({ organisationId, actorUserId: userId, action: "portfolio.created", entityType: "portfolio", entityId: portfolio.id });
  return portfolio;
}

export async function createProperty(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.propertyCreate);
  const data = createPropertySchema.parse(input);
  if (data.portfolioId) {
    const portfolio = await db.portfolio.findFirst({ where: { id: data.portfolioId, organisationId, archivedAt: null } });
    if (!portfolio) throw notFound();
  }
  const country = await db.country.findUnique({ where: { code: data.countryCode } });
  const currency = await db.currency.findUnique({ where: { code: data.currencyCode } });
  if (!country?.isActive || !currency?.isActive) throw new AppError("INVALID_CONFIGURATION", 422, "Country or currency is not supported.");
  // Representative entitlement checks (item 2): a subscription in a read-only state (suspended/
  // cancelled) or already at its property/unit ceiling blocks creating more, without touching any
  // existing property/unit.
  const newUnitCount = (data.building?.units.length ?? 0) + data.units.length;
  await assertOperational(organisationId, ENTITLEMENTS.propertiesMax.key);
  if (newUnitCount > 0) await assertWithinLimit(organisationId, ENTITLEMENTS.unitsMax.key, newUnitCount);
  return db.$transaction(async (tx) => {
    const { building, units, ...propertyData } = data;
    const property = await tx.property.create({ data: { ...propertyData, organisationId } });
    if (building) {
      const createdBuilding = await tx.building.create({ data: { propertyId: property.id, name: building.name } });
      if (building.units.length) await tx.unit.createMany({ data: building.units.map((unit) => ({ ...unit, propertyId: property.id, buildingId: createdBuilding.id })) });
    }
    if (units.length) await tx.unit.createMany({ data: units.map((unit) => ({ ...unit, propertyId: property.id })) });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "property.created", entityType: "property", entityId: property.id } });
    await tx.domainEvent.create({ data: { organisationId, name: "property.created", aggregateType: "property", aggregateId: property.id, payload: { referenceNumber: property.referenceNumber } } });
    return property;
  });
}

export async function getProperty(userId: string, organisationId: string, propertyId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.propertyRead);
  const property = await db.property.findFirst({ where: activePropertyScope(organisationId, propertyId), include: { buildings: { where: { archivedAt: null }, include: { units: { where: { archivedAt: null } } } }, units: { where: { archivedAt: null, buildingId: null } } } });
  if (!property) throw notFound();
  return property;
}

export async function updateProperty(userId: string, organisationId: string, propertyId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.propertyUpdate);
  const data = updatePropertySchema.parse(input);
  return db.$transaction(async (tx) => {
    const result = await tx.property.updateMany({ where: activePropertyScope(organisationId, propertyId), data });
    if (result.count !== 1) throw notFound();
    const property = await tx.property.findUniqueOrThrow({ where: { id: propertyId } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "property.updated", entityType: "property", entityId: propertyId } });
    await tx.domainEvent.create({ data: { organisationId, name: "property.updated", aggregateType: "property", aggregateId: propertyId, payload: { changedFields: Object.keys(data) } } });
    return property;
  });
}
