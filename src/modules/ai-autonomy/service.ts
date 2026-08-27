import { Prisma, type AISeverity, type AIAutonomyLevel } from "@/platform/database/generated/client";
import { createAIProposal, createAISession, executeAIActionThroughDomainService, getAIActionPolicyMetadata, listAIActionPolicyMetadata, AUTO_EXECUTE_ACTION_ALLOWLIST, PROHIBITED_AUTONOMOUS_ACTIONS } from "@/modules/ai/service";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { enqueueJob } from "@/platform/jobs/runner";
import { activityQuerySchema, autonomyConfigurationSchema, autonomyPolicySchema, pauseAutomationSchema } from "./schemas";

type Condition = {
  key: string;
  conditionKey: string;
  severity: AISeverity;
  reason: string;
  actionKey?: string;
  arguments?: Record<string, unknown>;
  affectedEntities: Array<{ type: string; id: string }>;
  propertyId?: string;
  eventType?: string;
  channel?: "IN_APP" | "EMAIL" | "SMS" | "WHATSAPP";
  recipientType?: string;
  ageMinutes?: number;
  metadata: Record<string, unknown>;
};

const severityRank: Record<AISeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export function platformAutomationPaused() {
  return process.env.AI_AUTOMATION_PLATFORM_PAUSED?.toLowerCase() === "true";
}

async function scheduleProactiveEvaluation(organisationId: string, runAt = new Date()) {
  const bucket = Math.floor(runAt.getTime() / (15 * 60_000));
  return enqueueJob({
    organisationId,
    type: "ai-proactive-evaluation",
    idempotencyKey: `ai-proactive-evaluation:${organisationId}:${bucket}`,
    payload: { organisationId },
    runAt,
  });
}

function scopeKey(input: {
  propertyId?: string;
  eventType?: string;
  channel?: string;
  recipientType?: string;
}) {
  return [input.propertyId ?? "*", input.eventType ?? "*", input.channel ?? "*", input.recipientType ?? "*"].join(":");
}

function minuteInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find(({ type }) => type === "hour")?.value ?? 0);
  const minute = Number(parts.find(({ type }) => type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function withinWindow(now: Date, start: number | null, end: number | null, timezone: string) {
  if (start === null || end === null) return true;
  const minute = minuteInTimezone(now, timezone);
  if (start === end) return true;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export async function getAutonomyState(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.aiAutonomyRead);
  const [configuration, policies, activities] = await Promise.all([
    db.aIAutonomyConfiguration.findUnique({ where: { organisationId } }),
    db.aIAutonomyPolicy.findMany({ where: { organisationId }, orderBy: [{ actionKey: "asc" }, { createdAt: "asc" }] }),
    db.aIActivity.findMany({
      where: { organisationId },
      include: { escalation: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return {
    configuration,
    policies,
    activities,
    actionCatalog: listAIActionPolicyMetadata(),
    platform: {
      automationPaused: platformAutomationPaused(),
      autoExecuteAllowlist: [...AUTO_EXECUTE_ACTION_ALLOWLIST],
      prohibitedAutonomousActions: [...PROHIBITED_AUTONOMOUS_ACTIONS],
    },
  };
}

export async function listAIActivities(userId: string, organisationId: string, query: unknown = {}) {
  await requirePermission(userId, organisationId, PERMISSIONS.aiAutonomyRead);
  const data = activityQuerySchema.parse(query);
  return db.aIActivity.findMany({
    where: { organisationId, ...(data.status ? { status: data.status } : {}), ...(data.type ? { type: data.type } : {}) },
    include: { escalation: true, proposal: { select: { id: true, status: true, executionResult: true, failureCode: true, failureMessage: true } } },
    orderBy: { createdAt: "desc" },
    take: data.take,
  });
}

export async function updateAutonomyConfiguration(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.aiAutonomyManage);
  const data = autonomyConfigurationSchema.parse(input);
  const actorUserId = data.automationActorUserId ?? userId;
  await requirePermission(actorUserId, organisationId, PERMISSIONS.aiPropose);
  const configuration = await db.$transaction(async (tx) => {
    const configuration = await tx.aIAutonomyConfiguration.upsert({
      where: { organisationId },
      update: {
        enabled: data.enabled,
        defaultLevel: data.defaultLevel,
        communicationAllowed: data.communicationAllowed,
        automationActorUserId: actorUserId,
        updatedByUserId: userId,
      },
      create: {
        organisationId,
        enabled: data.enabled,
        defaultLevel: data.defaultLevel,
        communicationAllowed: data.communicationAllowed,
        automationActorUserId: actorUserId,
        updatedByUserId: userId,
      },
    });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "ai.autonomy_configuration.updated", entityType: "ai_autonomy_configuration", entityId: configuration.id, metadata: { enabled: configuration.enabled, defaultLevel: configuration.defaultLevel, communicationAllowed: configuration.communicationAllowed } } });
    await tx.domainEvent.create({ data: { organisationId, name: "ai.autonomy_configuration.updated", aggregateType: "ai_autonomy_configuration", aggregateId: configuration.id, payload: { enabled: configuration.enabled, defaultLevel: configuration.defaultLevel } } });
    return configuration;
  });
  if (configuration.enabled) await scheduleProactiveEvaluation(organisationId);
  return configuration;
}

export async function setAutomationPaused(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.aiAutonomyPause);
  const data = pauseAutomationSchema.parse(input);
  const current = await db.aIAutonomyConfiguration.findUnique({ where: { organisationId } });
  if (!current) throw new AppError("AI_AUTONOMY_NOT_CONFIGURED", 409, "Configure AI autonomy before using the kill switch.");
  if (current.automationPaused === data.paused) return current;
  const configuration = await db.$transaction(async (tx) => {
    const now = new Date();
    const configuration = await tx.aIAutonomyConfiguration.update({
      where: { organisationId },
      data: {
        automationPaused: data.paused,
        pausedAt: data.paused ? now : current.pausedAt,
        reactivatedAt: data.paused ? current.reactivatedAt : now,
        updatedByUserId: userId,
      },
    });
    const action = data.paused ? "ai.automation.paused" : "ai.automation.reactivated";
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action, entityType: "ai_autonomy_configuration", entityId: configuration.id, metadata: { reason: data.reason } } });
    await tx.domainEvent.create({ data: { organisationId, name: action, aggregateType: "ai_autonomy_configuration", aggregateId: configuration.id, payload: { reason: data.reason } } });
    return configuration;
  });
  if (!configuration.automationPaused) await scheduleProactiveEvaluation(organisationId);
  return configuration;
}

export async function upsertAutonomyPolicy(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.aiAutonomyManage);
  const data = autonomyPolicySchema.parse(input);
  if (PROHIBITED_AUTONOMOUS_ACTIONS.has(data.actionKey) && data.level === "AUTO_EXECUTE") {
    throw new AppError("PLATFORM_AUTONOMY_PROHIBITED", 403, "Platform safety policy prohibits autonomous execution for this action.");
  }
  const metadata = getAIActionPolicyMetadata(data.actionKey);
  if (!metadata) throw new AppError("AI_POLICY_ACTION_UNSUPPORTED", 422, "This action is not available in the controlled AI action catalog.");
  if (data.level === "AUTO_EXECUTE" && !metadata.autoExecuteEligible) {
    throw new AppError("AI_ACTION_NOT_AUTO_EXECUTE_ELIGIBLE", 422, "Platform policy does not allow this action to auto-execute.");
  }
  if (data.propertyId) {
    const property = await db.property.findFirst({ where: { id: data.propertyId, organisationId, archivedAt: null }, select: { id: true } });
    if (!property) throw notFound();
  }
  const key = scopeKey(data);
  return db.$transaction(async (tx) => {
    const policy = await tx.aIAutonomyPolicy.upsert({
      where: { organisationId_actionKey_scopeKey: { organisationId, actionKey: data.actionKey, scopeKey: key } },
      update: {
        enabled: data.enabled,
        level: data.level,
        propertyId: data.propertyId,
        eventType: data.eventType,
        channel: data.channel,
        recipientType: data.recipientType,
        executionWindowStartMinute: data.executionWindowStartMinute,
        executionWindowEndMinute: data.executionWindowEndMinute,
        timezone: data.timezone,
        maxExecutions: data.maxExecutions,
        frequencyWindowMinutes: data.frequencyWindowMinutes,
        escalationAfterMinutes: data.escalationAfterMinutes,
        minSeverity: data.minSeverity,
        maxSeverity: data.maxSeverity,
        monetaryThresholdMinor: data.monetaryThresholdMinor,
        updatedByUserId: userId,
      },
      create: {
        organisationId,
        actionKey: data.actionKey,
        scopeKey: key,
        enabled: data.enabled,
        level: data.level,
        propertyId: data.propertyId,
        eventType: data.eventType,
        channel: data.channel,
        recipientType: data.recipientType,
        executionWindowStartMinute: data.executionWindowStartMinute,
        executionWindowEndMinute: data.executionWindowEndMinute,
        timezone: data.timezone,
        maxExecutions: data.maxExecutions,
        frequencyWindowMinutes: data.frequencyWindowMinutes,
        escalationAfterMinutes: data.escalationAfterMinutes,
        minSeverity: data.minSeverity,
        maxSeverity: data.maxSeverity,
        monetaryThresholdMinor: data.monetaryThresholdMinor,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "ai.autonomy_policy.updated", entityType: "ai_autonomy_policy", entityId: policy.id, metadata: { actionKey: policy.actionKey, level: policy.level, scopeKey: policy.scopeKey } } });
    await tx.domainEvent.create({ data: { organisationId, name: "ai.autonomy_policy.updated", aggregateType: "ai_autonomy_policy", aggregateId: policy.id, payload: { actionKey: policy.actionKey, level: policy.level, scopeKey: policy.scopeKey } } });
    return policy;
  });
}

async function detectConditions(organisationId: string, now: Date): Promise<Condition[]> {
  const leaseThrough = new Date(now.getTime() + 30 * 86_400_000);
  const staleWork = new Date(now.getTime() - 48 * 60 * 60_000);
  const staleReview = new Date(now.getTime() - 24 * 60 * 60_000);
  const [
    expiringLeases,
    overdueLeases,
    emergencyMaintenance,
    stalledWorkOrders,
    applications,
    viewings,
    moveIns,
    moveOuts,
    failedNotifications,
    failedJobs,
    vacantUnits,
    staleLeads,
  ] = await Promise.all([
    db.lease.findMany({
      where: { organisationId, archivedAt: null, status: { in: ["ACTIVE", "EXPIRING"] }, endDate: { gte: now, lte: leaseThrough } },
      select: { id: true, propertyId: true, endDate: true, parties: { select: { tenantOrganisationId: true } } },
      take: 100,
    }),
    db.lease.findMany({
      where: { organisationId, archivedAt: null, obligations: { some: { status: "OVERDUE" } } },
      select: { id: true, propertyId: true, parties: { select: { tenantOrganisationId: true } } },
      take: 100,
    }),
    db.maintenanceRequest.findMany({
      where: { organisationId, priority: "EMERGENCY", status: { in: ["REPORTED", "TRIAGED", "AWAITING_APPROVAL", "APPROVED", "ASSIGNED", "IN_PROGRESS"] } },
      select: { id: true, propertyId: true, createdAt: true },
      take: 100,
    }),
    db.workOrder.findMany({
      where: { organisationId, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] }, updatedAt: { lt: staleWork } },
      select: { id: true, propertyId: true, updatedAt: true },
      take: 100,
    }),
    db.rentalApplication.findMany({
      where: { organisationId, status: { in: ["SUBMITTED", "UNDER_REVIEW", "MORE_INFORMATION_REQUIRED"] }, lastActivityAt: { lt: staleReview } },
      select: { id: true, listing: { select: { propertyId: true } }, lastActivityAt: true },
      take: 100,
    }),
    db.viewingRequest.findMany({
      where: { organisationId, status: "REQUESTED", createdAt: { lt: staleReview } },
      select: { id: true, listing: { select: { propertyId: true } }, createdAt: true },
      take: 100,
    }),
    db.moveIn.findMany({
      where: { organisationId, status: { not: "COMPLETED" }, scheduledDate: { lte: now } },
      select: { id: true, leaseId: true, lease: { select: { propertyId: true } }, scheduledDate: true },
      take: 100,
    }),
    db.moveOut.findMany({
      where: { organisationId, status: { in: ["SETTLEMENT_PENDING", "READY_TO_CLOSE"] } },
      select: { id: true, leaseId: true, lease: { select: { propertyId: true } }, updatedAt: true },
      take: 100,
    }),
    db.notification.findMany({
      where: { organisationId, status: "FAILED" },
      select: { id: true, leaseId: true, eventType: true, channel: true, failedAt: true, deliveryAttempts: true },
      take: 100,
    }),
    db.backgroundJob.findMany({
      where: { organisationId, status: "FAILED", type: { not: "ai-proactive-evaluation" } },
      select: { id: true, type: true, attempts: true, maxAttempts: true, updatedAt: true },
      take: 100,
    }),
    db.unit.findMany({
      where: { property: { organisationId }, archivedAt: null, status: "AVAILABLE", listings: { none: { status: { in: ["PUBLISHED", "RESERVED"] } } } },
      select: { id: true, propertyId: true, updatedAt: true },
      take: 100,
    }),
    db.marketplaceLead.findMany({
      where: { organisationId, status: { notIn: ["CLOSED", "LOST"] }, lastActivityAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } },
      select: { id: true, listing: { select: { propertyId: true } }, lastActivityAt: true },
      take: 100,
    }),
  ]);

  const age = (date: Date | null | undefined) => date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000)) : 0;
  const conditions: Condition[] = [];
  for (const lease of expiringLeases) for (const party of lease.parties) conditions.push({
    key: `lease-expiry:${lease.id}:${party.tenantOrganisationId}:IN_APP`,
    conditionKey: "lease.approaching_expiry",
    severity: "MEDIUM",
    reason: "A lease expires within 30 days.",
    actionKey: "reminder.send",
    arguments: { leaseId: lease.id, tenantOrganisationId: party.tenantOrganisationId, eventType: "LEASE_EXPIRY", channel: "IN_APP" },
    affectedEntities: [{ type: "lease", id: lease.id }, { type: "tenant", id: party.tenantOrganisationId }],
    propertyId: lease.propertyId,
    eventType: "LEASE_EXPIRY",
    channel: "IN_APP",
    recipientType: "TENANT",
    metadata: { endDate: lease.endDate?.toISOString() },
  });
  for (const lease of overdueLeases) for (const party of lease.parties) conditions.push({
    key: `rent-overdue:${lease.id}:${party.tenantOrganisationId}:IN_APP`,
    conditionKey: "rent.overdue",
    severity: "HIGH",
    reason: "The lease has one or more overdue rent obligations.",
    actionKey: "reminder.send",
    arguments: { leaseId: lease.id, tenantOrganisationId: party.tenantOrganisationId, eventType: "RENT_OVERDUE", channel: "IN_APP" },
    affectedEntities: [{ type: "lease", id: lease.id }, { type: "tenant", id: party.tenantOrganisationId }],
    propertyId: lease.propertyId,
    eventType: "RENT_OVERDUE",
    channel: "IN_APP",
    recipientType: "TENANT",
    metadata: {},
  });
  for (const item of failedNotifications) conditions.push({
    key: `notification-failed:${item.id}:${item.deliveryAttempts}`,
    conditionKey: "notification.failed",
    severity: item.deliveryAttempts >= 2 ? "HIGH" : "MEDIUM",
    reason: "Notification delivery failed and may be eligible for retry.",
    actionKey: "notification.retry",
    arguments: { notificationId: item.id },
    affectedEntities: [{ type: "notification", id: item.id }],
    eventType: item.eventType,
    channel: item.channel,
    ageMinutes: age(item.failedAt),
    metadata: { attempts: item.deliveryAttempts, leaseId: item.leaseId },
  });
  for (const item of failedJobs.filter(({ attempts, maxAttempts }) => attempts < maxAttempts)) conditions.push({
    key: `job-failed:${item.id}:${item.attempts}`,
    conditionKey: "background_job.failed",
    severity: item.attempts >= 2 ? "HIGH" : "MEDIUM",
    reason: "A background job failed within its retry budget.",
    actionKey: "background_job.retry",
    arguments: { jobId: item.id },
    affectedEntities: [{ type: "background_job", id: item.id }],
    ageMinutes: age(item.updatedAt),
    metadata: { type: item.type, attempts: item.attempts, maxAttempts: item.maxAttempts },
  });
  const recommendation = (
    key: string,
    conditionKey: string,
    severity: AISeverity,
    reason: string,
    entity: { type: string; id: string },
    propertyId: string | undefined,
    date: Date,
  ) => conditions.push({ key, conditionKey, severity, reason, affectedEntities: [entity], propertyId, ageMinutes: age(date), metadata: {} });
  emergencyMaintenance.forEach((item) => recommendation(`emergency-maintenance:${item.id}`, "maintenance.emergency_unresolved", "CRITICAL", "Emergency maintenance remains unresolved.", { type: "maintenance_request", id: item.id }, item.propertyId, item.createdAt));
  stalledWorkOrders.forEach((item) => recommendation(`stalled-work-order:${item.id}`, "work_order.stalled", "HIGH", "A work order has had no activity for more than 48 hours.", { type: "work_order", id: item.id }, item.propertyId, item.updatedAt));
  applications.forEach((item) => recommendation(`application-review:${item.id}`, "application.awaiting_review", "MEDIUM", "A rental application is awaiting review.", { type: "application", id: item.id }, item.listing.propertyId ?? undefined, item.lastActivityAt));
  viewings.forEach((item) => recommendation(`viewing-unconfirmed:${item.id}`, "viewing.unconfirmed", "MEDIUM", "A viewing request remains unconfirmed.", { type: "viewing", id: item.id }, item.listing.propertyId ?? undefined, item.createdAt));
  moveIns.forEach((item) => recommendation(`move-in-incomplete:${item.id}`, "move_in.incomplete", "HIGH", "A scheduled move-in is incomplete.", { type: "lease", id: item.leaseId }, item.lease.propertyId, item.scheduledDate ?? now));
  moveOuts.forEach((item) => recommendation(`move-out-pending:${item.id}`, "move_out.pending", "HIGH", "A move-out is awaiting settlement or closure.", { type: "lease", id: item.leaseId }, item.lease.propertyId, item.updatedAt));
  vacantUnits.forEach((item) => recommendation(`vacancy-unmarketed:${item.id}`, "vacancy.not_marketed", "MEDIUM", "An available unit has no published or reserved listing.", { type: "unit", id: item.id }, item.propertyId, item.updatedAt));
  staleLeads.forEach((item) => recommendation(`lead-stale:${item.id}`, "lead.no_follow_up", "MEDIUM", "A marketplace lead has no activity for seven days.", { type: "lead", id: item.id }, item.listing.propertyId ?? undefined, item.lastActivityAt));
  return conditions;
}

function matchingPolicy<T extends {
  propertyId: string | null;
  eventType: string | null;
  channel: string | null;
  recipientType: string | null;
}>(policies: T[], condition: Condition) {
  return policies
    .filter((policy) =>
      (!policy.propertyId || policy.propertyId === condition.propertyId)
      && (!policy.eventType || policy.eventType === condition.eventType)
      && (!policy.channel || policy.channel === condition.channel)
      && (!policy.recipientType || policy.recipientType === condition.recipientType))
    .sort((a, b) => Number(Boolean(b.propertyId)) - Number(Boolean(a.propertyId)))[0];
}

async function claimActivity(data: Prisma.AIActivityUncheckedCreateInput) {
  const claimed = await db.aIActivity.createMany({ data, skipDuplicates: true });
  if (claimed.count === 0) return null;
  return db.aIActivity.findUniqueOrThrow({
    where: {
      organisationId_idempotencyKey: {
        organisationId: data.organisationId,
        idempotencyKey: data.idempotencyKey,
      },
    },
  });
}

async function recordActivityEvent(activity: { id: string; organisationId: string; type: string; status: string; actionKey: string | null; policyDecision: string }) {
  await db.$transaction([
    db.auditEvent.create({ data: { organisationId: activity.organisationId, action: "ai.activity.recorded", entityType: "ai_activity", entityId: activity.id, metadata: { type: activity.type, status: activity.status, actionKey: activity.actionKey, policyDecision: activity.policyDecision } } }),
    db.domainEvent.create({ data: { organisationId: activity.organisationId, name: "ai.activity.recorded", aggregateType: "ai_activity", aggregateId: activity.id, payload: { type: activity.type, status: activity.status, actionKey: activity.actionKey, policyDecision: activity.policyDecision } } }),
  ]);
}

async function createEscalation(activityId: string, organisationId: string, reason: string, severity: AISeverity) {
  const existing = await db.aIEscalation.findUnique({ where: { activityId } });
  if (existing) return existing;
  return db.$transaction(async (tx) => {
    const escalation = await tx.aIEscalation.create({ data: { activityId, reason, level: severityRank[severity] + 1 } });
    const activity = await tx.aIActivity.create({
      data: {
        organisationId,
        parentActivityId: activityId,
        type: "ESCALATION",
        status: "RECORDED",
        severity,
        conditionKey: "ai.escalation",
        policyDecision: "HUMAN_REVIEW_REQUIRED",
        reason,
        triggeringCondition: { sourceActivityId: activityId },
        affectedEntities: [],
        idempotencyKey: `escalation:${activityId}`,
        aiProviderKey: "deterministic",
      },
    });
    await tx.auditEvent.create({ data: { organisationId, action: "ai.escalation.created", entityType: "ai_activity", entityId: activity.id, metadata: { sourceActivityId: activityId, severity } } });
    await tx.domainEvent.create({ data: { organisationId, name: "ai.escalation.created", aggregateType: "ai_activity", aggregateId: activity.id, payload: { sourceActivityId: activityId, severity } } });
    return escalation;
  });
}

export async function evaluateProactiveOperations(organisationId: string, now = new Date()) {
  const configuration = await db.aIAutonomyConfiguration.findUnique({ where: { organisationId } });
  const conditions = await detectConditions(organisationId, now);
  const policies = await db.aIAutonomyPolicy.findMany({ where: { organisationId, enabled: true } });
  const results: Array<{ conditionKey: string; decision: string; activityId?: string }> = [];

  for (const condition of conditions) {
    if (!condition.actionKey) {
      const activity = await claimActivity({
        organisationId,
        type: "RECOMMENDATION",
        status: "RECORDED",
        severity: condition.severity,
        conditionKey: condition.conditionKey,
        policyDecision: "MONITOR_ONLY",
        reason: condition.reason,
        triggeringCondition: condition.metadata as Prisma.InputJsonValue,
        affectedEntities: condition.affectedEntities as Prisma.InputJsonValue,
        idempotencyKey: `${condition.key}:${now.toISOString().slice(0, 10)}`,
        aiProviderKey: "deterministic",
      });
      if (activity) {
        await recordActivityEvent(activity);
        if (condition.severity === "CRITICAL") await createEscalation(activity.id, organisationId, condition.reason, condition.severity);
      }
      results.push({ conditionKey: condition.conditionKey, decision: "MONITOR_ONLY", activityId: activity?.id });
      continue;
    }

    const policy = matchingPolicy(policies.filter(({ actionKey }) => actionKey === condition.actionKey), condition);
    let level: AIAutonomyLevel = policy?.level ?? configuration?.defaultLevel ?? "DISABLED";
    let decision: string = level;
    if (!configuration?.enabled || !policy?.enabled && policy !== undefined || level === "DISABLED") {
      level = "DISABLED";
      decision = "DISABLED";
    } else if (platformAutomationPaused()) {
      decision = "BLOCKED_PLATFORM_KILL_SWITCH";
    } else if (configuration.automationPaused) {
      decision = "BLOCKED_ORGANISATION_KILL_SWITCH";
    } else if (level === "AUTO_EXECUTE" && !AUTO_EXECUTE_ACTION_ALLOWLIST.has(condition.actionKey)) {
      level = "APPROVAL_REQUIRED";
      decision = "PLATFORM_DOWNGRADED_TO_APPROVAL";
    } else if (policy?.minSeverity && severityRank[condition.severity] < severityRank[policy.minSeverity]) {
      decision = "BLOCKED_MINIMUM_SEVERITY";
    } else if (policy?.maxSeverity && severityRank[condition.severity] > severityRank[policy.maxSeverity]) {
      decision = "BLOCKED_MAXIMUM_SEVERITY";
    } else if (policy && !withinWindow(now, policy.executionWindowStartMinute, policy.executionWindowEndMinute, policy.timezone)) {
      decision = "BLOCKED_EXECUTION_WINDOW";
    } else if (!configuration.communicationAllowed && condition.actionKey === "reminder.send") {
      decision = "BLOCKED_COMMUNICATION_POLICY";
    }

    const blocked = decision.startsWith("BLOCKED") || decision === "DISABLED";
    const frequencyMinutes = policy?.frequencyWindowMinutes ?? 1_440;
    const bucket = Math.floor(now.getTime() / (frequencyMinutes * 60_000));
    const idempotencyKey = `${condition.key}:${bucket}`;
    if (policy?.maxExecutions) {
      const since = new Date(now.getTime() - frequencyMinutes * 60_000);
      const executions = await db.aIActivity.count({ where: { organisationId, policyId: policy.id, type: "AUTO_EXECUTION", status: { in: ["PENDING", "COMPLETED"] }, createdAt: { gte: since } } });
      if (executions >= policy.maxExecutions) decision = "BLOCKED_FREQUENCY_LIMIT";
    }

    const activity = await claimActivity({
      organisationId,
      policyId: policy?.id,
      actorUserId: configuration?.automationActorUserId,
      type: blocked || decision.startsWith("BLOCKED") ? "POLICY_BLOCKED" : level === "RECOMMEND_ONLY" ? "RECOMMENDATION" : level === "APPROVAL_REQUIRED" ? "PROPOSAL" : "AUTO_EXECUTION",
      status: blocked || decision.startsWith("BLOCKED") ? "BLOCKED" : level === "AUTO_EXECUTE" ? "PENDING" : "RECORDED",
      severity: condition.severity,
      conditionKey: condition.conditionKey,
      actionKey: condition.actionKey,
      autonomyLevel: level,
      policyDecision: decision,
      reason: condition.reason,
      triggeringCondition: condition.metadata as Prisma.InputJsonValue,
      affectedEntities: condition.affectedEntities as Prisma.InputJsonValue,
      idempotencyKey,
      aiProviderKey: "deterministic",
    });
    if (!activity) {
      results.push({ conditionKey: condition.conditionKey, decision: "DUPLICATE_PREVENTED" });
      continue;
    }
    await recordActivityEvent(activity);

    if (blocked || decision.startsWith("BLOCKED") || level === "RECOMMEND_ONLY") {
      results.push({ conditionKey: condition.conditionKey, decision, activityId: activity.id });
      continue;
    }
    const automationActorUserId = configuration?.automationActorUserId;
    if (!automationActorUserId) {
      await db.aIActivity.update({ where: { id: activity.id }, data: { type: "FAILURE", status: "FAILED", failureCode: "AI_AUTONOMY_NOT_CONFIGURED", failureMessage: "No automation actor is configured." } });
      await createEscalation(activity.id, organisationId, "Automation actor configuration is missing.", "HIGH");
      results.push({ conditionKey: condition.conditionKey, decision: "FAILED", activityId: activity.id });
      continue;
    }

    if (level === "APPROVAL_REQUIRED") {
      const actorUserId = automationActorUserId;
      let session = await db.aISession.findFirst({ where: { organisationId, userId: actorUserId, status: "ACTIVE", title: "Proactive operations" } });
      if (!session) session = await createAISession(actorUserId, organisationId, { title: "Proactive operations" });
      try {
        const proposal = await createAIProposal(actorUserId, organisationId, {
          sessionId: session.id,
          toolKey: condition.actionKey,
          arguments: condition.arguments ?? {},
          reason: condition.reason,
          explanation: `Deterministic detection created this approval-required proposal. It has not executed.`,
        });
        await db.aIActivity.update({ where: { id: activity.id }, data: { proposalId: proposal.id, status: "PENDING", result: { proposalId: proposal.id } } });
        results.push({ conditionKey: condition.conditionKey, decision, activityId: activity.id });
      } catch (error) {
        await db.aIActivity.update({ where: { id: activity.id }, data: { type: "FAILURE", status: "FAILED", failureCode: error instanceof AppError ? error.code : "PROPOSAL_CREATION_FAILED", failureMessage: error instanceof Error ? error.message : "Proposal creation failed." } });
        await createEscalation(activity.id, organisationId, "Proactive proposal creation failed and requires human review.", "HIGH");
        results.push({ conditionKey: condition.conditionKey, decision: "FAILED", activityId: activity.id });
      }
      continue;
    }

    try {
      const execution = await executeAIActionThroughDomainService(automationActorUserId, organisationId, condition.actionKey, condition.arguments ?? {});
      await db.$transaction(async (tx) => {
        await tx.aIActivity.update({ where: { id: activity.id }, data: { status: "COMPLETED", result: { id: execution.result.id }, executedAt: new Date() } });
        await tx.auditEvent.create({ data: { organisationId, actorUserId: automationActorUserId, action: "ai.autonomous_action.executed", entityType: "ai_activity", entityId: activity.id, metadata: { actionKey: condition.actionKey, resultId: execution.result.id, policyId: policy?.id } } });
        await tx.domainEvent.create({ data: { organisationId, name: "ai.autonomous_action.executed", aggregateType: "ai_activity", aggregateId: activity.id, payload: { actionKey: condition.actionKey, resultId: execution.result.id, policyId: policy?.id } } });
      });
      results.push({ conditionKey: condition.conditionKey, decision: "AUTO_EXECUTED", activityId: activity.id });
    } catch (error) {
      await db.aIActivity.update({ where: { id: activity.id }, data: { type: "FAILURE", status: "FAILED", failureCode: error instanceof AppError ? error.code : "AUTONOMOUS_ACTION_FAILED", failureMessage: error instanceof Error ? error.message : "Autonomous action failed.", executedAt: new Date() } });
      await createEscalation(activity.id, organisationId, "Autonomous action failed and requires human review.", "HIGH");
      results.push({ conditionKey: condition.conditionKey, decision: "FAILED", activityId: activity.id });
    }
  }
  return { detected: conditions.length, results };
}

export async function enqueueProactiveEvaluation(userId: string, organisationId: string, runAt = new Date()) {
  await requirePermission(userId, organisationId, PERMISSIONS.aiAutonomyManage);
  return scheduleProactiveEvaluation(organisationId, runAt);
}

export async function runProactiveEvaluationJob(organisationId: string, now = new Date()) {
  const result = await evaluateProactiveOperations(organisationId, now);
  const next = new Date(now.getTime() + 15 * 60_000);
  await scheduleProactiveEvaluation(organisationId, next);
  return result;
}
