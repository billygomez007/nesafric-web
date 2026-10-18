import { Prisma, MaintenanceStatus, WorkOrderStatus } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";
import { AppError, forbidden, notFound } from "@/platform/errors";
import { upsertCalendarEvent } from "@/modules/calendar/service";
import {
  assignWorkOrderSchema,
  createMaintenanceRequestSchema,
  createWorkOrderSchema,
  decideMaintenanceApprovalSchema,
  maintenanceListQuerySchema,
  maintenanceNoteSchema,
  recordWorkOrderCostSchema,
  requestMaintenanceApprovalSchema,
  providerCancellationReasonSchema,
  transitionMaintenanceSchema,
  updateWorkOrderSchema,
} from "./schemas";
import type { z } from "zod";
import { attributionForReason } from "@/modules/providers/reputation";
import { toTenantMaintenanceView } from "./tenant-view";

type Tx = Prisma.TransactionClient;
type ProviderCancellationReason = z.infer<typeof providerCancellationReasonSchema>;
type RequestRecord = { id: string; organisationId: string; propertyId: string; unitId: string | null; status: MaintenanceStatus };

const transitions: Record<MaintenanceStatus, readonly MaintenanceStatus[]> = {
  REPORTED: ["TRIAGED", "CANCELLED"],
  TRIAGED: ["AWAITING_APPROVAL", "APPROVED", "ASSIGNED", "REJECTED", "CANCELLED"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["CLOSED"],
  CLOSED: [],
  REJECTED: [],
  CANCELLED: [],
};

const eventForStatus: Partial<Record<MaintenanceStatus, string>> = {
  TRIAGED: "maintenance.triaged",
  AWAITING_APPROVAL: "maintenance.approval_requested",
  APPROVED: "maintenance.approved",
  REJECTED: "maintenance.rejected",
  IN_PROGRESS: "maintenance.started",
  COMPLETED: "maintenance.completed",
  CLOSED: "maintenance.closed",
  CANCELLED: "maintenance.cancelled",
};

const json = (value: unknown) => value as Prisma.InputJsonValue;

async function membership(userId: string, organisationId: string) {
  return db.organisationMember.findFirst({
    where: { userId, organisationId, status: "ACTIVE", archivedAt: null },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
}

async function hasPermission(userId: string, organisationId: string, permission: string) {
  const member = await membership(userId, organisationId);
  return member ? membershipHasPermission(member.roles, permission) : false;
}

async function isTenantUser(userId: string, organisationId: string, tenantOrganisationId?: string | null) {
  return db.tenantOrganisation.findFirst({
    where: {
      organisationId,
      userId,
      archivedAt: null,
      ...(tenantOrganisationId ? { id: tenantOrganisationId } : {}),
    },
  });
}

// Returns "internal" for staff holding maintenance.read, or "tenant" for the linked tenant user,
// who only ever receives the tenant-safe view.
async function requireRequestRead(userId: string, organisationId: string, tenantOrganisationId: string | null) {
  if (await hasPermission(userId, organisationId, PERMISSIONS.maintenanceRead)) return "internal" as const;
  if (tenantOrganisationId && await isTenantUser(userId, organisationId, tenantOrganisationId)) return "tenant" as const;
  throw forbidden();
}

async function validatePropertyUnit(tx: Tx, organisationId: string, propertyId: string, unitId?: string) {
  const property = await tx.property.findFirst({
    where: { id: propertyId, organisationId, archivedAt: null },
    select: { id: true, currencyCode: true },
  });
  if (!property) throw notFound();
  if (unitId) {
    const unit = await tx.unit.findFirst({ where: { id: unitId, propertyId, archivedAt: null }, select: { id: true } });
    if (!unit) throw new AppError("INVALID_MAINTENANCE_UNIT", 422, "The selected unit does not belong to this property.");
  }
  return property;
}

async function validateTenantLease(
  tx: Tx,
  organisationId: string,
  tenantOrganisationId: string,
  propertyId: string,
  unitId?: string,
) {
  const tenant = await tx.tenantOrganisation.findFirst({
    where: { id: tenantOrganisationId, organisationId, archivedAt: null },
    select: { id: true, userId: true },
  });
  if (!tenant) throw new AppError("INVALID_MAINTENANCE_TENANT", 422, "The tenant does not belong to this organisation.");
  const lease = await tx.lease.findFirst({
    where: {
      organisationId,
      propertyId,
      archivedAt: null,
      status: { in: ["ACTIVE", "EXPIRING"] },
      ...(unitId ? { unitId } : {}),
      parties: { some: { tenantOrganisationId, role: "TENANT" } },
    },
    select: { id: true },
  });
  if (!lease) {
    throw new AppError("TENANT_LEASE_REQUIRED", 422, "The tenant must have an active lease for the selected property and unit.");
  }
  return tenant;
}

function requestInclude() {
  return {
    property: { select: { id: true, name: true, referenceNumber: true, currencyCode: true } },
    unit: { select: { id: true, name: true } },
    tenantOrganisation: { include: { tenant: true } },
    reportedBy: { select: { id: true, displayName: true } },
    attachments: { orderBy: { createdAt: "asc" as const } },
    history: { include: { actor: { select: { id: true, displayName: true } } }, orderBy: { createdAt: "asc" as const } },
    approvals: { orderBy: { requestedAt: "desc" as const } },
    workOrders: {
      include: {
        assigneeUser: { select: { id: true, displayName: true } },
        history: { orderBy: { createdAt: "asc" as const } },
      },
      orderBy: { createdAt: "asc" as const },
    },
  };
}

async function appendWorkOrderHistory(tx: Tx, workOrder: {
  id: string;
  status: WorkOrderStatus;
  estimateAmountMinor: Prisma.Decimal | null;
  actualCostAmountMinor: Prisma.Decimal | null;
  currencyCode: string;
  assigneeMemberId: string | null;
  assigneeUserId: string | null;
}, actorUserId: string, note?: string, metadata?: unknown) {
  await tx.workOrderHistory.create({
    data: {
      workOrderId: workOrder.id,
      actorUserId,
      status: workOrder.status,
      estimateAmountMinor: workOrder.estimateAmountMinor,
      actualCostAmountMinor: workOrder.actualCostAmountMinor,
      currencyCode: workOrder.currencyCode,
      assigneeMemberId: workOrder.assigneeMemberId,
      assigneeUserId: workOrder.assigneeUserId,
      note,
      ...(metadata ? { metadata: json(metadata) } : {}),
    },
  });
}

/**
 * Cancels the work order's open provider assignment(s), recording the actor (server-derived), the
 * stated reason, and the responsibility derived from it — never taken from the client. Each
 * cancellation is audited with before/after status, reason and attribution. Only provider-caused,
 * post-acceptance cancellations affect reputation (see `@/modules/providers/reputation`).
 */
async function cancelActiveProviderAssignments(
  tx: Tx,
  organisationId: string,
  workOrderId: string,
  actorUserId: string,
  cancelledAt: Date,
  reason: ProviderCancellationReason | undefined,
  note: string | undefined,
) {
  const active = await tx.providerAssignment.findMany({ where: { workOrderId, status: { in: ["PENDING", "ACCEPTED"] } } });
  const attribution = attributionForReason(reason);
  for (const assignment of active) {
    // Guarded on the status just read, so a concurrent change is never overwritten.
    const { count } = await tx.providerAssignment.updateMany({
      where: { id: assignment.id, status: assignment.status },
      data: {
        status: "CANCELLED",
        cancelledAt,
        cancelledByUserId: actorUserId,
        cancellationReason: reason ?? null,
        cancellationNote: note ?? null,
        cancellationAttribution: attribution,
      },
    });
    if (!count) continue;
    const payload = {
      assignmentId: assignment.id,
      workOrderId,
      providerId: assignment.providerId,
      actorUserId,
      fromStatus: assignment.status,
      toStatus: "CANCELLED",
      reason: reason ?? null,
      attribution,
      acceptedBeforeCancellation: assignment.acceptedAt !== null,
      cancelledAt: cancelledAt.toISOString(),
    };
    await tx.auditEvent.create({
      data: { organisationId, actorUserId, action: "provider.assignment_cancelled", entityType: "provider_assignment", entityId: assignment.id, metadata: json(payload) },
    });
    await tx.domainEvent.create({
      data: { organisationId, name: "provider.assignment_cancelled", aggregateType: "provider_assignment", aggregateId: assignment.id, payload: json(payload) },
    });
  }
}

async function transitionInTransaction(
  tx: Tx,
  request: RequestRecord,
  actorUserId: string,
  target: MaintenanceStatus,
  note?: string,
  metadata?: unknown,
  cancellation: { reason?: ProviderCancellationReason } = {},
) {
  if (!transitions[request.status].includes(target)) {
    throw new AppError("INVALID_MAINTENANCE_TRANSITION", 409, `Cannot transition maintenance from ${request.status} to ${target}.`);
  }
  const now = new Date();
  if (target === "IN_PROGRESS" || target === "COMPLETED") {
    const workOrders = await tx.workOrder.findMany({ where: { maintenanceRequestId: request.id } });
    if (!workOrders.length) throw new AppError("WORK_ORDER_REQUIRED", 409, "A work order is required for this transition.");
    if (target === "IN_PROGRESS" && !workOrders.some(({ status }) => status === "ASSIGNED")) {
      throw new AppError("ASSIGNED_WORK_ORDER_REQUIRED", 409, "An assigned work order is required to start maintenance.");
    }
    if (target === "COMPLETED" && !workOrders.some(({ status }) => status === "IN_PROGRESS")) {
      throw new AppError("IN_PROGRESS_WORK_ORDER_REQUIRED", 409, "An in-progress work order is required to complete maintenance.");
    }
    for (const current of workOrders) {
      if (target === "IN_PROGRESS" && current.status !== "ASSIGNED") continue;
      if (target === "COMPLETED" && current.status !== "IN_PROGRESS") continue;
      const providerAssignment = await tx.providerAssignment.findFirst({
        where: { workOrderId: current.id, status: { in: ["PENDING", "ACCEPTED"] } },
        orderBy: { assignedAt: "desc" },
      });
      if (target === "IN_PROGRESS" && providerAssignment?.status === "PENDING") {
        throw new AppError("PROVIDER_ACCEPTANCE_REQUIRED", 409, "The provider must accept the assignment before work starts.");
      }
      const workOrder = await tx.workOrder.update({
        where: { id: current.id },
        data: target === "IN_PROGRESS"
          ? { status: "IN_PROGRESS", startedAt: now }
          : { status: "COMPLETED", completedAt: now },
      });
      await appendWorkOrderHistory(tx, workOrder, actorUserId, note, { maintenanceStatus: target });
      if (target === "COMPLETED" && providerAssignment?.status === "ACCEPTED") {
        await tx.providerAssignment.update({
          where: { id: providerAssignment.id },
          data: { status: "COMPLETED", completedAt: now },
        });
        await tx.auditEvent.create({
          data: {
            organisationId: request.organisationId,
            actorUserId,
            action: "provider.job_completed",
            entityType: "provider_assignment",
            entityId: providerAssignment.id,
            metadata: { workOrderId: current.id, providerId: providerAssignment.providerId },
          },
        });
        await tx.domainEvent.create({
          data: {
            organisationId: request.organisationId,
            name: "provider.job_completed",
            aggregateType: "provider_assignment",
            aggregateId: providerAssignment.id,
            payload: { workOrderId: current.id, providerId: providerAssignment.providerId },
          },
        });
      }
    }
  }
  if (target === "CANCELLED") {
    const workOrders = await tx.workOrder.findMany({
      where: { maintenanceRequestId: request.id, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] } },
    });
    for (const current of workOrders) {
      const workOrder = await tx.workOrder.update({ where: { id: current.id }, data: { status: "CANCELLED" } });
      await appendWorkOrderHistory(tx, workOrder, actorUserId, note, { maintenanceStatus: target });
      await cancelActiveProviderAssignments(tx, request.organisationId, current.id, actorUserId, now, cancellation.reason, note);
    }
  }
  const updated = await tx.maintenanceRequest.update({
    where: { id: request.id },
    data: {
      status: target,
      ...(target === "COMPLETED" ? { completedAt: now } : {}),
      ...(target === "CLOSED" ? { closedAt: now } : {}),
    },
  });
  await tx.maintenanceHistory.create({
    data: {
      maintenanceRequestId: request.id,
      actorUserId,
      type: "STATUS",
      fromStatus: request.status,
      toStatus: target,
      note,
      ...(metadata ? { metadata: json(metadata) } : {}),
    },
  });
  await tx.auditEvent.create({
    data: {
      organisationId: request.organisationId,
      actorUserId,
      action: eventForStatus[target] ?? "maintenance.status_changed",
      entityType: "maintenance_request",
      entityId: request.id,
      metadata: { fromStatus: request.status, toStatus: target },
    },
  });
  const eventName = eventForStatus[target];
  if (eventName) {
    await tx.domainEvent.create({
      data: {
        organisationId: request.organisationId,
        name: eventName,
        aggregateType: "maintenance_request",
        aggregateId: request.id,
        payload: { fromStatus: request.status, toStatus: target },
      },
    });
  }
  return updated;
}

/** NM-1001, NM-1002, ... per organisation. One upsert inside the creating transaction. */
async function nextMaintenanceReference(tx: Tx, organisationId: string) {
  const [row] = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "OrganisationCounter" ("organisationId", "key", "value", "updatedAt")
    VALUES (${organisationId}::uuid, 'maintenance_request', 1001, NOW())
    ON CONFLICT ("organisationId", "key") DO UPDATE SET "value" = "OrganisationCounter"."value" + 1, "updatedAt" = NOW()
    RETURNING "value"`;
  return `NM-${row.value}`;
}

export async function createMaintenanceRequest(userId: string, organisationId: string, input: unknown) {
  const data = createMaintenanceRequestSchema.parse(input);
  const internal = await hasPermission(userId, organisationId, PERMISSIONS.maintenanceCreate);
  const tenantIdentity = data.tenantOrganisationId
    ? await isTenantUser(userId, organisationId, data.tenantOrganisationId)
    : null;
  if (!internal && !tenantIdentity) throw forbidden();

  const existingForIntake = async () => {
    if (!data.intakeReference) return null;
    const existing = await db.maintenanceRequest.findUnique({ where: { organisationId_intakeReference: { organisationId, intakeReference: data.intakeReference } }, include: requestInclude() });
    if (!existing) return null;
    // The same source can only ever be the same reporter's request.
    if (existing.reportedByUserId !== userId) throw forbidden();
    return internal ? existing : toTenantMaintenanceView(existing);
  };
  const earlier = await existingForIntake();
  if (earlier) return earlier;

  return db.$transaction(async (tx) => {
    await validatePropertyUnit(tx, organisationId, data.propertyId, data.unitId);
    let leaseId: string | undefined;
    if (data.tenantOrganisationId) {
      const tenant = await validateTenantLease(tx, organisationId, data.tenantOrganisationId, data.propertyId, data.unitId);
      if (!internal && tenant.userId !== userId) throw forbidden();
      const lease = await tx.lease.findFirstOrThrow({
        where: {
          organisationId,
          propertyId: data.propertyId,
          archivedAt: null,
          status: { in: ["ACTIVE", "EXPIRING"] },
          ...(data.unitId ? { unitId: data.unitId } : {}),
          parties: { some: { tenantOrganisationId: data.tenantOrganisationId, role: "TENANT" } },
        },
        select: { id: true },
      });
      leaseId = lease.id;
    } else if (!internal) {
      throw new AppError("TENANT_REPORTER_REQUIRED", 422, "A tenant reporter relationship is required.");
    }
    const referenceNumber = await nextMaintenanceReference(tx, organisationId);
    const request = await tx.maintenanceRequest.create({
      data: {
        organisationId,
        referenceNumber,
        intakeReference: data.intakeReference,
        intakeChannel: data.intakeChannel,
        originalReport: data.originalReport,
        classification: data.classification as Prisma.InputJsonValue | undefined,
        propertyId: data.propertyId,
        unitId: data.unitId,
        tenantOrganisationId: data.tenantOrganisationId,
        leaseId,
        reportedByUserId: userId,
        title: data.title,
        description: data.description,
        category: data.category,
        priority: data.priority,
        attachments: data.attachments.length ? { create: data.attachments } : undefined,
      },
    });
    await tx.maintenanceHistory.create({
      data: { maintenanceRequestId: request.id, actorUserId: userId, type: "STATUS", toStatus: "REPORTED", note: "Maintenance request reported." },
    });
    await tx.auditEvent.create({
      data: { organisationId, actorUserId: userId, action: "maintenance.requested", entityType: "maintenance_request", entityId: request.id },
    });
    await tx.domainEvent.create({
      data: {
        organisationId,
        name: "maintenance.requested",
        aggregateType: "maintenance_request",
        aggregateId: request.id,
        payload: { propertyId: request.propertyId, unitId: request.unitId, tenantOrganisationId: request.tenantOrganisationId, priority: request.priority, referenceNumber, intakeChannel: data.intakeChannel ?? null },
      },
    });
    // Routing rules decide what happens next, in the background. Organisations without rules only
    // get this for WhatsApp reports, so the landlord is alerted that a person must act.
    if (data.intakeChannel === "WHATSAPP" || await tx.maintenanceRoutingRule.count({ where: { organisationId, archivedAt: null } })) {
      await tx.backgroundJob.create({ data: { organisationId, type: "maintenance-route", idempotencyKey: `maintenance-route:${request.id}`, payload: { organisationId, maintenanceRequestId: request.id }, maxAttempts: 5 } });
    }
    const created = await tx.maintenanceRequest.findUniqueOrThrow({ where: { id: request.id }, include: requestInclude() });
    return internal ? created : toTenantMaintenanceView(created);
  }).catch(async (error) => {
    // Lost the race for this intake reference: the other attempt's request is the request.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && data.intakeReference) {
      const winner = await existingForIntake();
      if (winner) return winner;
    }
    throw error;
  });
}

export async function listMaintenanceRequests(userId: string, organisationId: string, query: unknown = {}) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceRead);
  const filters = maintenanceListQuerySchema.parse(query);
  return db.maintenanceRequest.findMany({
    where: { organisationId, ...filters },
    include: {
      property: { select: { id: true, name: true } },
      unit: { select: { id: true, name: true } },
      tenantOrganisation: { include: { tenant: true } },
      _count: { select: { workOrders: true, attachments: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getMaintenanceRequest(userId: string, organisationId: string, requestId: string) {
  const request = await db.maintenanceRequest.findFirst({
    where: { id: requestId, organisationId },
    include: requestInclude(),
  });
  if (!request) throw notFound();
  const access = await requireRequestRead(userId, organisationId, request.tenantOrganisationId);
  return access === "internal" ? request : toTenantMaintenanceView(request);
}

export async function addMaintenanceNote(userId: string, organisationId: string, requestId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceManage);
  const data = maintenanceNoteSchema.parse(input);
  return db.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findFirst({ where: { id: requestId, organisationId } });
    if (!request) throw notFound();
    const history = await tx.maintenanceHistory.create({
      data: { maintenanceRequestId: request.id, actorUserId: userId, type: "NOTE", note: data.note, ...(data.metadata ? { metadata: json(data.metadata) } : {}) },
    });
    await tx.auditEvent.create({
      data: { organisationId, actorUserId: userId, action: "maintenance.note_added", entityType: "maintenance_request", entityId: request.id },
    });
    return history;
  });
}

export async function transitionMaintenanceRequest(userId: string, organisationId: string, requestId: string, input: unknown) {
  const data = transitionMaintenanceSchema.parse(input);
  await requirePermission(userId, organisationId, data.status === "CANCELLED" ? PERMISSIONS.maintenanceManage : PERMISSIONS.maintenanceManage);
  return db.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findFirst({ where: { id: requestId, organisationId } });
    if (!request) throw notFound();
    return transitionInTransaction(tx, request, userId, data.status, data.note, data.metadata, { reason: data.cancellationReason });
  });
}

export async function requestMaintenanceApproval(userId: string, organisationId: string, requestId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceManage);
  const data = requestMaintenanceApprovalSchema.parse(input);
  return db.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findFirst({ where: { id: requestId, organisationId } });
    if (!request) throw notFound();
    if (request.status !== "TRIAGED") throw new AppError("INVALID_APPROVAL_REQUEST", 409, "Approval may only be requested after triage.");
    const property = await tx.property.findUniqueOrThrow({ where: { id: request.propertyId }, select: { currencyCode: true } });
    if (property.currencyCode !== data.currencyCode) throw new AppError("CURRENCY_MISMATCH", 422, "Approval currency must match the property currency.");
    const existing = await tx.maintenanceApproval.findFirst({ where: { maintenanceRequestId: request.id, status: "PENDING" } });
    if (existing) throw new AppError("APPROVAL_ALREADY_PENDING", 409, "This request already has a pending approval.");
    const approval = await tx.maintenanceApproval.create({
      data: {
        organisationId,
        maintenanceRequestId: request.id,
        requestedByUserId: userId,
        requestedAmountMinor: data.requestedAmountMinor,
        currencyCode: data.currencyCode,
        requestReason: data.reason,
        thresholdReference: data.thresholdReference,
      },
    });
    await transitionInTransaction(tx, request, userId, "AWAITING_APPROVAL", data.reason, { approvalId: approval.id, requestedAmountMinor: data.requestedAmountMinor });
    await tx.maintenanceHistory.create({
      data: { maintenanceRequestId: request.id, actorUserId: userId, type: "APPROVAL", note: data.reason, metadata: { approvalId: approval.id, action: "requested", amountMinor: data.requestedAmountMinor } },
    });
    return approval;
  });
}

async function decideApproval(userId: string, organisationId: string, requestId: string, input: unknown, approved: boolean) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceApprove);
  const data = decideMaintenanceApprovalSchema.parse(input);
  return db.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findFirst({ where: { id: requestId, organisationId } });
    if (!request) throw notFound();
    if (request.status !== "AWAITING_APPROVAL") throw new AppError("INVALID_APPROVAL_DECISION", 409, "This request is not awaiting approval.");
    const approval = await tx.maintenanceApproval.findFirst({
      where: { maintenanceRequestId: request.id, status: "PENDING" },
      orderBy: { requestedAt: "desc" },
    });
    if (!approval) throw new AppError("APPROVAL_NOT_FOUND", 409, "No pending approval exists.");
    const approvedAmount = approved ? (data.approvedAmountMinor ?? approval.requestedAmountMinor.toString()) : undefined;
    const decision = await tx.maintenanceApproval.update({
      where: { id: approval.id },
      data: {
        status: approved ? "APPROVED" : "REJECTED",
        decidedByUserId: userId,
        decidedAt: new Date(),
        decisionReason: data.reason,
        approvedAmountMinor: approvedAmount,
      },
    });
    await transitionInTransaction(tx, request, userId, approved ? "APPROVED" : "REJECTED", data.reason, {
      approvalId: approval.id,
      approvedAmountMinor: approvedAmount,
    });
    await tx.maintenanceHistory.create({
      data: {
        maintenanceRequestId: request.id,
        actorUserId: userId,
        type: "APPROVAL",
        note: data.reason,
        metadata: { approvalId: approval.id, action: approved ? "approved" : "rejected", approvedAmountMinor: approvedAmount ?? null },
      },
    });
    return decision;
  });
}

export const approveMaintenanceRequest = (userId: string, organisationId: string, requestId: string, input: unknown) =>
  decideApproval(userId, organisationId, requestId, input, true);

export const rejectMaintenanceRequest = (userId: string, organisationId: string, requestId: string, input: unknown) =>
  decideApproval(userId, organisationId, requestId, input, false);

async function activeAssignee(tx: Tx, organisationId: string, memberId: string) {
  const member = await tx.organisationMember.findFirst({
    where: { id: memberId, organisationId, status: "ACTIVE", archivedAt: null },
  });
  if (!member) throw new AppError("INVALID_WORK_ORDER_ASSIGNEE", 422, "The assignee must be an active organisation member.");
  return member;
}

export async function createWorkOrder(userId: string, organisationId: string, requestId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceAssign);
  const data = createWorkOrderSchema.parse(input);
  if (data.estimateAmountMinor !== undefined) await requirePermission(userId, organisationId, PERMISSIONS.maintenanceCost);
  return db.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findFirst({ where: { id: requestId, organisationId } });
    if (!request) throw notFound();
    if (!["TRIAGED", "APPROVED", "ASSIGNED"].includes(request.status)) {
      throw new AppError("INVALID_WORK_ORDER_STATE", 409, "A work order cannot be created in the current maintenance state.");
    }
    const property = await tx.property.findUniqueOrThrow({ where: { id: request.propertyId }, select: { currencyCode: true } });
    if (property.currencyCode !== data.currencyCode) throw new AppError("CURRENCY_MISMATCH", 422, "Work order currency must match the property currency.");
    const assignee = data.assigneeMemberId ? await activeAssignee(tx, organisationId, data.assigneeMemberId) : null;
    const workOrder = await tx.workOrder.create({
      data: {
        organisationId,
        maintenanceRequestId: request.id,
        propertyId: request.propertyId,
        unitId: request.unitId,
        createdByUserId: userId,
        assigneeMemberId: assignee?.id,
        assigneeUserId: assignee?.userId,
        title: data.title,
        description: data.description,
        dueAt: data.dueAt,
        estimateAmountMinor: data.estimateAmountMinor,
        currencyCode: data.currencyCode,
        status: assignee ? "ASSIGNED" : "OPEN",
        assignedAt: assignee ? new Date() : undefined,
        paymentReference: data.paymentReference,
        financialLedgerReference: data.financialLedgerReference,
      },
    });
    await appendWorkOrderHistory(tx, workOrder, userId, "Work order created.", { action: "created" });
    await tx.auditEvent.create({
      data: { organisationId, actorUserId: userId, action: "workorder.created", entityType: "work_order", entityId: workOrder.id, metadata: { maintenanceRequestId: request.id } },
    });
    await tx.domainEvent.create({
      data: { organisationId, name: "workorder.created", aggregateType: "work_order", aggregateId: workOrder.id, payload: { maintenanceRequestId: request.id } },
    });
    if (data.estimateAmountMinor !== undefined) {
      await tx.maintenanceHistory.create({
        data: {
          maintenanceRequestId: request.id,
          actorUserId: userId,
          type: "ESTIMATE",
          metadata: { workOrderId: workOrder.id, amountMinor: data.estimateAmountMinor, currencyCode: data.currencyCode },
        },
      });
    }
    if (assignee) {
      if (request.status !== "ASSIGNED") await transitionInTransaction(tx, request, userId, "ASSIGNED", "Work order assigned.", { workOrderId: workOrder.id });
      await tx.maintenanceHistory.create({
        data: { maintenanceRequestId: request.id, actorUserId: userId, type: "ASSIGNMENT", metadata: { workOrderId: workOrder.id, assigneeMemberId: assignee.id, assigneeUserId: assignee.userId } },
      });
      await tx.domainEvent.create({
        data: { organisationId, name: "workorder.assigned", aggregateType: "work_order", aggregateId: workOrder.id, payload: { assigneeMemberId: assignee.id, assigneeUserId: assignee.userId } },
      });
      await tx.auditEvent.create({
        data: { organisationId, actorUserId: userId, action: "workorder.assigned", entityType: "work_order", entityId: workOrder.id, metadata: { assigneeMemberId: assignee.id } },
      });
    }
    return workOrder;
  }).then(async (workOrder) => {
    if (workOrder.dueAt) {
      try {
        await upsertCalendarEvent({
          organisationId, type: "MAINTENANCE_APPOINTMENT", sourceType: "WORK_ORDER", sourceId: workOrder.id,
          title: workOrder.title, startAt: workOrder.dueAt, endAt: new Date(workOrder.dueAt.getTime() + 2 * 60 * 60 * 1000),
          timezone: "Africa/Accra", actorUserId: userId,
        });
      } catch (error) {
        console.error("Calendar sync failed for maintenance work order", error);
      }
    }
    return workOrder;
  });
}

export async function updateWorkOrder(userId: string, organisationId: string, workOrderId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceManage);
  const data = updateWorkOrderSchema.parse(input);
  return db.$transaction(async (tx) => {
    const current = await tx.workOrder.findFirst({ where: { id: workOrderId, organisationId } });
    if (!current) throw notFound();
    if (["COMPLETED", "CANCELLED"].includes(current.status)) {
      throw new AppError("IMMUTABLE_WORK_ORDER", 409, "Completed or cancelled work orders cannot be changed.");
    }
    const updated = await tx.workOrder.update({ where: { id: current.id }, data });
    await appendWorkOrderHistory(tx, updated, userId, "Work order details updated.", { changedFields: Object.keys(data) });
    await tx.auditEvent.create({
      data: { organisationId, actorUserId: userId, action: "workorder.updated", entityType: "work_order", entityId: updated.id, metadata: { changedFields: Object.keys(data) } },
    });
    return updated;
  });
}

export async function assignWorkOrder(userId: string, organisationId: string, workOrderId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceAssign);
  const data = assignWorkOrderSchema.parse(input);
  return db.$transaction(async (tx) => {
    const current = await tx.workOrder.findFirst({
      where: { id: workOrderId, organisationId },
      include: { maintenanceRequest: true },
    });
    if (!current) throw notFound();
    if (!["OPEN", "ASSIGNED"].includes(current.status)) throw new AppError("IMMUTABLE_WORK_ORDER", 409, "This work order can no longer be assigned.");
    if (await tx.providerAssignment.count({ where: { workOrderId, status: { in: ["PENDING", "ACCEPTED"] } } })) {
      throw new AppError("PROVIDER_ASSIGNMENT_EXISTS", 409, "This work order has an active provider assignment.");
    }
    const assignee = await activeAssignee(tx, organisationId, data.assigneeMemberId);
    const updated = await tx.workOrder.update({
      where: { id: current.id },
      data: { assigneeMemberId: assignee.id, assigneeUserId: assignee.userId, status: "ASSIGNED", assignedAt: new Date() },
    });
    await appendWorkOrderHistory(tx, updated, userId, data.note, { action: "assigned" });
    if (current.maintenanceRequest.status !== "ASSIGNED") {
      await transitionInTransaction(tx, current.maintenanceRequest, userId, "ASSIGNED", data.note, { workOrderId: updated.id });
    }
    await tx.maintenanceHistory.create({
      data: { maintenanceRequestId: current.maintenanceRequestId, actorUserId: userId, type: "ASSIGNMENT", note: data.note, metadata: { workOrderId: updated.id, assigneeMemberId: assignee.id, assigneeUserId: assignee.userId } },
    });
    await tx.auditEvent.create({
      data: { organisationId, actorUserId: userId, action: "workorder.assigned", entityType: "work_order", entityId: updated.id, metadata: { assigneeMemberId: assignee.id } },
    });
    await tx.domainEvent.create({
      data: { organisationId, name: "workorder.assigned", aggregateType: "work_order", aggregateId: updated.id, payload: { assigneeMemberId: assignee.id, assigneeUserId: assignee.userId } },
    });
    return updated;
  });
}

export async function recordWorkOrderCost(userId: string, organisationId: string, workOrderId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceCost);
  const data = recordWorkOrderCostSchema.parse(input);
  return db.$transaction(async (tx) => {
    const current = await tx.workOrder.findFirst({ where: { id: workOrderId, organisationId } });
    if (!current) throw notFound();
    if (current.currencyCode !== data.currencyCode) throw new AppError("CURRENCY_MISMATCH", 422, "Cost currency must match the work order currency.");
    if (data.type === "ESTIMATE" && !["OPEN", "ASSIGNED"].includes(current.status)) {
      throw new AppError("INVALID_ESTIMATE_STATE", 409, "An estimate may only be recorded before work starts.");
    }
    if (data.type === "ACTUAL" && current.status !== "IN_PROGRESS") {
      throw new AppError("INVALID_ACTUAL_COST_STATE", 409, "Actual cost may only be recorded while work is in progress.");
    }
    const updated = await tx.workOrder.update({
      where: { id: current.id },
      data: data.type === "ESTIMATE"
        ? { estimateAmountMinor: data.amountMinor, financialLedgerReference: data.financialLedgerReference }
        : { actualCostAmountMinor: data.amountMinor, financialLedgerReference: data.financialLedgerReference },
    });
    await appendWorkOrderHistory(tx, updated, userId, data.note, { action: data.type.toLowerCase(), amountMinor: data.amountMinor });
    await tx.maintenanceHistory.create({
      data: {
        maintenanceRequestId: current.maintenanceRequestId,
        actorUserId: userId,
        type: data.type === "ESTIMATE" ? "ESTIMATE" : "ACTUAL_COST",
        note: data.note,
        metadata: { workOrderId: current.id, amountMinor: data.amountMinor, currencyCode: data.currencyCode },
      },
    });
    await tx.auditEvent.create({
      data: { organisationId, actorUserId: userId, action: data.type === "ESTIMATE" ? "workorder.estimate_recorded" : "workorder.actual_cost_recorded", entityType: "work_order", entityId: current.id, metadata: { amountMinor: data.amountMinor, currencyCode: data.currencyCode } },
    });
    return updated;
  });
}

export async function getMaintenanceDashboardMetrics(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceRead);
  const [byStatus, byPriority, totalEstimate, totalActual] = await Promise.all([
    db.maintenanceRequest.groupBy({ by: ["status"], where: { organisationId }, _count: { _all: true } }),
    db.maintenanceRequest.groupBy({ by: ["priority"], where: { organisationId, status: { notIn: ["CLOSED", "REJECTED", "CANCELLED"] } }, _count: { _all: true } }),
    db.workOrder.aggregate({ where: { organisationId }, _sum: { estimateAmountMinor: true } }),
    db.workOrder.aggregate({ where: { organisationId }, _sum: { actualCostAmountMinor: true } }),
  ]);
  return {
    total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
    open: byStatus.filter(({ status }) => !["CLOSED", "REJECTED", "CANCELLED"].includes(status)).reduce((sum, row) => sum + row._count._all, 0),
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    openByPriority: Object.fromEntries(byPriority.map((row) => [row.priority, row._count._all])),
    estimateAmountMinor: totalEstimate._sum.estimateAmountMinor?.toString() ?? "0",
    actualCostAmountMinor: totalActual._sum.actualCostAmountMinor?.toString() ?? "0",
  };
}

export async function listMaintenanceAssignees(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceAssign);
  return db.organisationMember.findMany({
    where: { organisationId, status: "ACTIVE", archivedAt: null },
    select: { id: true, user: { select: { id: true, displayName: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * The reporting tenant adds details to their own open request (for example the same problem
 * reported again on WhatsApp). Idempotent per source message.
 */
export async function addTenantMaintenanceDetails(userId: string, organisationId: string, requestId: string, input: { note: string; sourceMessageId: string }) {
  const note = maintenanceNoteSchema.shape.note.parse(input.note);
  return db.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findFirst({ where: { id: requestId, organisationId } });
    if (!request?.tenantOrganisationId || !await isTenantUser(userId, organisationId, request.tenantOrganisationId)) throw notFound();
    // Serialise passes for the same source message so the check and the insert are atomic.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`maintenance-details:${request.id}:${input.sourceMessageId}`}, 0))`;
    const existing = await tx.maintenanceHistory.findFirst({ where: { maintenanceRequestId: request.id, type: "NOTE", metadata: { path: ["sourceMessageId"], equals: input.sourceMessageId } } });
    if (existing) return existing;
    const history = await tx.maintenanceHistory.create({ data: { maintenanceRequestId: request.id, actorUserId: userId, type: "NOTE", note, metadata: { sourceMessageId: input.sourceMessageId, by: "tenant" } } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "maintenance.tenant_details_added", entityType: "maintenance_request", entityId: request.id } });
    return history;
  });
}

export async function getTenantMaintenanceHistory(userId: string, organisationId: string, tenantOrganisationId: string) {
  const internal = await hasPermission(userId, organisationId, PERMISSIONS.maintenanceRead);
  if (!internal && !await isTenantUser(userId, organisationId, tenantOrganisationId)) throw forbidden();
  const tenant = await db.tenantOrganisation.findFirst({ where: { id: tenantOrganisationId, organisationId, archivedAt: null } });
  if (!tenant) throw notFound();
  const requests = await db.maintenanceRequest.findMany({
    where: { organisationId, tenantOrganisationId },
    include: requestInclude(),
    orderBy: { createdAt: "desc" },
  });
  return internal ? requests : requests.map(toTenantMaintenanceView);
}

export async function getPropertyMaintenanceHistory(userId: string, organisationId: string, propertyId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.maintenanceRead);
  const property = await db.property.findFirst({ where: { id: propertyId, organisationId, archivedAt: null } });
  if (!property) throw notFound();
  return db.maintenanceRequest.findMany({
    where: { organisationId, propertyId },
    include: requestInclude(),
    orderBy: { createdAt: "desc" },
  });
}
