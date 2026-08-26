import { Prisma, ProviderQuotationStatus } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { AppError, forbidden, notFound } from "@/platform/errors";
import {
  addProviderToDirectorySchema,
  assignProviderSchema,
  createServiceCategorySchema,
  createProviderSchema,
  createQuotationRequestSchema,
  providerListSchema,
  rateProviderSchema,
  respondAssignmentSchema,
  reviewQuotationSchema,
  reviewVerificationSchema,
  submitQuotationSchema,
  submitVerificationSchema,
  updateProviderDirectorySchema,
  updateProviderSchema,
  updateServiceCategorySchema,
  quotationListSchema,
} from "./schemas";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const serviceAreaData = (area: { areaType: string; name: string; reference?: string; metadata?: unknown }) => ({
  areaType: area.areaType,
  name: area.name,
  reference: area.reference,
  ...(area.metadata ? { metadata: json(area.metadata) } : {}),
});

const providerInclude = {
  categories: { include: { category: true } },
  serviceAreas: { orderBy: { createdAt: "asc" as const } },
  evidence: { orderBy: { createdAt: "asc" as const } },
  verificationHistory: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.ServiceProviderInclude;

export async function ownsProvider(userId: string, providerId: string, tx: Tx | typeof db = db) {
  const provider = await tx.serviceProvider.findFirst({
    where: {
      id: providerId,
      archivedAt: null,
      OR: [
        { individualUserId: userId },
        { administratorUserId: userId },
        {
          companyOrganisation: {
            members: {
              some: {
                userId,
                status: "ACTIVE",
                archivedAt: null,
                roles: { some: { role: { key: { in: ["organisation_owner", "administrator"] } } } },
              },
            },
          },
        },
      ],
    },
  });
  return provider;
}

async function requireProviderOwner(userId: string, providerId: string, tx: Tx | typeof db = db) {
  const provider = await ownsProvider(userId, providerId, tx);
  if (!provider) throw forbidden();
  return provider;
}

async function requireDirectory(tx: Tx, organisationId: string, providerId: string, activeOnly = true) {
  const relationship = await tx.providerOrganisation.findFirst({
    where: {
      landlordOrganisationId: organisationId,
      providerId,
      ...(activeOnly ? { status: "ACTIVE" } : {}),
    },
  });
  if (!relationship) throw notFound();
  return relationship;
}

async function record(
  tx: Tx,
  organisationId: string,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown> = {},
) {
  await tx.auditEvent.create({
    data: { organisationId, actorUserId, action, entityType, entityId, metadata: json(payload) },
  });
  await tx.domainEvent.create({
    data: { organisationId, name: action, aggregateType: entityType, aggregateId: entityId, payload: json(payload) },
  });
}

async function validateCategories(tx: Tx, categoryIds: string[]) {
  if (!categoryIds.length) return;
  const count = await tx.serviceCategory.count({ where: { id: { in: categoryIds }, active: true } });
  if (count !== new Set(categoryIds).size) {
    throw new AppError("INVALID_SERVICE_CATEGORY", 422, "Every category must be active and valid.");
  }
}

export async function listServiceCategories() {
  return db.serviceCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } });
}

export async function createServiceCategory(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerVerify);
  const data = createServiceCategorySchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const category = await tx.serviceCategory.create({ data });
      await record(tx, organisationId, userId, "provider.category_created", "service_category", category.id, { key: category.key });
      return category;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("SERVICE_CATEGORY_EXISTS", 409, "A service category with this key already exists.");
    }
    throw error;
  }
}

export async function updateServiceCategory(
  userId: string,
  organisationId: string,
  categoryId: string,
  input: unknown,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerVerify);
  const data = updateServiceCategorySchema.parse(input);
  return db.$transaction(async (tx) => {
    const category = await tx.serviceCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw notFound();
    const updated = await tx.serviceCategory.update({ where: { id: categoryId }, data });
    await record(tx, organisationId, userId, "provider.category_updated", "service_category", category.id, {
      changedFields: Object.keys(data),
    });
    return updated;
  });
}

export async function createServiceProvider(userId: string, input: unknown) {
  const data = createProviderSchema.parse(input);
  return db.$transaction(async (tx) => {
    await validateCategories(tx, data.categoryIds);
    if (data.type === "COMPANY") {
      const membership = await tx.organisationMember.findFirst({
        where: {
          organisationId: data.companyOrganisationId,
          userId,
          status: "ACTIVE",
          archivedAt: null,
          roles: { some: { role: { key: { in: ["organisation_owner", "administrator"] } } } },
        },
      });
      if (!membership) throw forbidden();
    }
    const contactReady = Boolean(data.contactEmail || data.contactPhone);
    try {
      return await tx.serviceProvider.create({
        data: {
          type: data.type,
          individualUserId: data.type === "INDIVIDUAL" ? userId : undefined,
          companyOrganisationId: data.type === "COMPANY" ? data.companyOrganisationId : undefined,
          administratorUserId: userId,
          displayName: data.displayName,
          legalName: data.legalName,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone,
          contactReady,
          biography: data.biography,
          categories: { create: data.categoryIds.map((categoryId) => ({ categoryId })) },
          serviceAreas: { create: data.serviceAreas.map(serviceAreaData) },
        },
        include: providerInclude,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("PROVIDER_IDENTITY_EXISTS", 409, "This user or company already has a provider identity.");
      }
      throw error;
    }
  });
}

export async function updateServiceProvider(userId: string, providerId: string, input: unknown) {
  const data = updateProviderSchema.parse(input);
  return db.$transaction(async (tx) => {
    const current = await requireProviderOwner(userId, providerId, tx);
    if (data.categoryIds) await validateCategories(tx, data.categoryIds);
    const { categoryIds, serviceAreas, ...fields } = data;
    const contactEmail = fields.contactEmail === undefined ? current.contactEmail : fields.contactEmail;
    const contactPhone = fields.contactPhone === undefined ? current.contactPhone : fields.contactPhone;
    const contactReady = Boolean(contactEmail || contactPhone);
    const acceptingWork = fields.acceptingWork ?? current.acceptingWork;
    const availabilityStatus = fields.availabilityStatus ?? current.availabilityStatus;
    if (
      acceptingWork
      && (
        !contactReady
        || !current.evidenceReady
        || current.verificationStatus !== "VERIFIED"
        || availabilityStatus === "UNAVAILABLE"
      )
    ) {
      throw new AppError("PROVIDER_NOT_READY", 409, "Verified evidence and contact details are required before accepting work.");
    }
    await tx.serviceProvider.update({
      where: { id: providerId },
      data: {
        ...fields,
        contactReady,
        ...(categoryIds ? {
          categories: {
            deleteMany: {},
            create: categoryIds.map((categoryId) => ({ categoryId })),
          },
        } : {}),
        ...(serviceAreas ? {
          serviceAreas: {
            deleteMany: {},
            create: serviceAreas.map(serviceAreaData),
          },
        } : {}),
      },
    });
    const directories = await tx.providerOrganisation.findMany({ where: { providerId, status: "ACTIVE" } });
    for (const directory of directories) {
      await record(tx, directory.landlordOrganisationId, userId, "service_provider.updated", "service_provider", providerId, {
        changedFields: Object.keys(data),
      });
    }
    return tx.serviceProvider.findUniqueOrThrow({ where: { id: providerId }, include: providerInclude });
  });
}

export async function addProviderToDirectory(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerManage);
  const data = addProviderToDirectorySchema.parse(input);
  return db.$transaction(async (tx) => {
    const provider = await tx.serviceProvider.findFirst({ where: { id: data.providerId, archivedAt: null } });
    if (!provider) throw notFound();
    const relationship = await tx.providerOrganisation.upsert({
      where: { landlordOrganisationId_providerId: { landlordOrganisationId: organisationId, providerId: provider.id } },
      update: { status: "ACTIVE", internalNotes: data.internalNotes },
      create: {
        landlordOrganisationId: organisationId,
        providerId: provider.id,
        internalNotes: data.internalNotes,
        createdByUserId: userId,
      },
      include: { provider: { include: providerInclude } },
    });
    await record(tx, organisationId, userId, "provider.directory_added", "service_provider", provider.id, {
      providerOrganisationId: relationship.id,
    });
    await record(tx, organisationId, userId, "service_provider.created", "service_provider", provider.id, {
      providerOrganisationId: relationship.id,
    });
    return relationship;
  });
}

export async function updateProviderDirectory(userId: string, organisationId: string, providerId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerManage);
  const data = updateProviderDirectorySchema.parse(input);
  return db.$transaction(async (tx) => {
    const relationship = await requireDirectory(tx, organisationId, providerId, false);
    const updated = await tx.providerOrganisation.update({ where: { id: relationship.id }, data });
    await record(tx, organisationId, userId, "provider.directory_updated", "service_provider", providerId, {
      status: updated.status,
    });
    return updated;
  });
}

export async function listProviders(userId: string, organisationId: string, query: unknown = {}) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerRead);
  const filters = providerListSchema.parse(query);
  return db.providerOrganisation.findMany({
    where: {
      landlordOrganisationId: organisationId,
      ...(filters.status ? { status: filters.status } : { status: { not: "ARCHIVED" } }),
      provider: {
        archivedAt: null,
        ...(filters.verificationStatus ? { verificationStatus: filters.verificationStatus } : {}),
        ...(filters.availabilityStatus ? { availabilityStatus: filters.availabilityStatus } : {}),
        ...(filters.categoryId ? { categories: { some: { categoryId: filters.categoryId } } } : {}),
      },
    },
    include: {
      provider: {
        include: {
          categories: { include: { category: true } },
          serviceAreas: true,
          _count: { select: { assignments: true, ratings: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getProvider(userId: string, organisationId: string, providerId: string) {
  const own = await ownsProvider(userId, providerId);
  if (!own) await requirePermission(userId, organisationId, PERMISSIONS.providerRead);
  const directory = await db.providerOrganisation.findFirst({
    where: { landlordOrganisationId: organisationId, providerId },
    include: { provider: { include: providerInclude } },
  });
  if (!directory && !own) throw notFound();
  const provider = directory?.provider ?? await db.serviceProvider.findUnique({ where: { id: providerId }, include: providerInclude });
  if (!provider) throw notFound();
  return { provider, directory: directory ?? null, metrics: await getProviderMetrics(userId, organisationId, providerId) };
}

export async function submitProviderVerification(userId: string, providerId: string, input: unknown) {
  const data = submitVerificationSchema.parse(input);
  return db.$transaction(async (tx) => {
    const provider = await requireProviderOwner(userId, providerId, tx);
    if (!["UNVERIFIED", "REJECTED"].includes(provider.verificationStatus)) {
      throw new AppError("INVALID_VERIFICATION_STATE", 409, "Verification cannot be submitted in the current state.");
    }
    if (!provider.contactReady) throw new AppError("CONTACT_NOT_READY", 409, "Contact details are required for verification.");
    if (data.evidence.some((evidence) => evidence.expiresAt && evidence.expiresAt <= new Date())) {
      throw new AppError("EXPIRED_PROVIDER_EVIDENCE", 422, "Expired evidence cannot be submitted for verification.");
    }
    for (const evidence of data.evidence) {
      await tx.providerEvidence.upsert({
        where: { providerId_type_reference: { providerId, type: evidence.type, reference: evidence.reference } },
        update: { expiresAt: evidence.expiresAt },
        create: { ...evidence, providerId, submittedByUserId: userId },
      });
    }
    const updated = await tx.serviceProvider.update({
      where: { id: providerId },
      data: { verificationStatus: "PENDING", evidenceReady: true, acceptingWork: false },
    });
    await tx.providerVerificationHistory.create({
      data: { providerId, actorUserId: userId, fromStatus: provider.verificationStatus, toStatus: "PENDING" },
    });
    const directories = await tx.providerOrganisation.findMany({ where: { providerId, status: "ACTIVE" } });
    for (const directory of directories) {
      await record(tx, directory.landlordOrganisationId, userId, "provider.verification_submitted", "service_provider", providerId);
    }
    return updated;
  });
}

export async function reviewProviderVerification(
  userId: string,
  organisationId: string,
  providerId: string,
  input: unknown,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerVerify);
  const data = reviewVerificationSchema.parse(input);
  return db.$transaction(async (tx) => {
    await requireDirectory(tx, organisationId, providerId);
    const provider = await tx.serviceProvider.findUnique({ where: { id: providerId } });
    if (!provider) throw notFound();
    if (data.status !== "SUSPENDED" && provider.verificationStatus !== "PENDING") {
      throw new AppError("INVALID_VERIFICATION_STATE", 409, "Only pending verification may be approved or rejected.");
    }
    if (data.status === "SUSPENDED" && provider.verificationStatus !== "VERIFIED") {
      throw new AppError("INVALID_VERIFICATION_STATE", 409, "Only verified providers may be suspended.");
    }
    const currentEvidence = await tx.providerEvidence.count({
      where: { providerId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    if (data.status === "VERIFIED" && (!provider.contactReady || currentEvidence === 0)) {
      throw new AppError("PROVIDER_NOT_READY", 409, "Current evidence and contact details are required for verification.");
    }
    const updated = await tx.serviceProvider.update({
      where: { id: providerId },
      data: {
        verificationStatus: data.status,
        ...(data.status !== "VERIFIED" ? { acceptingWork: false, availabilityStatus: "UNAVAILABLE" } : {}),
      },
    });
    await tx.providerVerificationHistory.create({
      data: {
        providerId,
        actorUserId: userId,
        fromStatus: provider.verificationStatus,
        toStatus: data.status,
        reason: data.reason,
      },
    });
    await record(tx, organisationId, userId, `provider.${data.status.toLowerCase()}`, "service_provider", providerId, {
      fromStatus: provider.verificationStatus,
      reason: data.reason ?? null,
    });
    if (data.status === "VERIFIED") {
      await record(tx, organisationId, userId, "service_provider.verified", "service_provider", providerId, {
        fromStatus: provider.verificationStatus,
      });
    }
    return updated;
  });
}

export async function createProviderQuotationRequest(
  userId: string,
  organisationId: string,
  input: unknown,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerManage);
  const data = createQuotationRequestSchema.parse(input);
  if (data.responseDueAt && data.responseDueAt <= new Date()) {
    throw new AppError("INVALID_RESPONSE_DUE_AT", 422, "Response due date must be in the future.");
  }
  return db.$transaction(async (tx) => {
    await requireDirectory(tx, organisationId, data.providerId);
    const provider = await tx.serviceProvider.findUniqueOrThrow({ where: { id: data.providerId } });
    if (provider.verificationStatus !== "VERIFIED" || !provider.contactReady || !provider.evidenceReady) {
      throw new AppError("PROVIDER_NOT_READY", 409, "The provider must be verified with contact details and evidence.");
    }
    const maintenance = await tx.maintenanceRequest.findFirst({
      where: { id: data.maintenanceRequestId, organisationId },
    });
    if (!maintenance) throw notFound();
    if (["COMPLETED", "CLOSED", "REJECTED", "CANCELLED"].includes(maintenance.status)) {
      throw new AppError("INVALID_MAINTENANCE_STATE", 409, "A quotation cannot be requested for terminal maintenance.");
    }
    const request = await tx.providerQuotationRequest.create({
      data: {
        landlordOrganisationId: organisationId,
        providerId: data.providerId,
        maintenanceRequestId: data.maintenanceRequestId,
        requestedByUserId: userId,
        scope: data.scope,
        responseDueAt: data.responseDueAt,
      },
    });
    await record(tx, organisationId, userId, "provider.quotation_requested", "provider_quotation_request", request.id, {
      providerId: data.providerId,
      maintenanceRequestId: data.maintenanceRequestId,
    });
    await record(tx, organisationId, userId, "quote.requested", "provider_quotation_request", request.id, {
      providerId: data.providerId,
      maintenanceRequestId: data.maintenanceRequestId,
    });
    return request;
  });
}

export async function listProviderQuotationRequests(
  userId: string,
  organisationId: string,
  query: unknown = {},
) {
  const data = quotationListSchema.parse(query);
  const internal = await requirePermission(userId, organisationId, PERMISSIONS.providerRead).then(() => true).catch(() => false);
  if (!internal && (!data.providerId || !await ownsProvider(userId, data.providerId))) throw forbidden();
  return db.providerQuotationRequest.findMany({
    where: {
      landlordOrganisationId: organisationId,
      ...(data.providerId ? { providerId: data.providerId } : {}),
      ...(data.maintenanceRequestId ? { maintenanceRequestId: data.maintenanceRequestId } : {}),
      ...(data.status ? { status: data.status } : {}),
    },
    include: { quotations: { include: { reviews: { orderBy: { createdAt: "asc" } } } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function submitProviderQuotation(
  userId: string,
  organisationId: string,
  requestId: string,
  input: unknown,
) {
  const data = submitQuotationSchema.parse(input);
  if (data.validUntil <= new Date()) throw new AppError("INVALID_QUOTE_VALIDITY", 422, "Quotation validity must be in the future.");
  return db.$transaction(async (tx) => {
    const request = await tx.providerQuotationRequest.findFirst({
      where: { id: requestId, landlordOrganisationId: organisationId },
      include: { maintenanceRequest: { include: { property: { select: { currencyCode: true } } } } },
    });
    if (!request) throw notFound();
    await requireDirectory(tx, organisationId, request.providerId);
    if (!["OPEN", "SUBMITTED"].includes(request.status)) {
      throw new AppError("IMMUTABLE_QUOTATION_REQUEST", 409, "This quotation request is closed.");
    }
    const providerOwned = Boolean(await ownsProvider(userId, request.providerId, tx));
    if (!providerOwned) await requirePermission(userId, organisationId, PERMISSIONS.providerQuoteRecord);
    if (data.currencyCode !== request.maintenanceRequest.property.currencyCode) {
      throw new AppError("CURRENCY_MISMATCH", 422, "Quotation currency must match the property currency.");
    }
    const source = providerOwned ? "PROVIDER" : "ADMIN_RECORDED";
    const quotation = await tx.providerQuotation.create({
      data: {
        landlordOrganisationId: organisationId,
        requestId,
        providerId: request.providerId,
        source,
        labourAmountMinor: data.labourAmountMinor,
        materialsAmountMinor: data.materialsAmountMinor,
        totalAmountMinor: data.totalAmountMinor,
        currencyCode: data.currencyCode,
        validUntil: data.validUntil,
        etaDays: data.etaDays,
        notes: data.notes,
        submittedByUserId: providerOwned ? userId : undefined,
        recordedByUserId: providerOwned ? undefined : userId,
      },
    });
    await tx.providerQuotationRequest.update({ where: { id: request.id }, data: { status: "SUBMITTED" } });
    await record(
      tx,
      organisationId,
      userId,
      providerOwned ? "provider.quotation_submitted" : "provider.quotation_recorded",
      "provider_quotation",
      quotation.id,
      { requestId, providerId: request.providerId, totalAmountMinor: data.totalAmountMinor, currencyCode: data.currencyCode },
    );
    await record(tx, organisationId, userId, "quote.submitted", "provider_quotation", quotation.id, {
      requestId,
      providerId: request.providerId,
      totalAmountMinor: data.totalAmountMinor,
      currencyCode: data.currencyCode,
    });
    return quotation;
  });
}

async function reviewQuotation(
  userId: string,
  organisationId: string,
  quotationId: string,
  input: unknown,
  decision: Extract<ProviderQuotationStatus, "APPROVED" | "REJECTED">,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerQuoteReview);
  const data = reviewQuotationSchema.parse(input);
  return db.$transaction(async (tx) => {
    const quote = await tx.providerQuotation.findFirst({
      where: { id: quotationId, landlordOrganisationId: organisationId },
      include: { request: true },
    });
    if (!quote) throw notFound();
    if (quote.status !== "SUBMITTED") throw new AppError("IMMUTABLE_QUOTATION", 409, "This quotation has already been reviewed.");
    if (decision === "APPROVED" && quote.validUntil <= new Date()) {
      throw new AppError("QUOTATION_EXPIRED", 409, "An expired quotation cannot be approved.");
    }
    const updated = await tx.providerQuotation.update({ where: { id: quote.id }, data: { status: decision } });
    await tx.providerQuotationReview.create({
      data: { quotationId: quote.id, reviewerUserId: userId, decision, reason: data.reason },
    });
    if (decision === "APPROVED") {
      await tx.providerQuotation.updateMany({
        where: { requestId: quote.requestId, id: { not: quote.id }, status: "SUBMITTED" },
        data: { status: "WITHDRAWN" },
      });
      await tx.providerQuotationRequest.update({ where: { id: quote.requestId }, data: { status: "CLOSED" } });
    }
    await record(tx, organisationId, userId, `provider.quotation_${decision.toLowerCase()}`, "provider_quotation", quote.id, {
      requestId: quote.requestId,
      providerId: quote.providerId,
      reason: data.reason ?? null,
    });
    await record(tx, organisationId, userId, `quote.${decision.toLowerCase()}`, "provider_quotation", quote.id, {
      requestId: quote.requestId,
      providerId: quote.providerId,
      reason: data.reason ?? null,
    });
    return updated;
  });
}

export const approveProviderQuotation = (
  userId: string,
  organisationId: string,
  quotationId: string,
  input: unknown,
) => reviewQuotation(userId, organisationId, quotationId, input, "APPROVED");

export const rejectProviderQuotation = (
  userId: string,
  organisationId: string,
  quotationId: string,
  input: unknown,
) => reviewQuotation(userId, organisationId, quotationId, input, "REJECTED");

export async function assignProviderToWorkOrder(
  userId: string,
  organisationId: string,
  workOrderId: string,
  input: unknown,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerAssign);
  const data = assignProviderSchema.parse(input);
  return db.$transaction(async (tx) => {
    await requireDirectory(tx, organisationId, data.providerId);
    const provider = await tx.serviceProvider.findUniqueOrThrow({ where: { id: data.providerId } });
    const currentEvidence = await tx.providerEvidence.count({
      where: { providerId: data.providerId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    if (
      provider.verificationStatus !== "VERIFIED"
      || !provider.contactReady
      || !provider.evidenceReady
      || currentEvidence === 0
      || !provider.acceptingWork
      || provider.availabilityStatus === "UNAVAILABLE"
    ) {
      throw new AppError("PROVIDER_NOT_READY", 409, "The provider is not ready to accept assignments.");
    }
    const workOrder = await tx.workOrder.findFirst({
      where: { id: workOrderId, organisationId },
      include: { maintenanceRequest: true },
    });
    if (!workOrder) throw notFound();
    if (!["OPEN", "ASSIGNED"].includes(workOrder.status)) {
      throw new AppError("IMMUTABLE_WORK_ORDER", 409, "This work order cannot be assigned.");
    }
    if (await tx.providerAssignment.count({ where: { workOrderId, status: { in: ["PENDING", "ACCEPTED"] } } })) {
      throw new AppError("PROVIDER_ASSIGNMENT_EXISTS", 409, "This work order already has an active provider assignment.");
    }
    if (data.quotationId) {
      const quotation = await tx.providerQuotation.findFirst({
        where: {
          id: data.quotationId,
          landlordOrganisationId: organisationId,
          providerId: data.providerId,
          status: "APPROVED",
          request: { maintenanceRequestId: workOrder.maintenanceRequestId },
        },
      });
      if (!quotation) throw new AppError("INVALID_APPROVED_QUOTATION", 422, "Quotation must be approved for this provider and maintenance request.");
    }
    const assignment = await tx.providerAssignment.create({
      data: {
        landlordOrganisationId: organisationId,
        workOrderId,
        providerId: data.providerId,
        quotationId: data.quotationId,
        assignedByUserId: userId,
        expectedStartAt: data.expectedStartAt,
        expectedCompletionAt: data.expectedCompletionAt,
      },
    });
    const updatedWorkOrder = await tx.workOrder.update({
      where: { id: workOrder.id },
      data: {
        status: "ASSIGNED",
        assignedAt: new Date(),
        assigneeMemberId: null,
        assigneeUserId: null,
        ...(data.quotationId ? {
          estimateAmountMinor: (await tx.providerQuotation.findUniqueOrThrow({ where: { id: data.quotationId } })).totalAmountMinor,
        } : {}),
      },
    });
    await tx.workOrderHistory.create({
      data: {
        workOrderId,
        actorUserId: userId,
        status: updatedWorkOrder.status,
        estimateAmountMinor: updatedWorkOrder.estimateAmountMinor,
        actualCostAmountMinor: updatedWorkOrder.actualCostAmountMinor,
        currencyCode: updatedWorkOrder.currencyCode,
        metadata: { action: "provider_assigned", providerId: data.providerId, assignmentId: assignment.id, quotationId: data.quotationId ?? null },
      },
    });
    if (workOrder.maintenanceRequest.status !== "ASSIGNED") {
      await tx.maintenanceRequest.update({ where: { id: workOrder.maintenanceRequestId }, data: { status: "ASSIGNED" } });
      await tx.maintenanceHistory.create({
        data: {
          maintenanceRequestId: workOrder.maintenanceRequestId,
          actorUserId: userId,
          type: "STATUS",
          fromStatus: workOrder.maintenanceRequest.status,
          toStatus: "ASSIGNED",
          metadata: { workOrderId, providerId: data.providerId, assignmentId: assignment.id },
        },
      });
      await tx.auditEvent.create({
        data: {
          organisationId,
          actorUserId: userId,
          action: "maintenance.status_changed",
          entityType: "maintenance_request",
          entityId: workOrder.maintenanceRequestId,
          metadata: { fromStatus: workOrder.maintenanceRequest.status, toStatus: "ASSIGNED" },
        },
      });
    }
    await tx.maintenanceHistory.create({
      data: {
        maintenanceRequestId: workOrder.maintenanceRequestId,
        actorUserId: userId,
        type: "ASSIGNMENT",
        metadata: { workOrderId, providerId: data.providerId, assignmentId: assignment.id },
      },
    });
    await record(tx, organisationId, userId, "provider.assigned", "provider_assignment", assignment.id, {
      workOrderId,
      providerId: data.providerId,
      quotationId: data.quotationId ?? null,
    });
    await record(tx, organisationId, userId, "workorder.provider_assigned", "provider_assignment", assignment.id, {
      workOrderId,
      providerId: data.providerId,
      quotationId: data.quotationId ?? null,
    });
    await tx.auditEvent.create({
      data: {
        organisationId,
        actorUserId: userId,
        action: "workorder.assigned",
        entityType: "work_order",
        entityId: workOrderId,
        metadata: { providerId: data.providerId, providerAssignmentId: assignment.id },
      },
    });
    await tx.domainEvent.create({
      data: {
        organisationId,
        name: "workorder.assigned",
        aggregateType: "work_order",
        aggregateId: workOrderId,
        payload: { providerId: data.providerId, providerAssignmentId: assignment.id },
      },
    });
    return assignment;
  });
}

export async function respondToProviderAssignment(
  userId: string,
  organisationId: string,
  assignmentId: string,
  input: unknown,
) {
  const data = respondAssignmentSchema.parse(input);
  return db.$transaction(async (tx) => {
    const assignment = await tx.providerAssignment.findFirst({
      where: { id: assignmentId, landlordOrganisationId: organisationId },
    });
    if (!assignment) throw notFound();
    await requireProviderOwner(userId, assignment.providerId, tx);
    if (assignment.status !== "PENDING") {
      throw new AppError("ASSIGNMENT_ALREADY_RESPONDED", 409, "This assignment has already been answered.");
    }
    if (data.response === "ACCEPTED") {
      await requireDirectory(tx, organisationId, assignment.providerId);
      const provider = await tx.serviceProvider.findUniqueOrThrow({ where: { id: assignment.providerId } });
      const currentEvidence = await tx.providerEvidence.count({
        where: { providerId: assignment.providerId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      });
      if (
        provider.verificationStatus !== "VERIFIED"
        || !provider.contactReady
        || !provider.evidenceReady
        || currentEvidence === 0
        || !provider.acceptingWork
        || provider.availabilityStatus === "UNAVAILABLE"
      ) {
        throw new AppError("PROVIDER_NOT_READY", 409, "The provider is not ready to accept this assignment.");
      }
    }
    const now = new Date();
    const updated = await tx.providerAssignment.update({
      where: { id: assignment.id },
      data: {
        status: data.response,
        respondedByUserId: userId,
        respondedAt: now,
        acceptedAt: data.response === "ACCEPTED" ? now : undefined,
        declinedAt: data.response === "DECLINED" ? now : undefined,
        declineReason: data.response === "DECLINED" ? data.declineReason : undefined,
        expectedStartAt: data.expectedStartAt,
        expectedCompletionAt: data.expectedCompletionAt,
      },
    });
    if (data.response === "DECLINED") {
      const workOrder = await tx.workOrder.update({
        where: { id: assignment.workOrderId },
        data: { status: "OPEN", assignedAt: null },
      });
      await tx.workOrderHistory.create({
        data: {
          workOrderId: workOrder.id,
          actorUserId: userId,
          status: workOrder.status,
          estimateAmountMinor: workOrder.estimateAmountMinor,
          actualCostAmountMinor: workOrder.actualCostAmountMinor,
          currencyCode: workOrder.currencyCode,
          metadata: { action: "provider_declined", providerId: assignment.providerId, assignmentId: assignment.id },
          note: data.declineReason,
        },
      });
    }
    await record(tx, organisationId, userId, `provider.assignment_${data.response.toLowerCase()}`, "provider_assignment", assignment.id, {
      workOrderId: assignment.workOrderId,
      providerId: assignment.providerId,
      declineReason: data.declineReason ?? null,
    });
    return updated;
  });
}

export async function rateProvider(
  userId: string,
  organisationId: string,
  workOrderId: string,
  input: unknown,
) {
  await requirePermission(userId, organisationId, PERMISSIONS.providerRate);
  const data = rateProviderSchema.parse(input);
  return db.$transaction(async (tx) => {
    const workOrder = await tx.workOrder.findFirst({
      where: { id: workOrderId, organisationId, status: "COMPLETED" },
      include: {
        providerAssignments: { where: { status: { in: ["ACCEPTED", "COMPLETED"] } }, orderBy: { assignedAt: "desc" }, take: 1 },
      },
    });
    if (!workOrder) throw new AppError("COMPLETED_WORK_ORDER_REQUIRED", 409, "Only completed work orders may be rated.");
    const assignment = workOrder.providerAssignments[0];
    if (!assignment) throw new AppError("PROVIDER_ASSIGNMENT_REQUIRED", 409, "The work order has no accepted provider assignment.");
    try {
      const rating = await tx.providerRating.create({
        data: {
          landlordOrganisationId: organisationId,
          workOrderId,
          providerId: assignment.providerId,
          createdByUserId: userId,
          ...data,
        },
      });
      await record(tx, organisationId, userId, "provider.rated", "provider_rating", rating.id, {
        providerId: assignment.providerId,
        workOrderId,
        score: data.score,
      });
      await record(tx, organisationId, userId, "provider.review_created", "provider_rating", rating.id, {
        providerId: assignment.providerId,
        workOrderId,
        score: data.score,
      });
      return rating;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("WORK_ORDER_ALREADY_RATED", 409, "This work order has already been rated.");
      }
      throw error;
    }
  });
}

export async function getProviderJobHistory(userId: string, organisationId: string, providerId: string) {
  const own = await ownsProvider(userId, providerId);
  if (!own) {
    await requirePermission(userId, organisationId, PERMISSIONS.providerRead);
    const directory = await db.providerOrganisation.findFirst({ where: { landlordOrganisationId: organisationId, providerId } });
    if (!directory) throw notFound();
  }
  return db.providerAssignment.findMany({
    where: { providerId, ...(own ? {} : { landlordOrganisationId: organisationId }) },
    include: {
      quotation: true,
      workOrder: {
        include: {
          maintenanceRequest: { select: { id: true, title: true, category: true, priority: true } },
          property: { select: { id: true, name: true } },
          providerRating: true,
        },
      },
    },
    orderBy: { assignedAt: "desc" },
  });
}

export async function getProviderMetrics(userId: string, organisationId: string, providerId: string) {
  const own = await ownsProvider(userId, providerId);
  if (!own) {
    await requirePermission(userId, organisationId, PERMISSIONS.providerRead);
    const directory = await db.providerOrganisation.findFirst({ where: { landlordOrganisationId: organisationId, providerId } });
    if (!directory) throw notFound();
  }
  const scope = { providerId, ...(own ? {} : { landlordOrganisationId: organisationId }) };
  const [assignments, ratings, completedOrders] = await Promise.all([
    db.providerAssignment.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    db.providerRating.aggregate({
      where: scope,
      _count: { _all: true },
      _avg: { score: true, qualityScore: true, timelinessScore: true, communicationScore: true },
    }),
    db.providerAssignment.findMany({
      where: { ...scope, status: "COMPLETED" },
      select: { expectedCompletionAt: true, completedAt: true },
    }),
  ]);
  const count = (status: string) => assignments.find((row) => row.status === status)?._count._all ?? 0;
  const accepted = count("ACCEPTED") + count("COMPLETED");
  const declined = count("DECLINED");
  const answered = accepted + declined;
  const onTimeEligible = completedOrders.filter((job) => job.expectedCompletionAt && job.completedAt);
  const onTime = onTimeEligible.filter((job) => job.completedAt! <= job.expectedCompletionAt!).length;
  return {
    assignments: assignments.reduce((sum, row) => sum + row._count._all, 0),
    accepted,
    declined,
    completed: count("COMPLETED"),
    acceptanceRate: answered ? accepted / answered : null,
    onTimeRate: onTimeEligible.length ? onTime / onTimeEligible.length : null,
    ratings: ratings._count._all,
    averageRating: ratings._avg.score,
    averageQuality: ratings._avg.qualityScore,
    averageTimeliness: ratings._avg.timelinessScore,
    averageCommunication: ratings._avg.communicationScore,
  };
}
