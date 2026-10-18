import { db } from "@/platform/database/client";
import { Prisma } from "@/platform/database/generated/client";
import { AppError } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { NonRetryableJobError } from "@/platform/jobs/errors";
import { eligibleNetworkProviders } from "@/modules/provider-network/service";
import { categoryLabels } from "@/modules/provider-network/categories";
import { queueOfficialTemplate } from "@/modules/whatsapp-assistant/outbound";
import { authorizedSpend, networkCategoryFor, selectRule } from "./evaluate";

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

const OPEN_STATUSES = ["REPORTED", "TRIAGED"] as const;
const ACTIVE_ATTEMPT = ["CONTACT_PENDING", "CONTACTED", "ACCEPTED", "ASSIGNED"] as const;

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item)));

/** Durable record of something a person must look at. Deduplicated per cause. */
export async function escalate(client: Client, input: { organisationId: string; requestId: string; level: "ATTENTION" | "CRITICAL"; reason: string; detail: string; recipientMemberId?: string | null; dedupeKey: string }) {
  const existing = await client.maintenanceEscalation.findUnique({ where: { dedupeKey: input.dedupeKey } });
  if (existing) return existing;
  try {
    const created = await client.maintenanceEscalation.create({ data: { organisationId: input.organisationId, maintenanceRequestId: input.requestId, level: input.level, reason: input.reason, detail: input.detail, recipientMemberId: input.recipientMemberId ?? null, dedupeKey: input.dedupeKey } });
    await client.domainEvent.create({ data: { organisationId: input.organisationId, name: "maintenance.escalated", aggregateType: "maintenance_request", aggregateId: input.requestId, payload: { escalationId: created.id, level: input.level, reason: input.reason } } });
    await client.auditEvent.create({ data: { organisationId: input.organisationId, action: "maintenance.escalated", entityType: "maintenance_request", entityId: input.requestId, metadata: { level: input.level, reason: input.reason } } });
    return created;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return client.maintenanceEscalation.findUniqueOrThrow({ where: { dedupeKey: input.dedupeKey } });
    throw error;
  }
}

async function decide(client: Client, organisationId: string, requestId: string, outcome: string, reason: string, routingRuleId: string | null, details: Record<string, unknown> = {}) {
  await client.maintenanceRoutingDecision.create({ data: { organisationId, maintenanceRequestId: requestId, routingRuleId, outcome, reason, details: json(details) } });
}

function authorisationText(mode: string, spendMinor: bigint | null, currency: string) {
  if (mode === "PRE_AUTHORIZED" && spendMinor && spendMinor > BigInt(0)) return `Repair authorised up to ${currency} ${(Number(spendMinor) / 100).toFixed(2)}. Send a quote before doing anything costing more.`;
  if (mode === "INSPECTION_ONLY") return "Inspect and diagnose only. No paid work is authorised; send a quote after inspecting.";
  return "Send a quote before starting any paid work.";
}

type RuleRow = Awaited<ReturnType<typeof db.maintenanceRoutingRule.findFirstOrThrow>>;
type Candidate = Awaited<ReturnType<typeof eligibleNetworkProviders>>[number];

/** Candidates in the rule's order (primary, then backups), limited to eligible network members. */
async function orderedCandidates(rule: RuleRow, organisationId: string, propertyId: string): Promise<Candidate[]> {
  const eligible = await eligibleNetworkProviders(organisationId, { category: rule.category as never, propertyId });
  const byId = new Map(eligible.map((entry) => [entry.id, entry]));
  const order = [rule.primaryProviderOrganisationId, ...rule.backupProviderOrganisationIds].filter((id): id is string => Boolean(id));
  return [...new Set(order)].map((id) => byId.get(id)).filter((entry): entry is Candidate => Boolean(entry));
}

/**
 * Sends one attempt inside the caller's transaction: a pending provider assignment, the attempt
 * row (unique per work order and number), the work-order template message, and a timeout job.
 * Without an approved template nothing is sent and the attempt is CONTACT_FAILED.
 */
async function sendAttempt(tx: Tx, input: { organisationId: string; request: { id: string; referenceNumber: string | null; title: string; priority: string }; workOrder: { id: string; authorizationMode: string | null; authorizedSpendMinor: bigint | null; currencyCode: string }; rule: RuleRow; candidate: Candidate; attemptNumber: number; actorUserId: string; location: string; organisationName: string; photos: number }) {
  const { organisationId, request, workOrder, rule, candidate } = input;
  const expiresAt = new Date(Date.now() + rule.responseTimeoutMinutes * 60_000);
  const assignment = await tx.providerAssignment.create({ data: { landlordOrganisationId: organisationId, workOrderId: workOrder.id, providerId: candidate.providerId, assignedByUserId: input.actorUserId } });
  const attempt = await tx.maintenanceDispatchAttempt.create({
    data: { organisationId, workOrderId: workOrder.id, maintenanceRequestId: request.id, tier: input.attemptNumber === 1 ? "NETWORK_PRIMARY" : "NETWORK_BACKUP", serviceProviderId: candidate.providerId, status: "CONTACT_PENDING", routingRuleId: rule.id, providerOrganisationId: candidate.id, providerAssignmentId: assignment.id, attemptNumber: input.attemptNumber, expiresAt, createdByUserId: input.actorUserId },
  });
  const phone = candidate.provider.contactPhone;
  const authorisation = authorisationText(workOrder.authorizationMode ?? "QUOTE_REQUIRED", workOrder.authorizedSpendMinor, workOrder.currencyCode);
  const deadline = `${expiresAt.toISOString().slice(11, 16)} UTC`;
  const issue = `${request.title}${input.photos ? ` (${input.photos} photo${input.photos === 1 ? "" : "s"})` : ""}`.slice(0, 300);
  const queued = phone
    ? await queueOfficialTemplate(tx, {
      phoneE164: phone, displayName: candidate.provider.displayName, template: "WORK_ORDER",
      bodyParameters: [input.organisationName, request.referenceNumber ?? "", input.location, issue, request.priority.toLowerCase(), authorisation, deadline],
      body: `New ${categoryLabels([rule.category])} job ${request.referenceNumber} from ${input.organisationName} at ${input.location}: ${issue}. Urgency: ${request.priority.toLowerCase()}. ${authorisation} Reply ACCEPT or DECLINE by ${deadline}.`,
      externalMessageId: `work-order:${attempt.id}`, metadata: { dispatchAttemptId: attempt.id, workOrderId: workOrder.id },
    })
    : { messageId: null, reason: "The provider has no WhatsApp number on file." };
  if ("reason" in queued) {
    await tx.maintenanceDispatchAttempt.update({ where: { id: attempt.id }, data: { status: "CONTACT_FAILED", reason: queued.reason } });
    await tx.providerAssignment.update({ where: { id: assignment.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "OTHER", cancellationAttribution: "SYSTEM", cancellationNote: queued.reason } });
    return { sent: false as const, reason: queued.reason, attemptId: attempt.id };
  }
  await tx.maintenanceDispatchAttempt.update({ where: { id: attempt.id }, data: { status: "CONTACTED", contactedAt: new Date(), messageId: queued.messageId } });
  await tx.backgroundJob.create({ data: { organisationId, type: "maintenance-dispatch-timeout", idempotencyKey: `dispatch-timeout:${attempt.id}`, payload: { organisationId, attemptId: attempt.id }, runAt: expiresAt, maxAttempts: 5 } });
  await tx.domainEvent.create({ data: { organisationId, name: "maintenance.dispatched", aggregateType: "maintenance_request", aggregateId: request.id, payload: { workOrderId: workOrder.id, attemptId: attempt.id, attemptNumber: input.attemptNumber, providerOrganisationId: candidate.id, ruleId: rule.id } } });
  await tx.auditEvent.create({ data: { organisationId, actorUserId: input.actorUserId, action: "maintenance.dispatched", entityType: "work_order", entityId: workOrder.id, metadata: { attemptNumber: input.attemptNumber, providerOrganisationId: candidate.id, ruleId: rule.id, reason: input.attemptNumber === 1 ? "primary provider for rule" : "next provider after no answer or decline" } } });
  return { sent: true as const, attemptId: attempt.id };
}

async function context(client: Client, requestId: string) {
  const request = await client.maintenanceRequest.findUniqueOrThrow({ where: { id: requestId }, include: { property: { select: { name: true, city: true, addressLine1: true, currencyCode: true } }, unit: { select: { name: true } }, organisation: { select: { name: true } }, _count: { select: { attachments: true } } } });
  const location = [request.property.name, request.unit?.name, request.property.addressLine1, request.property.city].filter(Boolean).join(", ");
  return { request, location };
}

/**
 * Background job after a ticket is created. Deterministic: the saved rules and the provider
 * network decide. The AI classification only contributed the category and urgency already on
 * the ticket. Every evaluation is recorded as a routing decision; anything that cannot be
 * dispatched automatically is escalated.
 */
export async function routeMaintenanceRequest(organisationId: string, requestId: string) {
  const { request, location } = await context(db, requestId);
  if (request.organisationId !== organisationId) throw new NonRetryableJobError("Request does not belong to this organisation.");
  if (!OPEN_STATUSES.includes(request.status as (typeof OPEN_STATUSES)[number])) return;
  if (await db.workOrder.findFirst({ where: { maintenanceRequestId: request.id, routingRuleId: { not: null } }, select: { id: true } })) return;

  const classification = (request.classification ?? {}) as { safetyHazard?: boolean };
  if (request.priority === "EMERGENCY" || classification.safetyHazard) {
    await escalate(db, { organisationId, requestId, level: "CRITICAL", reason: "SAFETY", detail: `${request.referenceNumber}: ${request.title} at ${location} was reported as an emergency.`, dedupeKey: `${requestId}:critical` });
  }

  const category = networkCategoryFor(request.category, `${request.title} ${request.description}`);
  const rules = await db.maintenanceRoutingRule.findMany({ where: { organisationId, archivedAt: null, category } });
  const selection = selectRule(rules, { propertyId: request.propertyId, unitId: request.unitId, category, priority: request.priority, text: `${request.title} ${request.description}` });
  const attention = (reason: string, detail: string, rule?: RuleRow) => escalate(db, { organisationId, requestId, level: "ATTENTION", reason, detail: `${request.referenceNumber}: ${detail}`, recipientMemberId: rule?.escalationMemberId, dedupeKey: `${requestId}:${reason}` });

  if (selection.outcome !== "MATCHED") {
    await decide(db, organisationId, requestId, selection.outcome, selection.reason, null, { category, ...(selection.outcome === "AMBIGUOUS_RULES" ? { ruleIds: selection.ruleIds } : {}) });
    return attention(selection.outcome, selection.reason);
  }
  const rule = selection.rule;
  if (rule.pausedAt) {
    await decide(db, organisationId, requestId, "RULE_PAUSED", `Rule "${rule.name}" is paused.`, rule.id);
    return attention("RULE_PAUSED", `automatic dispatch for ${categoryLabels([category])} is paused; the request needs a decision.`, rule);
  }
  if (!rule.autoDispatch || rule.authorizationMode === "APPROVAL_REQUIRED" || rule.authorizationMode === "ESCALATE") {
    const outcome = rule.authorizationMode === "ESCALATE" ? "ESCALATE" : "APPROVAL_REQUIRED";
    await decide(db, organisationId, requestId, outcome, `Rule "${rule.name}" requires a person to decide.`, rule.id);
    return attention(outcome, `${categoryLabels([category])} issues under rule "${rule.name}" need your decision before anyone is sent.`, rule);
  }
  try {
    await requirePermission(rule.createdByUserId, organisationId, PERMISSIONS.maintenanceAssign);
  } catch {
    await decide(db, organisationId, requestId, "RULE_OWNER_NOT_AUTHORISED", "The person who created the rule can no longer assign maintenance.", rule.id);
    return attention("RULE_OWNER_NOT_AUTHORISED", `rule "${rule.name}" was created by someone who can no longer assign work; nothing was sent.`, rule);
  }
  const candidates = await orderedCandidates(rule, organisationId, request.propertyId);
  if (!candidates.length) {
    await decide(db, organisationId, requestId, "NO_PROVIDER", "No provider in the rule is an active, consenting network member for this property.", rule.id);
    return attention("NO_PROVIDER", `no authorised ${categoryLabels([category])} provider is available under rule "${rule.name}".`, rule);
  }
  const first = candidates[0];
  const spend = authorizedSpend(rule.authorizationMode, rule.spendingCapMinor, first.spendingLimitMinor === null ? null : BigInt(first.spendingLimitMinor));

  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "MaintenanceRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE`;
    if (await tx.workOrder.findFirst({ where: { maintenanceRequestId: requestId, routingRuleId: { not: null } }, select: { id: true } })) return null;
    const current = await tx.maintenanceRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (current.status === "REPORTED") {
      await tx.maintenanceRequest.update({ where: { id: requestId }, data: { status: "TRIAGED" } });
      await tx.maintenanceHistory.create({ data: { maintenanceRequestId: requestId, actorUserId: rule.createdByUserId, type: "STATUS", fromStatus: "REPORTED", toStatus: "TRIAGED", note: `Triaged automatically by rule "${rule.name}".`, metadata: { ruleId: rule.id } } });
      await tx.domainEvent.create({ data: { organisationId, name: "maintenance.triaged", aggregateType: "maintenance_request", aggregateId: requestId, payload: { fromStatus: "REPORTED", toStatus: "TRIAGED", ruleId: rule.id } } });
    }
    const workOrder = await tx.workOrder.create({
      data: { organisationId, maintenanceRequestId: requestId, propertyId: request.propertyId, unitId: request.unitId, createdByUserId: rule.createdByUserId, title: `${request.referenceNumber}: ${request.title}`.slice(0, 200), description: request.description, currencyCode: request.property.currencyCode, status: "OPEN", authorizationMode: rule.authorizationMode, authorizedSpendMinor: spend, routingRuleId: rule.id },
    });
    await tx.workOrderHistory.create({ data: { workOrderId: workOrder.id, actorUserId: rule.createdByUserId, status: "OPEN", currencyCode: workOrder.currencyCode, note: `Created by routing rule "${rule.name}".`, metadata: json({ ruleId: rule.id, authorizationMode: rule.authorizationMode, authorizedSpendMinor: spend }) } });
    await decide(tx, organisationId, requestId, "DISPATCHED", `Rule "${rule.name}" selected; sent to ${first.provider.displayName}.`, rule.id, { providerOrganisationId: first.id, authorizationMode: rule.authorizationMode, authorizedSpendMinor: spend, candidates: candidates.map((candidate) => candidate.id) });
    return sendAttempt(tx, { organisationId, request, workOrder, rule, candidate: first, attemptNumber: 1, actorUserId: rule.createdByUserId, location, organisationName: request.organisation.name, photos: request._count.attachments });
  });
  if (result && !result.sent) await attention("WORK_ORDER_NOT_SENT", `the work order could not be sent to ${first.provider.displayName}: ${result.reason}`, rule);
}

/**
 * After a decline or timeout: the next untried eligible provider in the rule's order, one at a
 * time (never in parallel), until the rule's attempt limit; then escalate.
 */
export async function dispatchNextOrEscalate(organisationId: string, workOrderId: string) {
  const workOrder = await db.workOrder.findFirst({ where: { id: workOrderId, organisationId }, include: { dispatchAttempts: { orderBy: { attemptNumber: "asc" } } } });
  if (!workOrder?.routingRuleId || ["COMPLETED", "CANCELLED"].includes(workOrder.status)) return;
  if (workOrder.dispatchAttempts.some((attempt) => (ACTIVE_ATTEMPT as readonly string[]).includes(attempt.status))) return;
  const rule = await db.maintenanceRoutingRule.findUnique({ where: { id: workOrder.routingRuleId } });
  const { request, location } = await context(db, workOrder.maintenanceRequestId);
  const giveUp = (detail: string) => escalate(db, { organisationId, requestId: request.id, level: "ATTENTION", reason: "NO_PROVIDER_ACCEPTED", detail: `${request.referenceNumber}: ${detail}`, recipientMemberId: rule?.escalationMemberId, dedupeKey: `${request.id}:no-provider-accepted:${workOrder.id}` });
  if (!rule || rule.archivedAt || rule.pausedAt) return giveUp("no provider accepted and the routing rule is no longer active.");
  const tried = new Set(workOrder.dispatchAttempts.map((attempt) => attempt.providerOrganisationId));
  if (workOrder.dispatchAttempts.length >= rule.maxAttempts) return giveUp(`no provider accepted after ${workOrder.dispatchAttempts.length} attempt(s).`);
  const next = (await orderedCandidates(rule, organisationId, request.propertyId)).find((candidate) => !tried.has(candidate.id));
  if (!next) return giveUp("no provider accepted and no backup provider is available.");
  const attemptNumber = Math.max(0, ...workOrder.dispatchAttempts.map((attempt) => attempt.attemptNumber ?? 0)) + 1;
  try {
    const result = await db.$transaction(async (tx) => {
      const spend = authorizedSpend(rule.authorizationMode, rule.spendingCapMinor, next.spendingLimitMinor === null ? null : BigInt(next.spendingLimitMinor));
      const updated = await tx.workOrder.update({ where: { id: workOrder.id }, data: { authorizedSpendMinor: spend } });
      await decide(tx, organisationId, request.id, "DISPATCHED", `Sent to backup provider ${next.provider.displayName} (attempt ${attemptNumber}).`, rule.id, { providerOrganisationId: next.id, attemptNumber });
      return sendAttempt(tx, { organisationId, request, workOrder: updated, rule, candidate: next, attemptNumber, actorUserId: rule.createdByUserId, location, organisationName: request.organisation.name, photos: request._count.attachments });
    });
    if (!result.sent) await giveUp(`the work order could not be sent to ${next.provider.displayName}: ${result.reason}`);
  } catch (error) {
    // Another worker already sent this attempt number.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}

/**
 * Timeout job, scheduled for the attempt's deadline: if the provider still has not answered, the
 * attempt becomes NO_RESPONSE and the next provider is tried. An answer that arrived first wins,
 * because only an unanswered attempt is closed.
 */
export async function handleDispatchTimeout(organisationId: string, attemptId: string, now = new Date()) {
  const attempt = await db.maintenanceDispatchAttempt.findFirst({ where: { id: attemptId, organisationId } });
  if (!attempt) return;
  const closed = await db.$transaction(async (tx) => {
    const updated = await tx.maintenanceDispatchAttempt.updateMany({ where: { id: attemptId, status: { in: ["CONTACT_PENDING", "CONTACTED"] } }, data: { status: "NO_RESPONSE", respondedAt: now, reason: "No answer before the deadline." } });
    if (!updated.count) return false;
    if (attempt.providerAssignmentId) await tx.providerAssignment.updateMany({ where: { id: attempt.providerAssignmentId, status: "PENDING" }, data: { status: "CANCELLED", cancelledAt: now, cancellationReason: "OTHER", cancellationAttribution: "PROVIDER", cancellationNote: "No answer before the dispatch deadline." } });
    await tx.domainEvent.create({ data: { organisationId, name: "maintenance.dispatch_no_response", aggregateType: "work_order", aggregateId: attempt.workOrderId, payload: { attemptId } } });
    return true;
  });
  if (closed) await dispatchNextOrEscalate(organisationId, attempt.workOrderId);
}

/** A provider declined: record it, tell the landlord, and try the next provider. */
export async function recordDispatchDecline(organisationId: string, attemptId: string, note?: string) {
  const attempt = await db.maintenanceDispatchAttempt.findFirst({ where: { id: attemptId, organisationId }, include: { maintenanceRequest: { select: { referenceNumber: true } } } });
  if (!attempt) throw new AppError("NOT_FOUND", 404, "Dispatch attempt not found.");
  const closed = await db.$transaction(async (tx) => {
    const updated = await tx.maintenanceDispatchAttempt.updateMany({ where: { id: attemptId, status: { in: ["CONTACT_PENDING", "CONTACTED"] } }, data: { status: "DECLINED", respondedAt: new Date(), reason: note ?? "Declined by the provider." } });
    if (!updated.count) return false;
    if (attempt.providerAssignmentId) await tx.providerAssignment.updateMany({ where: { id: attempt.providerAssignmentId, status: "PENDING" }, data: { status: "DECLINED", respondedAt: new Date() } });
    await escalate(tx, { organisationId, requestId: attempt.maintenanceRequestId, level: "ATTENTION", reason: "PROVIDER_DECLINED", detail: `${attempt.maintenanceRequest.referenceNumber}: a provider declined the job${note ? ` (${note})` : ""}. Trying the next provider if one is set.`, dedupeKey: `${attempt.id}:declined` });
    return true;
  });
  if (closed) await dispatchNextOrEscalate(organisationId, attempt.workOrderId);
  return closed;
}
