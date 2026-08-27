import { db } from "@/platform/database/client";
import { ENTITLEMENTS } from "./catalog";

/**
 * Deterministic, idempotent usage projections (item 3). Every metric here is a pure aggregate
 * query over existing authoritative tables — never a separately maintained counter that could
 * drift — so recomputing usage always returns the same answer for the same data, and re-running
 * the action that produced a row (e.g. a retried background job) never double-counts because the
 * underlying rows themselves are already the application's own idempotency boundary (unique
 * constraints, "return the existing row" generation logic, etc).
 *
 * Two families of metric:
 *  - "Capacity" metrics (properties, units, team members, AI employees, listings, storage) count
 *    *currently live* records. They are not billing-period scoped: shrinking below a limit again
 *    (e.g. archiving a property) immediately frees capacity, and a downgrade never deletes the
 *    records that exceed a new, lower limit — it just blocks creating more until usage is back
 *    within the limit (see `assertWithinLimit`).
 *  - "Flow" metrics (AI tokens/cost, generated documents, channel messages, integration
 *    operations) are scoped to the subscription's *current billing period* and reset every period.
 */
export type UsagePeriod = { start: Date; end: Date };

async function countActiveProperties(organisationId: string) {
  return db.property.count({ where: { organisationId, archivedAt: null } });
}

async function countActiveUnits(organisationId: string) {
  return db.unit.count({ where: { property: { organisationId, archivedAt: null }, archivedAt: null } });
}

async function countActiveTeamMembers(organisationId: string) {
  return db.organisationMember.count({ where: { organisationId, status: "ACTIVE", archivedAt: null } });
}

async function countActiveAIEmployees(organisationId: string) {
  return db.aIEmployee.count({ where: { organisationId, archivedAt: null } });
}

async function sumStorageBytes(organisationId: string) {
  const result = await db.storageObject.aggregate({ where: { organisationId, archivedAt: null }, _sum: { sizeBytes: true } });
  return result._sum.sizeBytes ?? 0;
}

async function countActiveListings(organisationId: string) {
  return db.listing.count({ where: { organisationId, status: { notIn: ["ARCHIVED", "REJECTED"] } } });
}

async function sumAITokens(organisationId: string, period: UsagePeriod) {
  const result = await db.aIMessage.aggregate({
    where: { session: { organisationId }, createdAt: { gte: period.start, lt: period.end } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (result._sum.inputTokens ?? 0) + (result._sum.outputTokens ?? 0);
}

async function sumAICostNano(organisationId: string, period: UsagePeriod) {
  const result = await db.aIMessage.aggregate({
    where: { session: { organisationId }, createdAt: { gte: period.start, lt: period.end } },
    _sum: { estimatedCostNano: true },
  });
  return Number(result._sum.estimatedCostNano ?? 0);
}

async function countGeneratedDocuments(organisationId: string, period: UsagePeriod) {
  return db.generatedDocument.count({ where: { organisationId, generatedAt: { gte: period.start, lt: period.end } } });
}

async function countOutboundMessages(organisationId: string, period: UsagePeriod) {
  return db.message.count({ where: { organisationId, direction: "OUTBOUND", createdAt: { gte: period.start, lt: period.end } } });
}

/** Every `recordIntegrationOutcome` call writes an `integration.connected`/`integration.failed`
 * `AuditEvent`; counting those reuses the existing append-only integration audit trail instead of
 * introducing a second, parallel usage ledger for the same real-world operations. */
async function countIntegrationOperations(organisationId: string, period: UsagePeriod) {
  return db.auditEvent.count({
    where: { organisationId, action: { startsWith: "integration." }, createdAt: { gte: period.start, lt: period.end } },
  });
}

/** Phase 22B item 14 — voice minutes, reusing the exact same "aggregate over the authoritative
 * table" discipline as every other flow metric here; `VoiceCall.durationSeconds` is only ever set
 * once a call genuinely completes, so this can never over-count a call still in progress. */
async function sumVoiceMinutes(organisationId: string, direction: "INBOUND" | "OUTBOUND", period: UsagePeriod) {
  const result = await db.voiceCall.aggregate({
    where: { organisationId, direction, durationSeconds: { not: null }, createdAt: { gte: period.start, lt: period.end } },
    _sum: { durationSeconds: true },
  });
  return Math.ceil((result._sum.durationSeconds ?? 0) / 60);
}

async function countVoiceCallVolume(organisationId: string, period: UsagePeriod) {
  return db.voiceCall.count({ where: { organisationId, createdAt: { gte: period.start, lt: period.end } } });
}

/** Phase 22C item 11 — a "capacity" metric (like `propertiesMax`), not billing-period scoped: it
 * is the number of calls genuinely in progress *right now*, always live. */
async function countConcurrentVoiceCalls(organisationId: string) {
  return db.voiceCall.count({ where: { organisationId, status: { in: ["QUEUED", "RINGING", "IN_PROGRESS"] } } });
}

/** Resolves current usage for a single feature key. Returns `null` for boolean features and any
 * feature key this module does not know how to measure (there is nothing to compare a limit to). */
export async function getCurrentUsage(organisationId: string, featureKey: string, period: UsagePeriod): Promise<number | null> {
  switch (featureKey) {
    case ENTITLEMENTS.propertiesMax.key: return countActiveProperties(organisationId);
    case ENTITLEMENTS.unitsMax.key: return countActiveUnits(organisationId);
    case ENTITLEMENTS.teamMembersMax.key: return countActiveTeamMembers(organisationId);
    case ENTITLEMENTS.aiEmployeesMax.key: return countActiveAIEmployees(organisationId);
    case ENTITLEMENTS.storageBytesMax.key: return sumStorageBytes(organisationId);
    case ENTITLEMENTS.listingsMax.key: return countActiveListings(organisationId);
    case ENTITLEMENTS.aiTokensMonthlyMax.key: return sumAITokens(organisationId, period);
    case ENTITLEMENTS.aiCostMonthlyNanoMax.key: return sumAICostNano(organisationId, period);
    case ENTITLEMENTS.documentsMonthlyMax.key: return countGeneratedDocuments(organisationId, period);
    case ENTITLEMENTS.messagesMonthlyMax.key: return countOutboundMessages(organisationId, period);
    case ENTITLEMENTS.integrationOperationsMonthlyMax.key: return countIntegrationOperations(organisationId, period);
    case ENTITLEMENTS.voiceCallVolumeMax.key: return countVoiceCallVolume(organisationId, period);
    case ENTITLEMENTS.voiceInboundMinutesMonthlyMax.key: return sumVoiceMinutes(organisationId, "INBOUND", period);
    case ENTITLEMENTS.voiceOutboundMinutesMonthlyMax.key: return sumVoiceMinutes(organisationId, "OUTBOUND", period);
    case ENTITLEMENTS.voiceConcurrentCallsMax.key: return countConcurrentVoiceCalls(organisationId);
    default: return null;
  }
}

/** Usage for every numeric (`LIMIT`) feature key at once, used by the billing settings page and
 * the platform-admin organisation detail view. */
export async function getUsageSnapshot(organisationId: string, period: UsagePeriod) {
  const limitFeatureKeys = Object.values(ENTITLEMENTS).filter((definition) => definition.kind === "LIMIT").map((definition) => definition.key);
  const entries = await Promise.all(limitFeatureKeys.map(async (featureKey) => [featureKey, await getCurrentUsage(organisationId, featureKey, period)] as const));
  return Object.fromEntries(entries) as Record<string, number | null>;
}
