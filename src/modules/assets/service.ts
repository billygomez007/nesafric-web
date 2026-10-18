import { db } from "@/platform/database/client";
import { Prisma } from "@/platform/database/generated/client";
import { AppError, notFound } from "@/platform/errors";
import { requirePermission, PERMISSIONS } from "@/platform/authorization/permissions";
import { recordAudit } from "@/modules/audit/service";
import { assertOperational, assertWithinLimit } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import { createBuildingSchema, createPortfolioSchema, createPropertySchema, createUnitSchema, updatePropertySchema, updateUnitSchema } from "./schemas";
import { activePropertyScope } from "./repository";

export async function createPortfolio(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.portfolioCreate);
  const data = createPortfolioSchema.parse(input);
  const portfolio = await db.portfolio.create({ data: { ...data, organisationId } });
  await recordAudit({ organisationId, actorUserId: userId, action: "portfolio.created", entityType: "portfolio", entityId: portfolio.id });
  return portfolio;
}

export async function listPortfolios(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.propertyRead);
  return db.portfolio.findMany({ where: { organisationId, archivedAt: null }, orderBy: { name: "asc" } });
}

export async function listProperties(userId: string, organisationId: string, filters?: { status?: string; portfolioId?: string; category?: string; search?: string }) {
  await requirePermission(userId, organisationId, PERMISSIONS.propertyRead);
  const where: Prisma.PropertyWhereInput = { organisationId, archivedAt: null };
  if (filters?.status) where.status = filters.status as Prisma.PropertyWhereInput["status"];
  if (filters?.portfolioId) where.portfolioId = filters.portfolioId;
  if (filters?.category) where.category = filters.category as Prisma.PropertyWhereInput["category"];
  if (filters?.search) {
    const search = filters.search.trim();
    if (search) where.OR = [{ name: { contains: search, mode: "insensitive" } }, { referenceNumber: { contains: search, mode: "insensitive" } }, { city: { contains: search, mode: "insensitive" } }];
  }
  return db.property.findMany({
    where,
    select: {
      id: true, name: true, referenceNumber: true, category: true, status: true, city: true, geocodeStatus: true,
      portfolio: { select: { id: true, name: true } },
      _count: { select: { units: true } },
    },
    orderBy: { createdAt: "desc" },
  });
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

/** Adds a building (block) with its units to an existing property. */
export async function createBuilding(userId: string, organisationId: string, propertyId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.propertyUpdate);
  const data = createBuildingSchema.parse(input);
  await assertOperational(organisationId, ENTITLEMENTS.unitsMax.key);
  if (data.units.length) await assertWithinLimit(organisationId, ENTITLEMENTS.unitsMax.key, data.units.length);
  return db.$transaction(async (tx) => {
    const property = await tx.property.findFirst({ where: activePropertyScope(organisationId, propertyId), select: { id: true } });
    if (!property) throw notFound();
    const building = await tx.building.create({ data: { propertyId: property.id, name: data.name } });
    if (data.units.length) await tx.unit.createMany({ data: data.units.map((unit) => ({ ...unit, propertyId: property.id, buildingId: building.id })) });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "building.created", entityType: "building", entityId: building.id, metadata: { propertyId: property.id, units: data.units.length } } });
    await tx.domainEvent.create({ data: { organisationId, name: "building.created", aggregateType: "building", aggregateId: building.id, payload: { propertyId: property.id } } });
    return building;
  });
}

export async function createUnit(userId: string, organisationId: string, propertyId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.propertyUpdate);
  const data = createUnitSchema.parse(input);

  await assertOperational(organisationId, ENTITLEMENTS.unitsMax.key);
  await assertWithinLimit(organisationId, ENTITLEMENTS.unitsMax.key, 1);

  return db.$transaction(async (tx) => {
    const property = await tx.property.findFirst({
      where: activePropertyScope(organisationId, propertyId),
      select: { id: true },
    });
    if (!property) throw notFound();

    if (data.buildingId) {
      const building = await tx.building.findFirst({
        where: {
          id: data.buildingId,
          propertyId: property.id,
          archivedAt: null,
        },
        select: { id: true },
      });
      if (!building) {
        throw new AppError(
          "INVALID_BUILDING",
          422,
          "The selected building does not belong to this property.",
        );
      }
    }

    const unit = await tx.unit.create({
      data: {
        propertyId: property.id,
        buildingId: data.buildingId,
        name: data.name,
        unitType: data.unitType,
        floor: data.floor,
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        status: data.status,
      },
    });

    await tx.auditEvent.create({
      data: {
        organisationId,
        actorUserId: userId,
        action: "unit.created",
        entityType: "unit",
        entityId: unit.id,
        metadata: { propertyId: property.id },
      },
    });
    await tx.domainEvent.create({
      data: {
        organisationId,
        name: "unit.created",
        aggregateType: "unit",
        aggregateId: unit.id,
        payload: { propertyId: property.id, buildingId: data.buildingId ?? null },
      },
    });

    return unit;
  });
}

/** Edits a unit of an active property in this organisation. The property scope is checked in the
 * same transaction, so a unit id from another organisation or property is never found. */
export async function updateUnit(userId: string, organisationId: string, propertyId: string, unitId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.propertyUpdate);
  const data = updateUnitSchema.parse(input);
  return db.$transaction(async (tx) => {
    const property = await tx.property.findFirst({ where: activePropertyScope(organisationId, propertyId), select: { id: true } });
    if (!property) throw notFound();
    const result = await tx.unit.updateMany({ where: { id: unitId, propertyId: property.id, archivedAt: null }, data });
    if (result.count !== 1) throw notFound();
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "unit.updated", entityType: "unit", entityId: unit.id, metadata: { propertyId: property.id, changedFields: Object.keys(data) } } });
    await tx.domainEvent.create({ data: { organisationId, name: "unit.updated", aggregateType: "unit", aggregateId: unit.id, payload: { propertyId: property.id, changedFields: Object.keys(data) } } });
    return unit;
  });
}

export async function getProperty(userId: string, organisationId: string, propertyId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.propertyRead);
  const property = await db.property.findFirst({
    where: activePropertyScope(organisationId, propertyId),
    include: {
      portfolio: { select: { id: true, name: true } },
      buildings: {
        where: { archivedAt: null },
        include: { units: { where: { archivedAt: null }, orderBy: { name: "asc" } } },
        orderBy: { name: "asc" },
      },
      units: {
        where: { archivedAt: null, buildingId: null },
        orderBy: { name: "asc" },
      },
      leases: {
        where: {
          archivedAt: null,
          status: { in: ["ACTIVE", "EXPIRING"] },
        },
        select: {
          id: true,
          referenceNumber: true,
          status: true,
          startDate: true,
          endDate: true,
          unitId: true,
          parties: {
            where: { role: "TENANT" },
            select: {
              isPrimary: true,
              tenantOrganisation: {
                select: {
                  id: true,
                  email: true,
                  phone: true,
                  tenant: {
                    select: {
                      legalName: true,
                      preferredName: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { startDate: "desc" },
      },
    },
  });
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
