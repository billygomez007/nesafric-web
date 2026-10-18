import { db } from "@/platform/database/client";
import { Prisma, type MaintenanceStatus } from "@/platform/database/generated/client";
import { AppError, forbidden, notFound } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { listOwnedProviders } from "@/modules/providers/service";
import { queueOfficialText } from "@/modules/whatsapp-assistant/outbound";
import { escalate } from "./dispatch";

type Tx = Prisma.TransactionClient;
const money = (minor: bigint | number | Prisma.Decimal | null | undefined, currency: string) => minor === null || minor === undefined ? null : `${currency} ${(Number(minor) / 100).toFixed(2)}`;

/** A provider's job: the assignment for a provider the user owns, with only what the job needs. */
const jobInclude = {
  workOrder: { include: { maintenanceRequest: { include: { property: { select: { name: true } }, unit: { select: { name: true } }, _count: { select: { attachments: true } } } }, dispatchAttempts: { orderBy: { attemptNumber: "desc" as const }, take: 1 } } },
  landlordOrganisation: { select: { name: true } },
  provider: { select: { id: true, displayName: true, contactPhone: true } },
} satisfies Prisma.ProviderAssignmentInclude;
export type ProviderJob = Prisma.ProviderAssignmentGetPayload<{ include: typeof jobInclude }>;

/** Open jobs of the providers this user owns, optionally one ticket reference. */
export async function findProviderJobs(userId: string, reference?: string) {
  const providers = await listOwnedProviders(userId);
  if (!providers.length) return [];
  return db.providerAssignment.findMany({
    where: { providerId: { in: providers.map((provider) => provider.id) }, status: { in: ["PENDING", "ACCEPTED"] }, ...(reference ? { workOrder: { maintenanceRequest: { referenceNumber: reference.toUpperCase() } } } : {}) },
    include: jobInclude,
    orderBy: { assignedAt: "desc" },
    take: 10,
  });
}

async function requireJob(userId: string, assignmentId: string, statuses: string[]) {
  const providers = await listOwnedProviders(userId);
  const job = await db.providerAssignment.findFirst({ where: { id: assignmentId, providerId: { in: providers.map((provider) => provider.id) } }, include: jobInclude });
  if (!job) throw notFound();
  if (!statuses.includes(job.status)) throw new AppError("JOB_STATE", 409, job.status === "PENDING" ? "Accept the job first." : "This job is no longer open.");
  return job;
}

async function setRequestStatus(tx: Tx, request: { id: string; organisationId: string; status: MaintenanceStatus }, to: MaintenanceStatus, actorUserId: string, note: string, metadata: Record<string, unknown> = {}) {
  if (request.status === to) return;
  await tx.maintenanceRequest.update({ where: { id: request.id }, data: { status: to, ...(to === "COMPLETED" ? { completedAt: new Date() } : {}), ...(to === "CLOSED" ? { closedAt: new Date() } : {}) } });
  await tx.maintenanceHistory.create({ data: { maintenanceRequestId: request.id, actorUserId, type: "STATUS", fromStatus: request.status, toStatus: to, note, metadata: JSON.parse(JSON.stringify(metadata)) } });
  await tx.domainEvent.create({ data: { organisationId: request.organisationId, name: `maintenance.${to.toLowerCase()}`, aggregateType: "maintenance_request", aggregateId: request.id, payload: { fromStatus: request.status, toStatus: to } } });
  request.status = to;
}

/** Tells the tenant on WhatsApp when the rule asks for it and their number is linked. Never blocks the action. */
async function notifyTenant(tx: Tx, requestId: string, text: string, key: string) {
  const request = await tx.maintenanceRequest.findUnique({ where: { id: requestId }, select: { tenantOrganisation: { select: { userId: true } }, workOrders: { where: { routingRuleId: { not: null } }, select: { routingRuleId: true }, take: 1 } } });
  const ruleId = request?.workOrders[0]?.routingRuleId;
  if (ruleId && !(await tx.maintenanceRoutingRule.findUnique({ where: { id: ruleId }, select: { notifyTenant: true } }))?.notifyTenant) return;
  const userId = request?.tenantOrganisation?.userId;
  if (!userId) return;
  const identity = await tx.channelIdentity.findFirst({ where: { channel: "WHATSAPP", userId, verifiedAt: { not: null }, optedOutAt: null }, include: { user: { select: { displayName: true } } } });
  if (identity) await queueOfficialText(tx, { phoneE164: identity.address, displayName: identity.user?.displayName ?? "Tenant", text, externalMessageId: `tenant-update:${key}` });
}

async function notifyProvider(tx: Tx, job: { provider: { displayName: string; contactPhone: string | null } }, text: string, key: string) {
  if (job.provider.contactPhone) await queueOfficialText(tx, { phoneE164: job.provider.contactPhone, displayName: job.provider.displayName, text, externalMessageId: `provider-update:${key}` });
}

async function audit(tx: Tx, organisationId: string, actorUserId: string, action: string, entityId: string, metadata: Record<string, unknown>) {
  await tx.auditEvent.create({ data: { organisationId, actorUserId, action, entityType: "work_order", entityId, metadata: JSON.parse(JSON.stringify(metadata, (_, value) => (typeof value === "bigint" ? value.toString() : value))) } });
}

/**
 * Accept: only while the attempt is still open, so a late answer after the timeout or after the
 * job moved to a backup is refused.
 */
export async function acceptJob(userId: string, assignmentId: string) {
  const job = await requireJob(userId, assignmentId, ["PENDING"]);
  const request = job.workOrder.maintenanceRequest;
  const attempt = job.workOrder.dispatchAttempts.find((item) => item.providerAssignmentId === job.id) ?? await db.maintenanceDispatchAttempt.findFirst({ where: { providerAssignmentId: job.id } });
  await db.$transaction(async (tx) => {
    if (attempt) {
      const open = await tx.maintenanceDispatchAttempt.updateMany({ where: { id: attempt.id, status: { in: ["CONTACT_PENDING", "CONTACTED"] } }, data: { status: "ASSIGNED", respondedAt: new Date() } });
      if (!open.count) throw new AppError("JOB_CLOSED", 409, "This job is no longer available.");
    }
    const accepted = await tx.providerAssignment.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "ACCEPTED", acceptedAt: new Date(), respondedAt: new Date(), respondedByUserId: userId } });
    if (!accepted.count) throw new AppError("JOB_CLOSED", 409, "This job is no longer available.");
    await tx.workOrder.update({ where: { id: job.workOrderId }, data: { status: "ASSIGNED", assignedAt: new Date() } });
    const current = await tx.maintenanceRequest.findUniqueOrThrow({ where: { id: request.id } });
    if (current.status === "TRIAGED" || current.status === "APPROVED") await setRequestStatus(tx, current, "ASSIGNED", userId, `${job.provider.displayName} accepted the job.`, { assignmentId: job.id });
    await audit(tx, job.landlordOrganisationId, userId, "workorder.provider_accepted", job.workOrderId, { assignmentId: job.id });
    await notifyTenant(tx, request.id, `${request.referenceNumber}: ${job.provider.displayName} has accepted your repair and will arrange a visit.`, `${job.id}:accepted`);
  });
  return requireJob(userId, assignmentId, ["ACCEPTED"]);
}

/** Question for the landlord; it becomes an escalation they see and can answer. */
export async function askAboutJob(userId: string, assignmentId: string, question: string, sourceMessageId: string) {
  const job = await requireJob(userId, assignmentId, ["PENDING", "ACCEPTED"]);
  const request = job.workOrder.maintenanceRequest;
  await escalate(db, { organisationId: job.landlordOrganisationId, requestId: request.id, level: "ATTENTION", reason: "PROVIDER_QUESTION", detail: `${request.referenceNumber}: ${job.provider.displayName} asks: ${question.slice(0, 500)}`, dedupeKey: `${request.id}:question:${sourceMessageId}` });
}

export async function proposeAppointment(userId: string, assignmentId: string, startsAt: Date) {
  if (!(startsAt.getTime() > Date.now())) throw new AppError("INVALID_APPOINTMENT", 422, "The appointment must be in the future.");
  const job = await requireJob(userId, assignmentId, ["ACCEPTED"]);
  const request = job.workOrder.maintenanceRequest;
  await db.$transaction(async (tx) => {
    await tx.providerAssignment.update({ where: { id: job.id }, data: { expectedStartAt: startsAt } });
    await tx.workOrder.update({ where: { id: job.workOrderId }, data: { dueAt: startsAt } });
    await tx.maintenanceHistory.create({ data: { maintenanceRequestId: request.id, actorUserId: userId, type: "NOTE", note: `${job.provider.displayName} proposed a visit on ${startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`, metadata: { assignmentId: job.id, startsAt: startsAt.toISOString() } } });
    await audit(tx, job.landlordOrganisationId, userId, "workorder.appointment_proposed", job.workOrderId, { startsAt: startsAt.toISOString() });
    await notifyTenant(tx, request.id, `${request.referenceNumber}: ${job.provider.displayName} plans to visit on ${startsAt.toISOString().slice(0, 16).replace("T", " ")} (Ghana time). Reply to this chat if that does not suit you.`, `${job.id}:appointment:${startsAt.getTime()}`);
  });
}

export async function startJob(userId: string, assignmentId: string) {
  const job = await requireJob(userId, assignmentId, ["ACCEPTED"]);
  await db.$transaction(async (tx) => {
    await tx.workOrder.update({ where: { id: job.workOrderId }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    const current = await tx.maintenanceRequest.findUniqueOrThrow({ where: { id: job.workOrder.maintenanceRequestId } });
    if (current.status === "ASSIGNED") await setRequestStatus(tx, current, "IN_PROGRESS", userId, `${job.provider.displayName} started work.`);
    await audit(tx, job.landlordOrganisationId, userId, "workorder.started", job.workOrderId, {});
  });
}

/**
 * A quote within the pre-authorised amount is accepted under the rule. Anything above it (or
 * any quote under inspection-only / quote-first rules) pauses at an approval the landlord must
 * decide; the provider is told not to start paid work until then.
 */
export async function submitQuote(userId: string, assignmentId: string, input: { amountMinor: string; note?: string }) {
  const job = await requireJob(userId, assignmentId, ["ACCEPTED"]);
  const request = job.workOrder.maintenanceRequest;
  const amount = BigInt(input.amountMinor);
  const authorised = job.workOrder.authorizationMode === "PRE_AUTHORIZED" ? job.workOrder.authorizedSpendMinor ?? BigInt(0) : BigInt(0);
  const withinLimit = amount <= authorised;
  return db.$transaction(async (tx) => {
    const quotationRequest = await tx.providerQuotationRequest.upsert({
      where: { landlordOrganisationId_providerId_maintenanceRequestId: { landlordOrganisationId: job.landlordOrganisationId, providerId: job.providerId, maintenanceRequestId: request.id } },
      update: { status: "SUBMITTED" },
      create: { landlordOrganisationId: job.landlordOrganisationId, providerId: job.providerId, maintenanceRequestId: request.id, requestedByUserId: job.assignedByUserId, status: "SUBMITTED", scope: job.workOrder.title },
    });
    await tx.providerQuotation.updateMany({ where: { requestId: quotationRequest.id, status: "SUBMITTED" }, data: { status: "WITHDRAWN" } });
    const quotation = await tx.providerQuotation.create({
      data: { landlordOrganisationId: job.landlordOrganisationId, requestId: quotationRequest.id, providerId: job.providerId, source: "PROVIDER", status: withinLimit ? "APPROVED" : "SUBMITTED", labourAmountMinor: amount.toString(), materialsAmountMinor: "0", totalAmountMinor: amount.toString(), currencyCode: job.workOrder.currencyCode, validUntil: new Date(Date.now() + 14 * 86_400_000), etaDays: 1, notes: input.note?.slice(0, 2000), submittedByUserId: userId },
    });
    await tx.maintenanceHistory.create({ data: { maintenanceRequestId: request.id, actorUserId: userId, type: "ESTIMATE", note: `Quote ${money(amount, job.workOrder.currencyCode)} from ${job.provider.displayName}${input.note ? `: ${input.note.slice(0, 300)}` : ""}.`, metadata: { quotationId: quotation.id, amountMinor: amount.toString(), withinAuthorisedLimit: withinLimit } } });
    if (withinLimit) {
      await tx.workOrder.update({ where: { id: job.workOrderId }, data: { estimateAmountMinor: amount.toString() } });
      await audit(tx, job.landlordOrganisationId, userId, "workorder.quote_within_limit", job.workOrderId, { quotationId: quotation.id, amountMinor: amount, authorisedMinor: authorised });
      return { quotationId: quotation.id, approvalRequired: false as const };
    }
    await tx.maintenanceApproval.updateMany({ where: { maintenanceRequestId: request.id, status: "PENDING" }, data: { status: "REJECTED", decidedAt: new Date(), decisionReason: "Replaced by a newer quote." } });
    const approval = await tx.maintenanceApproval.create({ data: { organisationId: job.landlordOrganisationId, maintenanceRequestId: request.id, requestedByUserId: userId, requestedAmountMinor: amount.toString(), currencyCode: job.workOrder.currencyCode, requestReason: input.note?.slice(0, 2000) ?? `Quote from ${job.provider.displayName}`, thresholdReference: `quotation:${quotation.id}; authorised ${authorised.toString()}` } });
    await tx.workOrder.update({ where: { id: job.workOrderId }, data: { estimateAmountMinor: amount.toString() } });
    await escalate(tx, { organisationId: job.landlordOrganisationId, requestId: request.id, level: "ATTENTION", reason: "QUOTE_OVER_LIMIT", detail: `${request.referenceNumber}: ${job.provider.displayName} quoted ${money(amount, job.workOrder.currencyCode)}${authorised > BigInt(0) ? `, above the ${money(authorised, job.workOrder.currencyCode)} you pre-authorised` : ""}. Reply approve ${request.referenceNumber} or reject ${request.referenceNumber}.`, dedupeKey: `${approval.id}:quote` });
    await audit(tx, job.landlordOrganisationId, userId, "workorder.quote_needs_approval", job.workOrderId, { quotationId: quotation.id, approvalId: approval.id, amountMinor: amount, authorisedMinor: authorised });
    return { quotationId: quotation.id, approvalRequired: true as const };
  });
}

/**
 * The landlord (or anyone with maintenance.approve) decides a pending quote. Approval raises the
 * work order's authorised spend to exactly the approved amount. The AI never calls this.
 */
export async function decideQuote(userId: string, organisationId: string, requestId: string, approve: boolean, reason?: string, approvalId?: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceApprove);
  return db.$transaction(async (tx) => {
    // The decision applies to the exact approval the person was shown. A newer quote sent in the
    // meantime is never approved by a confirmation given for an older one.
    const approval = await tx.maintenanceApproval.findFirst({ where: { organisationId, maintenanceRequestId: requestId, status: "PENDING", ...(approvalId ? { id: approvalId } : {}) }, orderBy: { requestedAt: "desc" } });
    if (!approval) throw new AppError("NO_PENDING_APPROVAL", 404, approvalId ? "That quote was replaced or already decided. Reply approvals to see what is waiting." : "There is no quote waiting for approval on this request.");
    const claimed = await tx.maintenanceApproval.updateMany({ where: { id: approval.id, status: "PENDING" }, data: { status: approve ? "APPROVED" : "REJECTED" } });
    if (!claimed.count) throw new AppError("NO_PENDING_APPROVAL", 409, "That quote was already decided.");
    const quotationId = approval.thresholdReference?.match(/^quotation:([0-9a-f-]{36})/)?.[1];
    await tx.maintenanceApproval.update({ where: { id: approval.id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedByUserId: userId, decidedAt: new Date(), approvedAmountMinor: approve ? approval.requestedAmountMinor : null, decisionReason: reason } });
    if (quotationId) await tx.providerQuotation.updateMany({ where: { id: quotationId, landlordOrganisationId: organisationId }, data: { status: approve ? "APPROVED" : "REJECTED" } });
    const workOrder = await tx.workOrder.findFirst({ where: { maintenanceRequestId: requestId, organisationId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } }, include: { providerAssignments: { where: { status: "ACCEPTED" }, include: { provider: { select: { displayName: true, contactPhone: true } } } }, maintenanceRequest: { select: { referenceNumber: true } } } });
    if (workOrder && approve) await tx.workOrder.update({ where: { id: workOrder.id }, data: { authorizedSpendMinor: BigInt(approval.requestedAmountMinor.toString()) } });
    await tx.maintenanceHistory.create({ data: { maintenanceRequestId: requestId, actorUserId: userId, type: "APPROVAL", note: `${approve ? "Approved" : "Rejected"} quote of ${money(approval.requestedAmountMinor, approval.currencyCode)}.`, metadata: { approvalId: approval.id, approved: approve } } });
    await tx.maintenanceEscalation.updateMany({ where: { dedupeKey: `${approval.id}:quote`, resolvedAt: null }, data: { resolvedAt: new Date() } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: approve ? "maintenance.quote_approved" : "maintenance.quote_rejected", entityType: "maintenance_request", entityId: requestId, metadata: { approvalId: approval.id, amountMinor: approval.requestedAmountMinor.toString() } } });
    const assignment = workOrder?.providerAssignments[0];
    if (assignment) await notifyProvider(tx, assignment, approve
      ? `${workOrder!.maintenanceRequest.referenceNumber}: your quote of ${money(approval.requestedAmountMinor, approval.currencyCode)} is approved. You may go ahead up to that amount.`
      : `${workOrder!.maintenanceRequest.referenceNumber}: your quote was not approved. Do not start paid work; the landlord will be in touch.`, `${approval.id}:decision`);
    return { approved: approve, amountMinor: approval.requestedAmountMinor.toString() };
  });
}

export type CompletionInput = { workPerformed: string; actualCostMinor: string; remainingIssues?: string; sourceMessageId: string };

/**
 * Completion by the assigned provider. The ticket becomes COMPLETED (awaiting verification) when
 * the rule requires verification, otherwise CLOSED. Cost above what was authorised, and any
 * remaining issue, are escalated rather than accepted silently.
 */
export async function completeJob(userId: string, assignmentId: string, input: CompletionInput) {
  const job = await requireJob(userId, assignmentId, ["ACCEPTED"]);
  const request = job.workOrder.maintenanceRequest;
  const cost = BigInt(input.actualCostMinor);
  const rule = job.workOrder.routingRuleId ? await db.maintenanceRoutingRule.findUnique({ where: { id: job.workOrder.routingRuleId }, select: { requireCompletionVerification: true } }) : null;
  const verify = rule?.requireCompletionVerification ?? true;
  const authorised = job.workOrder.authorizedSpendMinor ?? BigInt(0);
  return db.$transaction(async (tx) => {
    const done = await tx.providerAssignment.updateMany({ where: { id: job.id, status: "ACCEPTED" }, data: { status: "COMPLETED" } });
    if (!done.count) throw new AppError("JOB_CLOSED", 409, "This job is no longer open.");
    await tx.workOrder.update({ where: { id: job.workOrderId }, data: { status: "COMPLETED", completedAt: new Date(), actualCostAmountMinor: cost.toString(), startedAt: job.workOrder.startedAt ?? new Date() } });
    await tx.maintenanceHistory.create({ data: { maintenanceRequestId: request.id, actorUserId: userId, type: "ACTUAL_COST", note: `Work performed by ${job.provider.displayName}: ${input.workPerformed.slice(0, 1000)}`, metadata: { workOrderId: job.workOrderId, amountMinor: cost.toString(), remainingIssues: input.remainingIssues ?? null, sourceMessageId: input.sourceMessageId } } });
    const current = await tx.maintenanceRequest.findUniqueOrThrow({ where: { id: request.id } });
    if (current.status === "ASSIGNED") await setRequestStatus(tx, current, "IN_PROGRESS", userId, "Work recorded by the provider.");
    await setRequestStatus(tx, current, "COMPLETED", userId, `${job.provider.displayName} recorded the job as completed.`);
    if (!verify) await setRequestStatus(tx, current, "CLOSED", userId, "Closed automatically: the rule does not require verification.");
    if (cost > authorised) await escalate(tx, { organisationId: job.landlordOrganisationId, requestId: request.id, level: "ATTENTION", reason: "COST_OVER_AUTHORISED", detail: `${request.referenceNumber}: ${job.provider.displayName} recorded a cost of ${money(cost, job.workOrder.currencyCode)}, above the ${money(authorised, job.workOrder.currencyCode)} authorised.`, dedupeKey: `${job.id}:cost` });
    if (input.remainingIssues) await escalate(tx, { organisationId: job.landlordOrganisationId, requestId: request.id, level: "ATTENTION", reason: "FURTHER_WORK_REQUESTED", detail: `${request.referenceNumber}: ${job.provider.displayName} reports remaining work: ${input.remainingIssues.slice(0, 500)}`, dedupeKey: `${job.id}:further` });
    await audit(tx, job.landlordOrganisationId, userId, "workorder.completed", job.workOrderId, { costMinor: cost, verificationRequired: verify });
    await notifyTenant(tx, request.id, `${request.referenceNumber}: ${job.provider.displayName} has recorded the repair as done. Reply ok ${request.referenceNumber} if it is fixed, or problem ${request.referenceNumber} if it is not.`, `${job.id}:completed`);
    return { status: verify ? "COMPLETED" as const : "CLOSED" as const };
  });
}

/** Landlord verification of a completed job. */
export async function verifyCompletion(userId: string, organisationId: string, requestId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceManage);
  return db.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findFirst({ where: { id: requestId, organisationId } });
    if (!request) throw notFound();
    if (request.status !== "COMPLETED") throw new AppError("NOT_COMPLETED", 409, "Only a completed request can be verified.");
    await setRequestStatus(tx, request, "CLOSED", userId, "Verified and closed by the landlord.");
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "maintenance.verified", entityType: "maintenance_request", entityId: requestId } });
  });
}

/**
 * The reporting tenant confirms the repair or disputes it. A dispute reopens the request and
 * alerts the landlord; the history keeps both the completion and the dispute.
 */
export async function tenantRespondToCompletion(userId: string, organisationId: string, requestId: string, fixed: boolean, sourceMessageId: string) {
  return db.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findFirst({ where: { id: requestId, organisationId }, include: { tenantOrganisation: { select: { userId: true } } } });
    if (!request) throw notFound();
    if (request.tenantOrganisation?.userId !== userId) throw forbidden();
    if (!["COMPLETED", "CLOSED"].includes(request.status)) throw new AppError("NOT_COMPLETED", 409, "This request has not been completed yet.");
    if (fixed) {
      await tx.maintenanceHistory.create({ data: { maintenanceRequestId: request.id, actorUserId: userId, type: "NOTE", note: "Tenant confirmed the repair.", metadata: { sourceMessageId } } });
      if (request.status === "COMPLETED") await setRequestStatus(tx, request, "CLOSED", userId, "Closed after the tenant confirmed the repair.");
      return { status: "CLOSED" as const };
    }
    await setRequestStatus(tx, request, "IN_PROGRESS", userId, "Reopened: the tenant reports the problem is not fixed.");
    await escalate(tx, { organisationId, requestId: request.id, level: "ATTENTION", reason: "TENANT_DISPUTE", detail: `${request.referenceNumber}: the tenant says the repair is not fixed.`, dedupeKey: `${request.id}:dispute:${sourceMessageId}` });
    return { status: "IN_PROGRESS" as const };
  });
}

export const formatMoney = money;
