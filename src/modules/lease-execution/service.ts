import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";
import { AppError, forbidden, notFound } from "@/platform/errors";
import { esignatureProviders } from "@/modules/esignature/provider";
import { dispatchSignatureEnvelope } from "@/modules/esignature/service";
import { upsertCalendarEvent } from "@/modules/calendar/service";
import {
  checklistUpdateSchema,
  completeMoveInSchema,
  createExecutionDocumentSchema,
  inspectionSchema,
  keyHandoverSchema,
  leaseExecutionIdSchema,
  scheduleMoveInSchema,
  signatureActionSchema,
  signatureRequestSchema,
} from "./schemas";

type Tx = Prisma.TransactionClient;
type DbClient = Tx | typeof db;
const json = (value: unknown) => value as Prisma.InputJsonValue;

const executionInclude = {
  property: { select: { id: true, name: true, referenceNumber: true } },
  unit: { select: { id: true, name: true } },
  parties: { include: { tenantOrganisation: { include: { tenant: true } } } },
  executionDocuments: {
    include: { signatureRequests: { orderBy: { createdAt: "asc" as const } } },
    orderBy: { version: "desc" as const },
  },
  signatureRequests: { orderBy: { createdAt: "asc" as const } },
  moveIn: {
    include: {
      checklist: { orderBy: { key: "asc" as const } },
      inspections: {
        include: { areas: true, meterReadings: true, inventory: true },
        orderBy: { inspectedAt: "desc" as const },
      },
      keyHandovers: { orderBy: { issuedAt: "asc" as const } },
      history: { orderBy: { createdAt: "asc" as const } },
    },
  },
} satisfies Prisma.LeaseInclude;

async function record(tx: Tx, organisationId: string, actorUserId: string, name: string, aggregateType: string, aggregateId: string, payload: Record<string, unknown> = {}) {
  await tx.auditEvent.create({ data: { organisationId, actorUserId, action: name, entityType: aggregateType, entityId: aggregateId, metadata: json(payload) } });
  await tx.domainEvent.create({ data: { organisationId, name, aggregateType, aggregateId, payload: json(payload) } });
}

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

async function isLeaseTenant(userId: string, organisationId: string, leaseId: string) {
  return db.leaseParty.findFirst({
    where: { leaseId, lease: { organisationId }, tenantOrganisation: { userId, archivedAt: null } },
    select: { id: true, tenantOrganisationId: true },
  });
}

async function requireExecutionRead(userId: string, organisationId: string, leaseId: string) {
  const member = await membership(userId, organisationId);
  if (member && membershipHasPermission(member.roles, PERMISSIONS.leaseExecutionRead)) return { internal: true as const, memberId: member.id };
  const party = await isLeaseTenant(userId, organisationId, leaseId);
  if (party) return { internal: false as const, party };
  throw forbidden();
}

function defaultRequirements(lease: { depositAmountMinor: Prisma.Decimal | null }) {
  return {
    signaturesRequired: true,
    depositRequired: Boolean(lease.depositAmountMinor?.greaterThan(0)),
    initialRentRequired: false,
    moveInRequired: false,
    documentRequired: true,
  };
}

export async function getLeaseExecution(userId: string, organisationId: string, leaseId: string) {
  leaseId = leaseExecutionIdSchema.parse(leaseId);
  const access = await requireExecutionRead(userId, organisationId, leaseId);
  const lease = await db.lease.findFirst({ where: { id: leaseId, organisationId, archivedAt: null }, include: executionInclude });
  if (!lease) throw notFound();
  const readiness = await activationReadiness(db, lease);
  if (!access.internal) {
    const signatures = lease.signatureRequests
      .filter(({ tenantOrganisationId, role }) => tenantOrganisationId === access.party.tenantOrganisationId || role === "ORG_REPRESENTATIVE")
      .map(({ id, documentId, signerName, role, status, required, createdAt, requestedAt, viewedAt, signedAt, declinedAt }) => ({
        id, documentId, signerName, role, status, required, createdAt, requestedAt, viewedAt, signedAt, declinedAt,
      }));
    const signatureIds = new Set(signatures.map(({ id }) => id));
    return {
      lease: {
        id: lease.id,
        referenceNumber: lease.referenceNumber,
        status: lease.status,
        executionStatus: lease.executionStatus,
        startDate: lease.startDate,
        depositAmountMinor: lease.depositAmountMinor,
        currencyCode: lease.currencyCode,
        property: lease.property,
        unit: lease.unit,
        parties: [],
        executionDocuments: lease.executionDocuments.map(({ id, version, status, fileName, source, createdAt, signatureRequests }) => ({
          id, version, status, fileName, source, createdAt,
          signatureRequests: signatureRequests
            .filter(({ id: signatureId }) => signatureIds.has(signatureId))
            .map(({ id: signatureId, documentId, signerName, role, status: signatureStatus, required, createdAt: signatureCreatedAt }) => ({
              id: signatureId, documentId, signerName, role, status: signatureStatus, required, createdAt: signatureCreatedAt,
            })),
        })),
        signatureRequests: signatures,
        moveIn: lease.moveIn ? {
          id: lease.moveIn.id,
          status: lease.moveIn.status,
          scheduledDate: lease.moveIn.scheduledDate,
          actualDate: lease.moveIn.actualDate,
          checklist: lease.moveIn.checklist.map(({ id, key, label, required, completed }) => ({ id, key, label, required, completed, notes: null })),
          inspections: lease.moveIn.inspections.map(({ id, inspectedAt, overallCondition, tenantAcknowledged, areas, meterReadings, inventory }) => ({
            id, inspectedAt, overallCondition, tenantAcknowledged,
            areas: areas.map(({ id: areaId, name, condition }) => ({ id: areaId, name, condition })),
            meterReadings: meterReadings.map(({ id: meterId, type, value, unit }) => ({ id: meterId, type, value, unit })),
            inventory: inventory.map(({ id: itemId, category, item, quantity, condition }) => ({ id: itemId, category, item, quantity, condition })),
          })),
          keyHandovers: lease.moveIn.keyHandovers
            .filter(({ tenantOrganisationId }) => tenantOrganisationId === access.party.tenantOrganisationId)
            .map(({ id, type, quantity, issuedAt }) => ({ id, type, quantity, identifier: null, issuedAt })),
        } : null,
      },
      readiness,
      actionableSignatureIds: signatures
        .filter(({ id, role }) => role !== "ORG_REPRESENTATIVE" && lease.signatureRequests.some((request) => request.id === id && request.tenantOrganisationId === access.party.tenantOrganisationId))
        .map(({ id }) => id),
      capabilities: { manage: false, sign: true, moveInManage: false },
    };
  }
  const actionableSignatureIds = lease.signatureRequests
    .filter(({ role, organisationMemberId }) => role === "OTHER" || (role === "ORG_REPRESENTATIVE" && organisationMemberId === access.memberId))
    .map(({ id }) => id);
  return {
    lease,
    readiness,
    actionableSignatureIds,
    capabilities: {
      manage: await hasPermission(userId, organisationId, PERMISSIONS.leaseExecutionManage),
      sign: actionableSignatureIds.length > 0 && await hasPermission(userId, organisationId, PERMISSIONS.leaseExecutionSign),
      moveInManage: await hasPermission(userId, organisationId, PERMISSIONS.moveInManage),
    },
  };
}

export async function createLeaseDocumentVersion(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.leaseExecutionManage);
  leaseId = leaseExecutionIdSchema.parse(leaseId);
  const data = createExecutionDocumentSchema.parse(input);
  return db.$transaction(async (tx) => {
    const lease = await tx.lease.findFirst({
      where: { id: leaseId, organisationId, archivedAt: null, status: "DRAFT" },
      include: { executionDocuments: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!lease) throw notFound();
    if (lease.executionStatus !== "DRAFT") {
      throw new AppError("LEASE_DOCUMENT_LOCKED", 409, "A new document version cannot be created after signing has started.");
    }
    const previous = lease.executionDocuments[0];
    if (previous?.status === "EXECUTED") throw new AppError("EXECUTED_DOCUMENT_IMMUTABLE", 409, "Executed lease documents cannot be superseded.");
    if (previous) await tx.leaseExecutionDocument.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
    const document = await tx.leaseExecutionDocument.create({
      data: {
        ...data,
        leaseId,
        version: (previous?.version ?? 0) + 1,
        status: "READY",
        readyAt: new Date(),
        supersedesId: previous?.id,
        createdByUserId: userId,
      },
    });
    await record(tx, organisationId, userId, "lease.document_version_created", "lease_document", document.id, { leaseId, version: document.version });
    return document;
  });
}

export async function requestLeaseSignatures(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.leaseExecutionManage);
  leaseId = leaseExecutionIdSchema.parse(leaseId);
  const data = signatureRequestSchema.parse(input);
  const provider = esignatureProviders.get(data.providerKey);
  if (!provider.isConfigured()) throw new AppError("ESIGNATURE_PROVIDER_UNAVAILABLE", 503, `${provider.displayName} is not configured.`);
  const { created, dispatchDocument } = await db.$transaction(async (tx) => {
    const lease = await tx.lease.findFirst({
      where: { id: leaseId, organisationId, archivedAt: null, status: "DRAFT" },
      include: { parties: { include: { tenantOrganisation: { include: { tenant: true } } } } },
    });
    if (!lease) throw notFound();
    if (!["DRAFT", "READY_FOR_SIGNATURE"].includes(lease.executionStatus)) {
      throw new AppError("SIGNING_ALREADY_STARTED", 409, "Signature requests cannot be replaced after signing has started.");
    }
    const document = await tx.leaseExecutionDocument.findFirst({ where: { id: data.documentId, leaseId, status: "READY" } });
    if (!document) throw new AppError("INVALID_SIGNING_DOCUMENT", 422, "Select the current ready lease document.");
    const requests: Prisma.LeaseSignatureRequestCreateManyInput[] = [];
    for (const signer of data.signers) {
      if (signer.role === "ORG_REPRESENTATIVE") {
        if (!signer.organisationMemberId) throw new AppError("SIGNER_MEMBER_REQUIRED", 422, "An organisation representative must reference an active member.");
        const member = await tx.organisationMember.findFirst({ where: { id: signer.organisationMemberId, organisationId, status: "ACTIVE", archivedAt: null }, include: { user: true } });
        if (!member) throw new AppError("INVALID_SIGNER", 422, "The organisation signer is invalid.");
        requests.push({ leaseId, documentId: document.id, organisationMemberId: member.id, signerName: signer.signerName ?? member.user.displayName, signerEmail: signer.signerEmail ?? member.user.email, role: signer.role, required: signer.required, status: "SENT", providerKey: data.providerKey, requestedAt: new Date(), sentAt: new Date() });
      } else if (["TENANT", "CO_TENANT"].includes(signer.role)) {
        if (!signer.leasePartyId) throw new AppError("SIGNER_PARTY_REQUIRED", 422, "A tenant signer must reference a lease party.");
        const party = lease.parties.find(({ id }) => id === signer.leasePartyId);
        if (!party) throw new AppError("INVALID_SIGNER", 422, "The tenant signer is not a party to this lease.");
        requests.push({ leaseId, documentId: document.id, leasePartyId: party.id, tenantOrganisationId: party.tenantOrganisationId, signerName: signer.signerName ?? party.tenantOrganisation.tenant.legalName, signerEmail: signer.signerEmail ?? party.tenantOrganisation.email, role: signer.role, required: signer.required, status: "SENT", providerKey: data.providerKey, requestedAt: new Date(), sentAt: new Date() });
      } else {
        if (!signer.signerName) throw new AppError("SIGNER_NAME_REQUIRED", 422, "Other signers require a name.");
        requests.push({ leaseId, documentId: document.id, signerName: signer.signerName, signerEmail: signer.signerEmail, role: signer.role, required: signer.required, status: "SENT", providerKey: data.providerKey, requestedAt: new Date(), sentAt: new Date() });
      }
    }
    await tx.leaseSignatureRequest.createMany({ data: requests });
    const requirements = { ...defaultRequirements(lease), ...data.activationRequirements };
    await tx.lease.update({ where: { id: leaseId }, data: { executionStatus: "READY_FOR_SIGNATURE", activationRequirements: json(requirements) } });
    await tx.leaseExecutionDocument.update({ where: { id: document.id }, data: { status: "SIGNING" } });
    await record(tx, organisationId, userId, "lease.ready_for_signature", "lease", leaseId, { documentId: document.id });
    await record(tx, organisationId, userId, "lease.signature_requested", "lease", leaseId, { documentId: document.id, signerCount: requests.length });
    const created = await tx.leaseSignatureRequest.findMany({ where: { leaseId, documentId: document.id }, orderBy: { createdAt: "asc" } });
    return { created, dispatchDocument: { id: document.id, fileKey: document.fileKey, fileName: document.fileName } };
  });
  // Routes every signer through the selected e-signature adapter (item 4). The deterministic
  // internal adapter does this instantly with no network call; a real provider creates the
  // external envelope and persists signing URLs. Always emits `signature.request_created`.
  await dispatchSignatureEnvelope({
    organisationId,
    leaseId,
    documentId: dispatchDocument.id,
    documentFileKey: dispatchDocument.fileKey,
    documentFileName: dispatchDocument.fileName,
    providerKey: data.providerKey,
    actorUserId: userId,
    signers: created.map((request) => ({ id: request.id, signerName: request.signerName, signerEmail: request.signerEmail, role: request.role })),
  });
  return db.leaseSignatureRequest.findMany({ where: { leaseId, documentId: dispatchDocument.id }, orderBy: { createdAt: "asc" } });
}

export async function actOnLeaseSignature(userId: string, organisationId: string, leaseId: string, requestId: string, input: unknown) {
  leaseId = leaseExecutionIdSchema.parse(leaseId);
  requestId = leaseExecutionIdSchema.parse(requestId);
  const data = signatureActionSchema.parse(input);
  const internal = await hasPermission(userId, organisationId, PERMISSIONS.leaseExecutionSign);
  const canManage = await hasPermission(userId, organisationId, PERMISSIONS.leaseExecutionManage);
  const tenant = await isLeaseTenant(userId, organisationId, leaseId);
  if (!internal && !tenant && !canManage) throw forbidden();
  return db.$transaction(async (tx) => {
    const request = await tx.leaseSignatureRequest.findFirst({
      where: { id: requestId, leaseId, lease: { organisationId } },
      include: {
        organisationMember: { select: { userId: true } },
        tenantOrganisation: { select: { userId: true } },
        document: { select: { status: true } },
      },
    });
    if (!request) throw notFound();
    if (data.status === "CANCELLED") {
      if (!canManage) throw forbidden();
    } else if (request.role === "ORG_REPRESENTATIVE") {
      if (!internal || request.organisationMember?.userId !== userId) throw forbidden();
    } else if (request.role === "TENANT" || request.role === "CO_TENANT") {
      if (request.tenantOrganisation?.userId !== userId || request.tenantOrganisationId !== tenant?.tenantOrganisationId) throw forbidden();
    } else if (!internal) {
      throw forbidden();
    }
    if (request.document.status !== "SIGNING") throw new AppError("SIGNING_DOCUMENT_INACTIVE", 409, "This document is no longer open for signing.");
    const allowed: Record<string, string[]> = { SENT: ["VIEWED", "SIGNED", "DECLINED", "CANCELLED"], VIEWED: ["SIGNED", "DECLINED", "CANCELLED"], PENDING: ["SENT", "CANCELLED"] };
    if (!allowed[request.status]?.includes(data.status)) throw new AppError("INVALID_SIGNATURE_TRANSITION", 409, `Cannot move a ${request.status} signature to ${data.status}.`);
    const now = new Date();
    const updated = await tx.leaseSignatureRequest.update({
      where: { id: request.id },
      data: {
        status: data.status,
        providerReference: data.providerReference,
        actedByUserId: userId,
        viewedAt: data.status === "VIEWED" ? now : request.viewedAt,
        signedAt: data.status === "SIGNED" ? now : request.signedAt,
        declinedAt: data.status === "DECLINED" ? now : request.declinedAt,
        cancelledAt: data.status === "CANCELLED" ? now : request.cancelledAt,
      },
    });
    if (data.status === "SIGNED") {
      await record(tx, organisationId, userId, "lease.signed", "lease_signature", request.id, { leaseId, role: request.role });
      await record(tx, organisationId, userId, "signature.completed", "lease_signature", request.id, { leaseId, role: request.role, providerKey: request.providerKey });
    }
    const required = await tx.leaseSignatureRequest.findMany({ where: { leaseId, documentId: request.documentId, required: true } });
    const signed = required.filter(({ status }) => status === "SIGNED").length;
    if (signed > 0) await tx.lease.update({ where: { id: leaseId }, data: { executionStatus: signed === required.length ? "FULLY_SIGNED" : "PARTIALLY_SIGNED" } });
    if (required.length > 0 && signed === required.length) {
      await tx.leaseExecutionDocument.update({ where: { id: request.documentId }, data: { status: "EXECUTED", executedAt: now } });
      await record(tx, organisationId, userId, "lease.fully_signed", "lease", leaseId, { documentId: request.documentId });
    }
    return updated;
  });
}

async function activationReadiness(client: DbClient, lease: Prisma.LeaseGetPayload<{ include: typeof executionInclude }>) {
  const requirements = { ...defaultRequirements(lease), ...((lease.activationRequirements as Record<string, boolean> | null) ?? {}) };
  const requiredSignatures = lease.signatureRequests.filter(({ required }) => required);
  const signaturesSatisfied = !requirements.signaturesRequired || (requiredSignatures.length > 0 && requiredSignatures.every(({ status }) => status === "SIGNED"));
  const executedDocument = lease.executionDocuments.some(({ status }) => status === "EXECUTED");
  const deposits = await client.securityDeposit.findMany({
    where: { leaseId: lease.id, organisationId: lease.organisationId, status: { in: ["HELD", "PARTIALLY_DEDUCTED", "PARTIALLY_REFUNDED"] } },
    select: { amountMinor: true, refundedAmountMinor: true, deductedAmountMinor: true },
  });
  const recordedDeposit = deposits.reduce(
    (total, deposit) => total.plus(deposit.amountMinor).minus(deposit.refundedAmountMinor).minus(deposit.deductedAmountMinor),
    new Prisma.Decimal(0),
  );
  const requiredDeposit = lease.depositAmountMinor ?? new Prisma.Decimal(0);
  const depositSatisfied = !requirements.depositRequired || recordedDeposit.greaterThanOrEqualTo(requiredDeposit);
  const firstObligation = await client.rentObligation.findFirst({ where: { leaseId: lease.id }, orderBy: { dueDate: "asc" } });
  const initialRentSatisfied = !requirements.initialRentRequired || Boolean(firstObligation && (firstObligation.status === "SATISFIED" || firstObligation.collectionState === "FULLY_PAID"));
  const moveInSatisfied = !requirements.moveInRequired || Boolean(lease.moveIn && ["READY", "COMPLETED"].includes(lease.moveIn.status) && lease.moveIn.scheduledDate && lease.moveIn.scheduledDate <= new Date());
  const documentSatisfied = !requirements.documentRequired || executedDocument;
  const items = { signaturesSatisfied, depositSatisfied, initialRentSatisfied, moveInSatisfied, documentSatisfied };
  return { requirements, ...items, ready: Object.values(items).every(Boolean), deposit: { requiredMinor: requiredDeposit.toString(), recordedMinor: recordedDeposit.toString() } };
}

export async function getActivationReadiness(userId: string, organisationId: string, leaseId: string) {
  await requireExecutionRead(userId, organisationId, leaseId);
  const lease = await db.lease.findFirst({ where: { id: leaseId, organisationId, archivedAt: null }, include: executionInclude });
  if (!lease) throw notFound();
  return activationReadiness(db, lease);
}

export async function activateExecutedLease(userId: string, organisationId: string, leaseId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.leaseExecutionManage);
  await requirePermission(userId, organisationId, PERMISSIONS.leaseUpdate);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${leaseId}))::text AS locked`;
    const lease = await tx.lease.findFirst({ where: { id: leaseId, organisationId, archivedAt: null }, include: executionInclude });
    if (!lease) throw notFound();
    if (lease.status !== "DRAFT") throw new AppError("LEASE_NOT_DRAFT", 409, "Only a draft lease can be activated.");
    const readiness = await activationReadiness(tx, lease);
    if (!readiness.ready) throw new AppError("LEASE_NOT_ACTIVATION_READY", 409, "The lease activation requirements are not complete.");
    const version = await tx.leaseHistory.aggregate({ where: { leaseId }, _max: { version: true } });
    const updated = await tx.lease.update({ where: { id: leaseId }, data: { status: "ACTIVE", executionStatus: "ACTIVE", moveStatus: lease.moveIn?.status === "COMPLETED" ? "MOVED_IN" : lease.moveStatus } });
    await tx.leaseHistory.create({ data: { leaseId, version: (version._max.version ?? 0) + 1, status: "ACTIVE", startDate: updated.startDate, endDate: updated.endDate, rentAmountMinor: updated.rentAmountMinor, currencyCode: updated.currencyCode, rentFrequency: updated.rentFrequency, depositAmountMinor: updated.depositAmountMinor, notes: updated.notes, changedByUserId: userId } });
    await record(tx, organisationId, userId, "lease.activation_ready", "lease", leaseId, readiness);
    await record(tx, organisationId, userId, "lease.activated", "lease", leaseId, { previousStatus: lease.status });
    return updated;
  });
}

export async function scheduleMoveIn(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.moveInManage);
  const data = scheduleMoveInSchema.parse(input);
  return db.$transaction(async (tx) => {
    const lease = await tx.lease.findFirst({ where: { id: leaseId, organisationId, archivedAt: null }, include: { moveIn: true } });
    if (!lease) throw notFound();
    if (lease.moveIn?.status === "COMPLETED") throw new AppError("MOVE_IN_COMPLETED", 409, "A completed move-in cannot be rescheduled.");
    if (["TERMINATED", "CANCELLED", "EXPIRED"].includes(lease.status)) throw new AppError("LEASE_MOVE_IN_UNAVAILABLE", 409, "Move-in cannot be scheduled for this lease.");
    if (data.responsibleMemberId) {
      const member = await tx.organisationMember.findFirst({ where: { id: data.responsibleMemberId, organisationId, status: "ACTIVE", archivedAt: null } });
      if (!member) throw new AppError("INVALID_MOVE_IN_ASSIGNEE", 422, "The responsible staff member is invalid.");
    }
    const checklist = data.checklist.length ? data.checklist : [
      { key: "inspection", label: "Move-in inspection completed", required: true },
      { key: "keys", label: "Keys or access devices issued", required: true },
      { key: "deposit", label: "Required deposit confirmed", required: Boolean(lease.depositAmountMinor?.greaterThan(0)) },
    ];
    const moveIn = lease.moveIn
      ? await tx.moveIn.update({ where: { id: lease.moveIn.id }, data: { scheduledDate: data.scheduledDate, responsibleMemberId: data.responsibleMemberId, notes: data.notes, status: "SCHEDULED", history: { create: { actorUserId: userId, fromStatus: lease.moveIn.status, toStatus: "SCHEDULED" } } } })
      : await tx.moveIn.create({ data: { organisationId, leaseId, scheduledDate: data.scheduledDate, responsibleMemberId: data.responsibleMemberId, notes: data.notes, status: "SCHEDULED", checklist: { create: checklist }, history: { create: { actorUserId: userId, toStatus: "SCHEDULED" } } } });
    await record(tx, organisationId, userId, "move_in.scheduled", "move_in", moveIn.id, { leaseId, scheduledDate: data.scheduledDate });
    return moveIn;
  }).then(async (moveIn) => {
    try {
      const dayStart = new Date(moveIn.scheduledDate!);
      await upsertCalendarEvent({
        organisationId, type: "MOVE_IN", sourceType: "MOVE_IN", sourceId: moveIn.id,
        title: "Tenant move-in", startAt: dayStart, endAt: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000),
        timezone: "Africa/Accra", actorUserId: userId,
      });
    } catch (error) {
      console.error("Calendar sync failed for move-in scheduling", error);
    }
    return moveIn;
  });
}

export async function updateMoveInChecklist(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.moveInManage);
  const data = checklistUpdateSchema.parse(input);
  const moveIn = await db.moveIn.findFirst({ where: { leaseId, organisationId } });
  if (!moveIn) throw notFound();
  if (moveIn.status === "COMPLETED") throw new AppError("MOVE_IN_COMPLETED", 409, "A completed move-in cannot be changed.");
  const item = await db.moveInChecklistItem.findFirst({ where: { id: data.itemId, moveInId: moveIn.id } });
  if (!item) throw notFound();
  return db.moveInChecklistItem.update({ where: { id: item.id }, data: { completed: data.completed, completedAt: data.completed ? new Date() : null, notes: data.notes } });
}

export async function createMoveInInspection(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.moveInManage);
  const data = inspectionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const moveIn = await tx.moveIn.findFirst({ where: { leaseId, organisationId }, include: { lease: true } });
    if (!moveIn) throw notFound();
    if (moveIn.status === "COMPLETED") throw new AppError("MOVE_IN_COMPLETED", 409, "A completed move-in cannot be changed.");
    const inspector = await tx.organisationMember.findFirst({ where: { id: data.inspectorMemberId, organisationId, status: "ACTIVE", archivedAt: null } });
    if (!inspector) throw new AppError("INVALID_INSPECTOR", 422, "The inspector must be an active organisation member.");
    const inspection = await tx.moveInInspection.create({
      data: {
        moveInId: moveIn.id,
        inspectorMemberId: inspector.id,
        inspectedAt: data.inspectedAt,
        overallCondition: data.overallCondition,
        notes: data.notes,
        tenantAcknowledged: data.tenantAcknowledged,
        tenantAcknowledgedAt: data.tenantAcknowledged ? new Date() : null,
        completedAt: data.completed ? new Date() : null,
        areas: { create: data.areas.map((area) => ({ ...area, defects: area.defects ? json(area.defects) : undefined, media: area.media ? json(area.media) : undefined })) },
        meterReadings: { create: data.meterReadings.map((reading) => ({ ...reading, value: new Prisma.Decimal(reading.value) })) },
        inventory: { create: data.inventory.map((item) => ({ ...item, metadata: item.metadata ? json(item.metadata) : undefined })) },
      },
      include: { areas: true, meterReadings: true, inventory: true },
    });
    if (data.completed) {
      await tx.moveInChecklistItem.updateMany({ where: { moveInId: moveIn.id, key: "inspection" }, data: { completed: true, completedAt: new Date() } });
      await tx.moveIn.update({ where: { id: moveIn.id }, data: { status: "INSPECTION_PENDING", history: { create: { actorUserId: userId, fromStatus: moveIn.status, toStatus: "INSPECTION_PENDING" } } } });
      await record(tx, organisationId, userId, "move_in.inspection_completed", "move_in_inspection", inspection.id, { leaseId, moveInId: moveIn.id });
    }
    return inspection;
  }).then(async (inspection) => {
    try {
      await upsertCalendarEvent({
        organisationId, type: "INSPECTION", sourceType: "MOVE_IN_INSPECTION", sourceId: inspection.id,
        title: "Move-in inspection", startAt: inspection.inspectedAt, endAt: new Date(inspection.inspectedAt.getTime() + 60 * 60 * 1000),
        timezone: "Africa/Accra", actorUserId: userId,
      });
    } catch (error) {
      console.error("Calendar sync failed for move-in inspection", error);
    }
    return inspection;
  });
}

export async function issueMoveInKeys(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.moveInManage);
  const data = keyHandoverSchema.parse(input);
  return db.$transaction(async (tx) => {
    const moveIn = await tx.moveIn.findFirst({ where: { leaseId, organisationId } });
    if (!moveIn) throw notFound();
    if (moveIn.status === "COMPLETED") throw new AppError("MOVE_IN_COMPLETED", 409, "A completed move-in cannot be changed.");
    const party = await tx.leaseParty.findFirst({ where: { leaseId, tenantOrganisationId: data.tenantOrganisationId } });
    if (!party) throw new AppError("INVALID_KEY_RECIPIENT", 422, "Keys can only be issued to a tenant on this lease.");
    const handover = await tx.moveInKeyHandover.create({ data: { ...data, moveInId: moveIn.id } });
    await tx.moveInChecklistItem.updateMany({ where: { moveInId: moveIn.id, key: "keys" }, data: { completed: true, completedAt: new Date() } });
    await record(tx, organisationId, userId, "move_in.keys_issued", "move_in_key_handover", handover.id, { leaseId, moveInId: moveIn.id, quantity: handover.quantity });
    return handover;
  });
}

export async function completeMoveIn(userId: string, organisationId: string, leaseId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.moveInManage);
  const data = completeMoveInSchema.parse(input);
  return db.$transaction(async (tx) => {
    const moveIn = await tx.moveIn.findFirst({ where: { leaseId, organisationId }, include: { checklist: true, inspections: true, keyHandovers: true } });
    if (!moveIn) throw notFound();
    if (moveIn.status === "COMPLETED") throw new AppError("MOVE_IN_COMPLETED", 409, "Move-in is already completed.");
    const lease = await tx.lease.findUniqueOrThrow({ where: { id: leaseId } });
    const requiredDeposit = lease.depositAmountMinor ?? new Prisma.Decimal(0);
    if (requiredDeposit.greaterThan(0)) {
      const deposits = await tx.securityDeposit.findMany({
        where: { leaseId, organisationId, status: { in: ["HELD", "PARTIALLY_DEDUCTED", "PARTIALLY_REFUNDED"] } },
        select: { amountMinor: true, refundedAmountMinor: true, deductedAmountMinor: true },
      });
      const held = deposits.reduce(
        (total, deposit) => total.plus(deposit.amountMinor).minus(deposit.refundedAmountMinor).minus(deposit.deductedAmountMinor),
        new Prisma.Decimal(0),
      );
      if (held.lessThan(requiredDeposit)) throw new AppError("MOVE_IN_DEPOSIT_REQUIRED", 409, "The required deposit has not been recorded.");
      await tx.moveInChecklistItem.updateMany({ where: { moveInId: moveIn.id, key: "deposit" }, data: { completed: true, completedAt: new Date() } });
      for (const item of moveIn.checklist) if (item.key === "deposit") item.completed = true;
    }
    const incomplete = moveIn.checklist.filter(({ required, completed }) => required && !completed);
    if (incomplete.length) throw new AppError("MOVE_IN_CHECKLIST_INCOMPLETE", 409, `Complete required move-in checklist items: ${incomplete.map(({ key }) => key).join(", ")}.`);
    if (!moveIn.inspections.some(({ completedAt }) => completedAt)) throw new AppError("MOVE_IN_INSPECTION_REQUIRED", 409, "A completed inspection is required.");
    if (!moveIn.keyHandovers.length) throw new AppError("MOVE_IN_KEYS_REQUIRED", 409, "At least one key or access device handover is required.");
    const updated = await tx.moveIn.update({ where: { id: moveIn.id }, data: { status: "COMPLETED", actualDate: data.actualDate, history: { create: { actorUserId: userId, fromStatus: moveIn.status, toStatus: "COMPLETED", note: data.note } } } });
    await tx.lease.update({ where: { id: leaseId }, data: { moveStatus: "MOVED_IN" } });
    await record(tx, organisationId, userId, "move_in.completed", "move_in", moveIn.id, { leaseId, actualDate: data.actualDate });
    return updated;
  });
}

export async function getTenantOnboarding(userId: string, organisationId: string, leaseId: string) {
  const execution = await getLeaseExecution(userId, organisationId, leaseId);
  return {
    ...execution,
    requiredActions: [
      ...(!execution.readiness.signaturesSatisfied ? ["Complete required signatures"] : []),
      ...(!execution.readiness.depositSatisfied ? ["Confirm required deposit"] : []),
      ...(!execution.readiness.initialRentSatisfied ? ["Satisfy initial rent obligation"] : []),
      ...(!execution.readiness.moveInSatisfied ? ["Complete move-in requirements"] : []),
      ...(!execution.readiness.documentSatisfied ? ["Complete lease document"] : []),
    ],
  };
}
