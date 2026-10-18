import { z } from "zod";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { context, decide, sendAttempt, type Candidate } from "./dispatch";

type Event = { at: Date; kind: string; summary: string; details?: Record<string, unknown> };
const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item)));

/**
 * Everything that happened to one maintenance request, in order: the original report and its
 * classification, every routing decision and the rule behind it, each dispatch attempt and why
 * the provider was chosen, provider answers, quotes and approvals, work and costs, evidence,
 * escalations and who was told, and the delivery outcome of each WhatsApp message. Used by the
 * landlord's team and, under a support session, by NesAfric support.
 */
export async function buildMaintenanceTimeline(organisationId: string, requestId: string) {
  const request = await db.maintenanceRequest.findFirst({
    where: { id: requestId, organisationId },
    include: {
      property: { select: { name: true } }, unit: { select: { name: true } },
      history: { include: { actor: { select: { displayName: true } } } },
      routingDecisions: { include: { routingRule: { select: { name: true } } } },
      dispatchAttempts: { include: { serviceProvider: { select: { displayName: true } } } },
      approvals: true, escalations: true, attachments: { select: { fileName: true, createdAt: true } },
      workOrders: { include: { providerAssignments: { include: { provider: { select: { displayName: true } } } } } },
    },
  });
  if (!request) throw notFound();
  const escalationIds = request.escalations.map((escalation) => escalation.id);
  const attemptIds = request.dispatchAttempts.map((attempt) => attempt.id);
  const [notifications, workOrderMessages, alertMessages] = await Promise.all([
    db.staffNotification.findMany({ where: { escalationId: { in: escalationIds } } }),
    db.message.findMany({ where: { externalMessageId: { in: [...attemptIds.map((id) => `work-order:${id}`), ...escalationIds.flatMap((id) => [`alert:${id}`])] } }, include: { deliveries: { select: { status: true, failureReason: true, sentAt: true, deliveredAt: true, readAt: true } } }, take: 200 }),
    db.message.findMany({ where: { OR: escalationIds.map((id) => ({ externalMessageId: { startsWith: `alert:${id}:` } })) }, include: { deliveries: { select: { status: true, failureReason: true, sentAt: true, deliveredAt: true, readAt: true } } }, take: 200 }),
  ]);
  const relevantMessages = [...workOrderMessages, ...(escalationIds.length ? alertMessages : [])];

  const events: Event[] = [
    { at: request.createdAt, kind: "reported", summary: `${request.referenceNumber} reported${request.intakeChannel ? ` via ${request.intakeChannel}` : ""}: ${request.title}`, details: { originalReport: request.originalReport, classification: request.classification, category: request.category, priority: request.priority } },
    ...request.history.map((entry) => ({ at: entry.createdAt, kind: `history.${entry.type.toLowerCase()}`, summary: `${entry.actor.displayName}: ${entry.note ?? `${entry.fromStatus ?? ""} → ${entry.toStatus ?? ""}`}`, details: { fromStatus: entry.fromStatus, toStatus: entry.toStatus, metadata: entry.metadata } })),
    ...request.routingDecisions.map((decision) => ({ at: decision.createdAt, kind: "routing.decision", summary: `${decision.outcome}: ${decision.reason}`, details: { rule: decision.routingRule?.name ?? null, ...(decision.details as object ?? {}) } })),
    ...request.dispatchAttempts.map((attempt) => ({ at: attempt.createdAt, kind: "dispatch.attempt", summary: `Attempt ${attempt.attemptNumber ?? "-"} to ${attempt.serviceProvider?.displayName ?? "provider"}: ${attempt.status}${attempt.reason ? ` (${attempt.reason})` : ""}`, details: { tier: attempt.tier, contactedAt: attempt.contactedAt, respondedAt: attempt.respondedAt, expiresAt: attempt.expiresAt, ruleId: attempt.routingRuleId } })),
    ...request.workOrders.flatMap((workOrder) => [
      { at: workOrder.createdAt, kind: "work_order", summary: `Work order ${workOrder.status}: ${workOrder.title}`, details: { authorizationMode: workOrder.authorizationMode, authorizedSpendMinor: workOrder.authorizedSpendMinor, estimateAmountMinor: workOrder.estimateAmountMinor, actualCostAmountMinor: workOrder.actualCostAmountMinor, completedAt: workOrder.completedAt } },
      ...workOrder.providerAssignments.map((assignment) => ({ at: assignment.respondedAt ?? assignment.assignedAt, kind: "assignment", summary: `${assignment.provider.displayName}: ${assignment.status}`, details: { assignedAt: assignment.assignedAt, acceptedAt: assignment.acceptedAt, cancellationNote: assignment.cancellationNote } })),
    ]),
    ...request.approvals.map((approval) => ({ at: approval.decidedAt ?? approval.requestedAt, kind: "approval", summary: `Approval ${approval.status} for ${approval.currencyCode} ${(Number(approval.requestedAmountMinor) / 100).toFixed(2)}`, details: { requestedAt: approval.requestedAt, decidedAt: approval.decidedAt, reason: approval.decisionReason } })),
    ...request.attachments.map((attachment) => ({ at: attachment.createdAt, kind: "evidence", summary: `File ${attachment.fileName}` })),
    ...request.escalations.map((escalation) => ({ at: escalation.createdAt, kind: `escalation.${escalation.level.toLowerCase()}`, summary: `${escalation.reason}: ${escalation.detail}`, details: { notifiedAt: escalation.notifiedAt, resolvedAt: escalation.resolvedAt, recipients: notifications.filter((item) => item.escalationId === escalation.id).map((item) => ({ memberId: item.memberId, status: item.status, detail: item.detail })) } })),
    ...relevantMessages.map((message) => ({ at: message.createdAt, kind: "whatsapp.message", summary: message.body.slice(0, 200), details: { deliveries: message.deliveries } })),
  ];
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return json({ request: { id: request.id, referenceNumber: request.referenceNumber, status: request.status, property: request.property.name, unit: request.unit?.name ?? null }, events });
}

export async function getMaintenanceTimeline(userId: string, organisationId: string, requestId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceRead);
  return buildMaintenanceTimeline(organisationId, requestId);
}

/** Closes any open attempt so a person's decision is never overtaken by a backup or timeout. */
async function supersedeOpenAttempts(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], requestId: string, userId: string, reason: string) {
  const open = await tx.maintenanceDispatchAttempt.findMany({ where: { maintenanceRequestId: requestId, status: { in: ["CONTACT_PENDING", "CONTACTED"] } } });
  for (const attempt of open) {
    await tx.maintenanceDispatchAttempt.update({ where: { id: attempt.id }, data: { status: "BACKUP_REQUIRED", reason } });
    if (attempt.providerAssignmentId) await tx.providerAssignment.updateMany({ where: { id: attempt.providerAssignmentId, status: "PENDING" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: userId, cancellationReason: "CHANGED_PLANS", cancellationAttribution: "LANDLORD", cancellationNote: reason } });
  }
  return open.length;
}

const manualDispatchSchema = z.object({
  providerOrganisationId: z.string().uuid(),
  authorizationMode: z.enum(["PRE_AUTHORIZED", "INSPECTION_ONLY", "QUOTE_REQUIRED"]).default("QUOTE_REQUIRED"),
  authorizedSpendMinor: z.string().regex(/^\d{1,15}$/).optional(),
  responseTimeoutMinutes: z.number().int().min(5).max(10_080).default(120),
}).strict().superRefine((value, ctx) => {
  if (value.authorizationMode === "PRE_AUTHORIZED" && !value.authorizedSpendMinor) ctx.addIssue({ code: "custom", path: ["authorizedSpendMinor"], message: "Pre-authorised work needs an amount." });
});

/**
 * A person sends the job to a provider of their choice, overriding the rule. The provider must be
 * an active network member who has agreed to receive work. Earlier attempts are kept and marked as
 * superseded; nothing in the history is removed.
 */
export async function manualDispatch(userId: string, organisationId: string, requestId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceAssign);
  const data = manualDispatchSchema.parse(input);
  const member = await db.providerOrganisation.findFirst({ where: { id: data.providerOrganisationId, landlordOrganisationId: organisationId, status: "ACTIVE", consentedAt: { not: null }, provider: { archivedAt: null, suspendedAt: null } }, include: { provider: { select: { id: true, displayName: true, contactPhone: true } } } });
  if (!member) throw new AppError("PROVIDER_NOT_AVAILABLE", 422, "Choose an active provider from your network who has agreed to receive work.");
  const { request, location } = await context(db, requestId);
  if (request.organisationId !== organisationId) throw notFound();
  if (["COMPLETED", "CLOSED", "CANCELLED", "REJECTED"].includes(request.status)) throw new AppError("REQUEST_CLOSED", 409, "This request is already finished.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "MaintenanceRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE`;
    await supersedeOpenAttempts(tx, requestId, userId, "Superseded by a manual dispatch.");
    if (request.status === "REPORTED") {
      await tx.maintenanceRequest.update({ where: { id: requestId }, data: { status: "TRIAGED" } });
      await tx.maintenanceHistory.create({ data: { maintenanceRequestId: requestId, actorUserId: userId, type: "STATUS", fromStatus: "REPORTED", toStatus: "TRIAGED", note: "Triaged for a manual dispatch." } });
    }
    const spend = data.authorizationMode === "PRE_AUTHORIZED" ? BigInt(data.authorizedSpendMinor!) : null;
    const existing = await tx.workOrder.findFirst({ where: { maintenanceRequestId: requestId, status: { in: ["OPEN", "ASSIGNED"] } }, orderBy: { createdAt: "desc" } });
    const workOrder = existing
      ? await tx.workOrder.update({ where: { id: existing.id }, data: { authorizationMode: data.authorizationMode, authorizedSpendMinor: spend, status: "OPEN" } })
      : await tx.workOrder.create({ data: { organisationId, maintenanceRequestId: requestId, propertyId: request.propertyId, unitId: request.unitId, createdByUserId: userId, title: `${request.referenceNumber}: ${request.title}`.slice(0, 200), description: request.description, currencyCode: request.property.currencyCode, status: "OPEN", authorizationMode: data.authorizationMode, authorizedSpendMinor: spend } });
    const attempts = await tx.maintenanceDispatchAttempt.findMany({ where: { workOrderId: workOrder.id }, select: { attemptNumber: true } });
    const attemptNumber = Math.max(0, ...attempts.map((attempt) => attempt.attemptNumber ?? 0)) + 1;
    await decide(tx, organisationId, requestId, "MANUAL_DISPATCH", `Sent to ${member.provider.displayName} by a person, overriding the rules.`, null, { providerOrganisationId: member.id, userId, authorizationMode: data.authorizationMode, authorizedSpendMinor: spend });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "maintenance.manual_dispatch", entityType: "maintenance_request", entityId: requestId, metadata: json({ providerOrganisationId: member.id, authorizationMode: data.authorizationMode, authorizedSpendMinor: spend }) } });
    const candidate = { ...member, spendingLimitMinor: member.spendingLimitMinor?.toString() ?? null } as unknown as Candidate;
    return sendAttempt(tx, { organisationId, request, workOrder, rule: { id: null, responseTimeoutMinutes: data.responseTimeoutMinutes, category: member.scopeCategories[0] ?? "general_maintenance" }, candidate, attemptNumber, actorUserId: userId, location, organisationName: request.organisation.name, photos: request._count.attachments });
  });
}

/** Stops automatic handling of one request: open attempts are closed and no backup is tried. */
export async function stopAutomation(userId: string, organisationId: string, requestId: string, reason = "Stopped by a person.") {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceManage);
  return db.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findFirst({ where: { id: requestId, organisationId }, select: { id: true } });
    if (!request) throw notFound();
    const closed = await supersedeOpenAttempts(tx, requestId, userId, reason.slice(0, 300));
    await decide(tx, organisationId, requestId, "MANUAL_OVERRIDE", `Automation stopped: ${reason.slice(0, 300)}`, null, { userId, closedAttempts: closed });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "maintenance.automation_stopped", entityType: "maintenance_request", entityId: requestId, metadata: { closedAttempts: closed, reason } } });
    return { closedAttempts: closed };
  });
}

/** Marks escalations as handled. Their history stays. */
export async function resolveEscalations(userId: string, organisationId: string, input: { escalationId?: string; requestId?: string; note?: string }) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceManage);
  if (!input.escalationId && !input.requestId) throw new AppError("INVALID_INPUT", 422, "Choose an alert or a request.");
  return db.$transaction(async (tx) => {
    const where = { organisationId, resolvedAt: null, ...(input.escalationId ? { id: input.escalationId } : { maintenanceRequestId: input.requestId }) };
    const open = await tx.maintenanceEscalation.findMany({ where, select: { id: true, maintenanceRequestId: true } });
    if (!open.length) return { resolved: 0 };
    await tx.maintenanceEscalation.updateMany({ where: { id: { in: open.map((item) => item.id) } }, data: { resolvedAt: new Date() } });
    for (const item of open) await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "maintenance.escalation_resolved", entityType: "maintenance_escalation", entityId: item.id, metadata: { maintenanceRequestId: item.maintenanceRequestId, note: input.note ?? null } } });
    return { resolved: open.length };
  });
}
