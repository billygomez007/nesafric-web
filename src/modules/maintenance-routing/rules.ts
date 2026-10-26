import { assertOperational } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import { z } from "zod";
import { db } from "@/platform/database/client";
import type { Prisma } from "@/platform/database/generated/client";
import { AppError, notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { NETWORK_CATEGORY_KEYS, type NetworkCategory } from "@/modules/provider-network/categories";

type Tx = Prisma.TransactionClient;
const uuid = z.string().uuid();
const minor = z.string().regex(/^\d{1,15}$/);
const modes = ["PRE_AUTHORIZED", "INSPECTION_ONLY", "QUOTE_REQUIRED", "APPROVAL_REQUIRED", "ESCALATE"] as const;

const fields = {
  name: z.string().trim().min(2).max(120),
  propertyId: uuid.nullable().optional(),
  unitId: uuid.nullable().optional(),
  category: z.enum(NETWORK_CATEGORY_KEYS as [NetworkCategory, ...NetworkCategory[]]),
  keywords: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
  priorities: z.array(z.enum(["EMERGENCY", "URGENT", "NORMAL", "LOW"])).max(4).default([]),
  primaryProviderOrganisationId: uuid.nullable().optional(),
  backupProviderOrganisationIds: z.array(uuid).max(5).default([]),
  autoDispatch: z.boolean().default(true),
  authorizationMode: z.enum(modes).default("QUOTE_REQUIRED"),
  spendingCapMinor: minor.nullable().optional(),
  responseTimeoutMinutes: z.number().int().min(5).max(10_080).default(60),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  escalationMemberId: uuid.nullable().optional(),
  notifyTenant: z.boolean().default(true),
  requireCompletionVerification: z.boolean().default(false),
};
export const createRuleSchema = z.object(fields).strict().superRefine((value, context) => {
  if (value.authorizationMode === "PRE_AUTHORIZED" && !value.spendingCapMinor) context.addIssue({ code: "custom", path: ["spendingCapMinor"], message: "Pre-authorised repairs need a spending cap." });
});
export const updateRuleSchema = z.object({
  // Plain optionals (no defaults): a field left out of an update is never reset.
  name: fields.name.optional(), keywords: z.array(z.string().trim().min(2).max(40)).max(20).optional(), priorities: z.array(z.enum(["EMERGENCY", "URGENT", "NORMAL", "LOW"])).max(4).optional(),
  primaryProviderOrganisationId: fields.primaryProviderOrganisationId, backupProviderOrganisationIds: z.array(uuid).max(5).optional(),
  autoDispatch: z.boolean().optional(), authorizationMode: z.enum(modes).optional(), spendingCapMinor: fields.spendingCapMinor,
  responseTimeoutMinutes: z.number().int().min(5).max(10_080).optional(), maxAttempts: z.number().int().min(1).max(10).optional(),
  escalationMemberId: fields.escalationMemberId, notifyTenant: z.boolean().optional(), requireCompletionVerification: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one change is required.");

const serialize = <T extends { spendingCapMinor: bigint | null }>(rule: T) => ({ ...rule, spendingCapMinor: rule.spendingCapMinor?.toString() ?? null });
const snapshot = (rule: { autoDispatch: boolean; authorizationMode: string; spendingCapMinor: bigint | null; pausedAt: Date | null; primaryProviderOrganisationId: string | null; backupProviderOrganisationIds: string[]; responseTimeoutMinutes: number; maxAttempts: number; archivedAt: Date | null }) => ({
  autoDispatch: rule.autoDispatch, authorizationMode: rule.authorizationMode, spendingCapMinor: rule.spendingCapMinor?.toString() ?? null, paused: Boolean(rule.pausedAt),
  primaryProviderOrganisationId: rule.primaryProviderOrganisationId, backupProviderOrganisationIds: rule.backupProviderOrganisationIds, responseTimeoutMinutes: rule.responseTimeoutMinutes, maxAttempts: rule.maxAttempts, archived: Boolean(rule.archivedAt),
});

async function record(tx: Tx, organisationId: string, userId: string, action: string, ruleId: string, metadata: Record<string, unknown>) {
  await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action, entityType: "maintenance_routing_rule", entityId: ruleId, metadata: JSON.parse(JSON.stringify(metadata)) } });
  await tx.domainEvent.create({ data: { organisationId, name: action, aggregateType: "maintenance_routing_rule", aggregateId: ruleId, payload: JSON.parse(JSON.stringify(metadata)) } });
}

async function validateReferences(tx: Tx, organisationId: string, input: { propertyId?: string | null; unitId?: string | null; primaryProviderOrganisationId?: string | null; backupProviderOrganisationIds?: string[]; escalationMemberId?: string | null }) {
  if (input.unitId && !input.propertyId) throw new AppError("INVALID_RULE_SCOPE", 422, "A unit rule needs its property.");
  if (input.propertyId && !await tx.property.findFirst({ where: { id: input.propertyId, organisationId, archivedAt: null }, select: { id: true } })) throw notFound();
  if (input.unitId && !await tx.unit.findFirst({ where: { id: input.unitId, propertyId: input.propertyId!, archivedAt: null }, select: { id: true } })) throw notFound();
  const providers = [input.primaryProviderOrganisationId, ...(input.backupProviderOrganisationIds ?? [])].filter((id): id is string => Boolean(id));
  if (providers.length && await tx.providerOrganisation.count({ where: { id: { in: providers }, landlordOrganisationId: organisationId, status: { not: "ARCHIVED" } } }) !== new Set(providers).size) {
    throw new AppError("INVALID_RULE_PROVIDER", 422, "Every provider in a rule must be in your provider network.");
  }
  if (input.escalationMemberId && !await tx.organisationMember.findFirst({ where: { id: input.escalationMemberId, organisationId, status: "ACTIVE" }, select: { id: true } })) throw notFound();
}

export async function listRoutingRules(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceRead);
  const rules = await db.maintenanceRoutingRule.findMany({ where: { organisationId, archivedAt: null }, include: { property: { select: { name: true } }, unit: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  return rules.map(serialize);
}

/** Creating a rule authorises automatic dispatch under it, so it needs both maintenance and provider rights. */
export async function createRoutingRule(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceManage);
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceAssign);
  // Configurable routing and escalation rules are a Growth feature.
  await assertOperational(organisationId, ENTITLEMENTS.pmEscalationRulesEnabled.key);
  const data = createRuleSchema.parse(input);
  // A rule that pre-authorises spend needs the same right as approving a quote (as on update).
  if (data.authorizationMode === "PRE_AUTHORIZED" || data.spendingCapMinor) await requirePermission(userId, organisationId, PERMISSIONS.maintenanceApprove);
  return db.$transaction(async (tx) => {
    await validateReferences(tx, organisationId, data);
    const rule = await tx.maintenanceRoutingRule.create({ data: { ...data, organisationId, createdByUserId: userId, spendingCapMinor: data.spendingCapMinor ? BigInt(data.spendingCapMinor) : null } });
    await record(tx, organisationId, userId, "maintenance_rule.created", rule.id, { category: rule.category, propertyId: rule.propertyId, unitId: rule.unitId, after: snapshot(rule) });
    return serialize(rule);
  });
}

export async function updateRoutingRule(userId: string, organisationId: string, ruleId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceManage);
  await assertOperational(organisationId, ENTITLEMENTS.pmEscalationRulesEnabled.key);
  const data = updateRuleSchema.parse(input);
  // Changing who is sent work, or what they may spend, needs the same rights as authorising it.
  if (data.authorizationMode !== undefined || data.spendingCapMinor !== undefined || data.autoDispatch !== undefined || data.primaryProviderOrganisationId !== undefined || data.backupProviderOrganisationIds !== undefined) {
    await requirePermission(userId, organisationId, PERMISSIONS.maintenanceAssign);
    await requirePermission(userId, organisationId, PERMISSIONS.maintenanceApprove);
  }
  return db.$transaction(async (tx) => {
    const current = await tx.maintenanceRoutingRule.findFirst({ where: { id: ruleId, organisationId, archivedAt: null } });
    if (!current) throw notFound();
    await validateReferences(tx, organisationId, { propertyId: current.propertyId, ...data });
    const mode = data.authorizationMode ?? current.authorizationMode;
    const cap = data.spendingCapMinor === undefined ? current.spendingCapMinor : data.spendingCapMinor === null ? null : BigInt(data.spendingCapMinor);
    if (mode === "PRE_AUTHORIZED" && !cap) throw new AppError("SPENDING_CAP_REQUIRED", 422, "Pre-authorised repairs need a spending cap.");
    const { spendingCapMinor, ...rest } = data;
    void spendingCapMinor;
    const updated = await tx.maintenanceRoutingRule.update({ where: { id: current.id }, data: { ...rest, spendingCapMinor: cap } });
    await record(tx, organisationId, userId, "maintenance_rule.updated", current.id, { before: snapshot(current), after: snapshot(updated) });
    return serialize(updated);
  });
}

/** Pausing stops new automatic assignments under the rule at once; existing jobs are untouched. */
export async function setRoutingRulePaused(userId: string, organisationId: string, ruleId: string, paused: boolean) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceManage);
  // Pausing only ever reduces automation; resuming switches it back on.
  if (!paused) await requirePermission(userId, organisationId, PERMISSIONS.maintenanceAssign);
  return db.$transaction(async (tx) => {
    const current = await tx.maintenanceRoutingRule.findFirst({ where: { id: ruleId, organisationId, archivedAt: null } });
    if (!current) throw notFound();
    const updated = await tx.maintenanceRoutingRule.update({ where: { id: current.id }, data: { pausedAt: paused ? current.pausedAt ?? new Date() : null } });
    await record(tx, organisationId, userId, paused ? "maintenance_rule.paused" : "maintenance_rule.resumed", current.id, { before: snapshot(current), after: snapshot(updated) });
    return serialize(updated);
  });
}

export async function archiveRoutingRule(userId: string, organisationId: string, ruleId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceManage);
  return db.$transaction(async (tx) => {
    const current = await tx.maintenanceRoutingRule.findFirst({ where: { id: ruleId, organisationId, archivedAt: null } });
    if (!current) throw notFound();
    const updated = await tx.maintenanceRoutingRule.update({ where: { id: current.id }, data: { archivedAt: new Date() } });
    await record(tx, organisationId, userId, "maintenance_rule.archived", current.id, { before: snapshot(current), after: snapshot(updated) });
    return serialize(updated);
  });
}
