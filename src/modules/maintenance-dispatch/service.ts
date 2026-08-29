import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { requirePermission, PERMISSIONS } from "@/platform/authorization/permissions";
import { assertOperational } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import { maintenanceCategorySchema } from "@/modules/maintenance/schemas";
import { normalizeMaintenanceCategoryToServiceCategoryKey } from "./category-mapping";
import { proposeDispatchSchema, recordProviderResponseSchema } from "./schemas";

/**
 * Phase 21 items 16-19 — the AI maintenance-dispatch provider hierarchy foundation.
 *
 * Hierarchy (item 17), resolved strictly in order and never skipping a tier that still has an
 * untried candidate:
 *   1. PRIVATE       — `ProviderOrganisation.priority = 0` (an operator-marked exclusive/first-call provider)
 *   2. PREFERRED      — `priority` 1-99, ordered ascending
 *   3. STANDARD       — default `priority = 100` directory entries
 *   4. BACKUP         — `isBackup = true`, only tried once every non-backup candidate is exhausted
 *   5. MARKETPLACE_FALLBACK — outside this organisation's own directory entirely; only ever
 *      considered when the caller explicitly opts in (`allowMarketplaceFallback`) — never
 *      automatic — and only exposes category/location, never private work-order detail (item 17's
 *      "do not automatically expose private work-order information to marketplace providers").
 *
 * High-risk financial approvals (estimates above a threshold) remain entirely outside this
 * module — it only ever proposes/records contact and acceptance, never approves spend.
 */

type Tier = "PRIVATE" | "PREFERRED" | "STANDARD" | "BACKUP" | "MARKETPLACE_FALLBACK";

/** `MaintenanceRequest.category` is a plain string column even though intake validates it against
 * `maintenanceCategorySchema` — normalize it to the actual `ServiceCategory.key` these queries
 * match against (see `category-mapping.ts`); a value that somehow isn't one of the known
 * maintenance categories is passed through unchanged rather than thrown on, so a category match
 * can never regress to "no providers found due to an unrecognised input" for legacy/malformed data. */
function toServiceCategoryKey(category: string): string {
  const parsed = maintenanceCategorySchema.safeParse(category);
  return parsed.success ? normalizeMaintenanceCategoryToServiceCategoryKey(parsed.data) : category;
}

function tierForPriority(priority: number, isBackup: boolean): Tier {
  if (isBackup) return "BACKUP";
  if (priority <= 0) return "PRIVATE";
  if (priority < 100) return "PREFERRED";
  return "STANDARD";
}

/** Read-only hierarchy resolution (item 17) — used both by the dispatch proposal below and
 * directly by tests/UI wanting to preview the order without creating an attempt. */
export async function resolveProviderHierarchy(userId: string, organisationId: string, category: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceRead);
  const serviceCategoryKey = toServiceCategoryKey(category);
  const directory = await db.providerOrganisation.findMany({
    where: {
      landlordOrganisationId: organisationId, status: "ACTIVE",
      provider: { archivedAt: null, verificationStatus: "VERIFIED", acceptingWork: true, suspendedAt: null, categories: { some: { category: { key: serviceCategoryKey } } } },
    },
    include: { provider: { select: { id: true, displayName: true, availabilityStatus: true } } },
    orderBy: [{ isBackup: "asc" }, { priority: "asc" }],
  });
  return directory.map((entry) => ({
    providerId: entry.provider.id, displayName: entry.provider.displayName,
    availabilityStatus: entry.provider.availabilityStatus, tier: tierForPriority(entry.priority, entry.isBackup),
    priority: entry.priority,
  }));
}

async function nextUntriedCandidate(organisationId: string, workOrderId: string, category: string) {
  const serviceCategoryKey = toServiceCategoryKey(category);
  const [hierarchy, attempted] = await Promise.all([
    db.providerOrganisation.findMany({
      where: {
        landlordOrganisationId: organisationId, status: "ACTIVE",
        provider: { archivedAt: null, verificationStatus: "VERIFIED", acceptingWork: true, suspendedAt: null, categories: { some: { category: { key: serviceCategoryKey } } } },
      },
      include: { provider: { select: { id: true, displayName: true } } },
      orderBy: [{ isBackup: "asc" }, { priority: "asc" }],
    }),
    db.maintenanceDispatchAttempt.findMany({ where: { workOrderId }, select: { serviceProviderId: true } }),
  ]);
  const attemptedIds = new Set(attempted.map((entry) => entry.serviceProviderId).filter(Boolean));
  const candidate = hierarchy.find((entry) => !attemptedIds.has(entry.provider.id));
  return candidate ? { providerId: candidate.provider.id, displayName: candidate.provider.displayName, tier: tierForPriority(candidate.priority, candidate.isBackup) } : null;
}

/** Marketplace fallback (item 17's tier 4): verified providers outside this organisation's own
 * directory. Deliberately excludes any organisation-private data — only the provider's public
 * identity, category, and service area are ever considered. */
async function marketplaceFallbackCandidate(organisationId: string, category: string) {
  const serviceCategoryKey = toServiceCategoryKey(category);
  return db.serviceProvider.findFirst({
    where: {
      archivedAt: null, verificationStatus: "VERIFIED", acceptingWork: true, suspendedAt: null,
      categories: { some: { category: { key: serviceCategoryKey } } },
      directories: { none: { landlordOrganisationId: organisationId } },
    },
    select: { id: true, displayName: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Proposes (never silently auto-assigns) the next dispatch attempt for a work order (item 16/18):
 * creates a `CONTACT_PENDING` `MaintenanceDispatchAttempt` for the highest-priority untried
 * candidate in the hierarchy. Requires the `propertyos.maintenance.ai_dispatch` entitlement.
 */
export async function proposeDispatch(userId: string, organisationId: string, input: unknown, initiatedByAIEmployeeId?: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceAssign);
  await assertOperational(organisationId, ENTITLEMENTS.maintenanceAiDispatchEnabled.key);
  const data = proposeDispatchSchema.parse(input);
  const workOrder = await db.workOrder.findFirst({ where: { id: data.workOrderId, organisationId } });
  if (!workOrder) throw notFound();
  const request = await db.maintenanceRequest.findFirst({ where: { id: workOrder.maintenanceRequestId, organisationId } });
  if (!request) throw notFound();

  let candidate = await nextUntriedCandidate(organisationId, workOrder.id, request.category);
  let tier: Tier | "MARKETPLACE_FALLBACK" = candidate?.tier ?? "MARKETPLACE_FALLBACK";
  if (!candidate) {
    if (!data.allowMarketplaceFallback) {
      throw new AppError("NO_INTERNAL_PROVIDER_AVAILABLE", 409, "No internal provider is available for this category. Marketplace fallback was not authorised for this request.");
    }
    const fallback = await marketplaceFallbackCandidate(organisationId, request.category);
    if (!fallback) throw new AppError("NO_PROVIDER_AVAILABLE", 404, "No provider — internal or marketplace — is available for this maintenance category.");
    candidate = { providerId: fallback.id, displayName: fallback.displayName, tier: "MARKETPLACE_FALLBACK" as Tier };
    tier = "MARKETPLACE_FALLBACK";
  }

  const attempt = await db.maintenanceDispatchAttempt.create({
    data: {
      organisationId, workOrderId: workOrder.id, maintenanceRequestId: request.id,
      tier, serviceProviderId: candidate.providerId, status: "CONTACT_PENDING",
      initiatedByAIEmployeeId, createdByUserId: initiatedByAIEmployeeId ? undefined : userId,
    },
  });
  await db.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "maintenance.dispatch_proposed", entityType: "maintenance_dispatch_attempt", entityId: attempt.id, metadata: { tier, providerId: candidate.providerId } } });
  await db.domainEvent.create({ data: { organisationId, name: "maintenance.dispatch_proposed", aggregateType: "maintenance_dispatch_attempt", aggregateId: attempt.id, payload: { tier, workOrderId: workOrder.id } } });
  return attempt;
}

/** Records a provider's contact/response (item 19), preparing structured status for Phase 22
 * voice calls. `DECLINED`/`NO_RESPONSE` marks `BACKUP_REQUIRED` so the caller knows to propose
 * the next tier rather than silently stalling. */
export async function recordProviderResponse(userId: string, organisationId: string, attemptId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceAssign);
  const attempt = await db.maintenanceDispatchAttempt.findFirst({ where: { id: attemptId, organisationId } });
  if (!attempt) throw notFound();
  const data = recordProviderResponseSchema.parse(input);
  const resolvedStatus = data.status === "DECLINED" || data.status === "NO_RESPONSE" ? "BACKUP_REQUIRED" : data.status;
  const updated = await db.maintenanceDispatchAttempt.update({
    where: { id: attemptId },
    data: {
      status: resolvedStatus,
      contactedAt: data.status === "CONTACTED" ? new Date() : attempt.contactedAt,
      respondedAt: ["ACCEPTED", "DECLINED", "NO_RESPONSE"].includes(data.status) ? new Date() : attempt.respondedAt,
      reason: data.notes,
    },
  });
  const action = data.status === "ACCEPTED" ? "maintenance.provider_accepted" : data.status === "DECLINED" ? "maintenance.provider_declined" : data.status === "CONTACTED" ? "maintenance.provider_contacted" : "maintenance.provider_backup_requested";
  await db.auditEvent.create({ data: { organisationId, actorUserId: userId, action, entityType: "maintenance_dispatch_attempt", entityId: attempt.id, metadata: { status: resolvedStatus } } });
  if (data.status === "ACCEPTED") {
    await db.workOrder.update({ where: { id: attempt.workOrderId }, data: { status: "ASSIGNED", assignedAt: new Date() } });
    await db.maintenanceDispatchAttempt.update({ where: { id: attemptId }, data: { status: "ASSIGNED" } });
  }
  return updated;
}

export async function listDispatchAttempts(userId: string, organisationId: string, workOrderId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceRead);
  return db.maintenanceDispatchAttempt.findMany({ where: { organisationId, workOrderId }, orderBy: { createdAt: "asc" } });
}
