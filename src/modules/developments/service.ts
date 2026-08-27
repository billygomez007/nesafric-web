import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { requireMarketplaceRole, requireMarketplaceMember } from "@/modules/marketplace-professionals/permissions";
import { assertMarketplaceOperational } from "@/modules/marketplace-professionals/entitlements";
import { MARKETPLACE_ENTITLEMENTS } from "@/modules/marketplace-professionals/catalog";
import { createDevelopmentSchema, updateDevelopmentSchema, createDevelopmentUnitSchema, updateDevelopmentUnitSchema } from "./schemas";

/**
 * A developer's project (Phase 21A item 3), owned by a `MarketplaceProfessional`. Deliberately
 * independent of PropertyOS `Property`/`Unit` — a developer may participate in the marketplace
 * without ever subscribing to PropertyOS management (item 8).
 */
export async function createDevelopment(userId: string, marketplaceProfessionalId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  await assertMarketplaceOperational(marketplaceProfessionalId, MARKETPLACE_ENTITLEMENTS.developmentsMax.key);
  const data = createDevelopmentSchema.parse(input);
  const country = await db.country.findUnique({ where: { code: data.countryCode } });
  if (!country?.isActive) throw new AppError("COUNTRY_UNSUPPORTED", 422, "The selected country is not supported.");
  const development = await db.development.create({ data: { ...data, marketplaceProfessionalId } });
  await recordDevelopmentAudit(marketplaceProfessionalId, userId, "development.created", { developmentId: development.id });
  return development;
}

async function recordDevelopmentAudit(marketplaceProfessionalId: string, actorUserId: string | undefined, action: string, metadata?: Record<string, unknown>) {
  const professional = await db.marketplaceProfessional.findUnique({ where: { id: marketplaceProfessionalId }, select: { backingOrganisationId: true } });
  if (!professional) return;
  await db.auditEvent.create({ data: { organisationId: professional.backingOrganisationId, actorUserId, action, entityType: "development", entityId: metadata?.developmentId as string | undefined ?? marketplaceProfessionalId, metadata: metadata as never } });
}

export async function listDevelopments(userId: string, marketplaceProfessionalId: string) {
  await requireMarketplaceMember(userId, marketplaceProfessionalId);
  return db.development.findMany({
    where: { marketplaceProfessionalId, archivedAt: null },
    include: { _count: { select: { units: true } } },
    orderBy: { createdAt: "desc" },
  });
}

async function loadDevelopmentScoped(marketplaceProfessionalId: string, developmentId: string) {
  const development = await db.development.findFirst({ where: { id: developmentId, marketplaceProfessionalId, archivedAt: null } });
  if (!development) throw notFound();
  return development;
}

export async function getDevelopment(userId: string, marketplaceProfessionalId: string, developmentId: string) {
  await requireMarketplaceMember(userId, marketplaceProfessionalId);
  const development = await db.development.findFirst({
    where: { id: developmentId, marketplaceProfessionalId, archivedAt: null },
    include: { units: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } } },
  });
  if (!development) throw notFound();
  return development;
}

export async function updateDevelopment(userId: string, marketplaceProfessionalId: string, developmentId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  await loadDevelopmentScoped(marketplaceProfessionalId, developmentId);
  const data = updateDevelopmentSchema.parse(input);
  const development = await db.development.update({ where: { id: developmentId }, data });
  await recordDevelopmentAudit(marketplaceProfessionalId, userId, "development.updated", { developmentId });
  return development;
}

export async function createDevelopmentUnit(userId: string, marketplaceProfessionalId: string, developmentId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  await loadDevelopmentScoped(marketplaceProfessionalId, developmentId);
  const data = createDevelopmentUnitSchema.parse(input);
  const unit = await db.developmentUnit.create({ data: { ...data, developmentId } });
  await recordDevelopmentAudit(marketplaceProfessionalId, userId, "development_unit.created", { developmentId, unitId: unit.id });
  return unit;
}

export async function updateDevelopmentUnit(userId: string, marketplaceProfessionalId: string, developmentId: string, unitId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "ADMIN");
  await loadDevelopmentScoped(marketplaceProfessionalId, developmentId);
  const existing = await db.developmentUnit.findFirst({ where: { id: unitId, developmentId, archivedAt: null } });
  if (!existing) throw notFound();
  const data = updateDevelopmentUnitSchema.parse(input);
  const unit = await db.developmentUnit.update({ where: { id: unitId }, data });
  await recordDevelopmentAudit(marketplaceProfessionalId, userId, "development_unit.updated", { developmentId, unitId });
  return unit;
}
