import { Prisma, RentalApplicationStatus } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { AppError, notFound } from "@/platform/errors";
import { createLeaseSchema } from "@/modules/leases/schemas";
import { createLeaseInTransaction } from "@/modules/leases/service";
import {
  applicantIdSchema,
  applicantListSchema,
  applicationIdSchema,
  applicationListSchema,
  applicationTransitionSchema,
  createApplicantSchema,
  createApplicationLeaseSchema,
  createRentalApplicationSchema,
  updateApplicantSchema,
  updateRentalApplicationSchema,
} from "./schemas";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const jsonField = (value: unknown) => value === null ? Prisma.JsonNull : json(value);

const applicationInclude = {
  listing: {
    include: {
      property: { select: { id: true, name: true, referenceNumber: true } },
      unit: { select: { id: true, name: true } },
    },
  },
  lead: {
    include: {
      history: { orderBy: { createdAt: "asc" as const } },
      activities: { orderBy: { createdAt: "asc" as const } },
    },
  },
  applicant: true,
  assignee: { select: { id: true, user: { select: { id: true, displayName: true, email: true } } } },
  tenantOrganisation: { include: { tenant: true } },
  lease: true,
  statusHistory: { orderBy: { createdAt: "asc" as const } },
  activities: { orderBy: { createdAt: "asc" as const } },
  documents: { orderBy: { createdAt: "asc" as const } },
  consents: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.RentalApplicationInclude;

async function record(
  tx: Tx,
  organisationId: string,
  actorUserId: string,
  name: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown> = {},
) {
  await tx.auditEvent.create({
    data: { organisationId, actorUserId, action: name, entityType: aggregateType, entityId: aggregateId, metadata: json(payload) },
  });
  await tx.domainEvent.create({
    data: { organisationId, name, aggregateType, aggregateId, payload: json(payload) },
  });
}

async function validateAssignee(tx: Tx | typeof db, organisationId: string, assigneeMemberId: string | null | undefined) {
  if (!assigneeMemberId) return;
  const member = await tx.organisationMember.findFirst({
    where: { id: assigneeMemberId, organisationId, status: "ACTIVE", archivedAt: null },
    select: { id: true },
  });
  if (!member) throw new AppError("INVALID_APPLICATION_ASSIGNEE", 422, "The assignee must be an active member of this organisation.");
}

export async function createApplicant(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.applicationCreate);
  const data = createApplicantSchema.parse(input);
  return db.$transaction(async (tx) => {
    const applicant = await tx.applicant.create({ data: { ...data, organisationId, createdByUserId: userId } });
    await record(tx, organisationId, userId, "applicant.created", "applicant", applicant.id, {
      hasEmail: Boolean(applicant.email),
      hasPhone: Boolean(applicant.phone),
    });
    return applicant;
  });
}

export async function getApplicant(userId: string, organisationId: string, applicantId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.applicationRead);
  applicantId = applicantIdSchema.parse(applicantId);
  const applicant = await db.applicant.findFirst({
    where: { id: applicantId, organisationId, archivedAt: null },
    include: {
      applications: {
        select: { id: true, status: true, listingId: true, leadId: true, submittedAt: true, decisionAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!applicant) throw notFound();
  return applicant;
}

export async function listApplicants(userId: string, organisationId: string, query: unknown = {}) {
  await requirePermission(userId, organisationId, PERMISSIONS.applicationRead);
  const filters = applicantListSchema.parse(query);
  const where: Prisma.ApplicantWhereInput = {
    organisationId,
    archivedAt: null,
    ...(filters.q ? {
      OR: [
        { legalName: { contains: filters.q, mode: "insensitive" } },
        { preferredName: { contains: filters.q, mode: "insensitive" } },
        { email: { contains: filters.q, mode: "insensitive" } },
        { phone: { contains: filters.q } },
      ],
    } : {}),
  };
  const [items, total] = await db.$transaction([
    db.applicant.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.applicant.count({ where }),
  ]);
  return { items, pagination: { ...filters, q: undefined, total, totalPages: Math.ceil(total / filters.pageSize) } };
}

export async function updateApplicant(userId: string, organisationId: string, applicantId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.applicationCreate);
  applicantId = applicantIdSchema.parse(applicantId);
  const data = updateApplicantSchema.parse(input);
  return db.$transaction(async (tx) => {
    const current = await tx.applicant.findFirst({ where: { id: applicantId, organisationId, archivedAt: null } });
    if (!current) throw notFound();
    if (!(data.email ?? current.email) && !(data.phone ?? current.phone)) {
      throw new AppError("APPLICANT_CONTACT_REQUIRED", 422, "An applicant email address or phone number is required.");
    }
    const applicant = await tx.applicant.update({ where: { id: current.id }, data });
    await record(tx, organisationId, userId, "applicant.updated", "applicant", applicant.id, {
      changedFields: Object.keys(data).sort(),
    });
    return applicant;
  });
}

function applicationWriteData(data: ReturnType<typeof createRentalApplicationSchema.parse> | ReturnType<typeof updateRentalApplicationSchema.parse>) {
  const {
    documents,
    consents,
    employmentDetails,
    previousTenancy,
    references,
    emergencyContact,
    household,
    coApplicants,
    ...fields
  } = data;
  return {
    fields: {
      ...fields,
      ...(employmentDetails !== undefined ? { employmentDetails: jsonField(employmentDetails) } : {}),
      ...(previousTenancy !== undefined ? { previousTenancy: jsonField(previousTenancy) } : {}),
      ...(references !== undefined ? { references: jsonField(references) } : {}),
      ...(emergencyContact !== undefined ? { emergencyContact: jsonField(emergencyContact) } : {}),
      ...(household !== undefined ? { household: jsonField(household) } : {}),
      ...(coApplicants !== undefined ? { coApplicants: jsonField(coApplicants) } : {}),
      ...(fields.incomeAmountMinor !== undefined
        ? { incomeAmountMinor: fields.incomeAmountMinor === null ? null : new Prisma.Decimal(fields.incomeAmountMinor) }
        : {}),
    },
    documents,
    consents,
  };
}

async function transitionLead(
  tx: Tx,
  lead: { id: string; status: string; listingId: string },
  actorUserId: string,
  toStatus: "APPLICATION_STARTED" | "APPLICATION_SUBMITTED" | "CLOSED" | "LOST",
  note: string,
) {
  if (lead.status === toStatus || ["CLOSED", "LOST"].includes(lead.status)) return;
  const progression = ["NEW", "CONTACTED", "QUALIFIED", "VIEWING_SCHEDULED", "VIEWING_COMPLETED", "APPLICATION_STARTED", "APPLICATION_SUBMITTED"];
  if (!["CLOSED", "LOST"].includes(toStatus) && progression.indexOf(toStatus) <= progression.indexOf(lead.status)) return;
  const now = new Date();
  await tx.marketplaceLead.update({
    where: { id: lead.id },
    data: {
      status: toStatus,
      lastActivityAt: now,
      ...(toStatus === "APPLICATION_STARTED" ? { applicationStartedAt: now } : {}),
      ...(toStatus === "APPLICATION_SUBMITTED" ? { applicationSubmittedAt: now } : {}),
      ...(toStatus === "CLOSED" ? { closedAt: now } : {}),
      ...(toStatus === "LOST" ? { lostAt: now } : {}),
      history: { create: { actorUserId, fromStatus: lead.status as never, toStatus, note } },
      activities: { create: { actorUserId, type: `lead.${toStatus.toLowerCase()}`, note } },
    },
  });
}

export async function createRentalApplication(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.applicationCreate);
  const data = createRentalApplicationSchema.parse(input);
  if (data.staffReviewNotes !== undefined || data.assigneeMemberId !== undefined) {
    await requirePermission(userId, organisationId, PERMISSIONS.applicationReview);
  }
  return db.$transaction(async (tx) => {
    const [listing, lead, applicant] = await Promise.all([
      tx.listing.findFirst({ where: { id: data.listingId, organisationId, listingType: "RENT" } }),
      tx.marketplaceLead.findFirst({ where: { id: data.leadId, organisationId, listingId: data.listingId } }),
      tx.applicant.findFirst({ where: { id: data.applicantId, organisationId, archivedAt: null } }),
    ]);
    if (!listing || !lead || !applicant) throw notFound();
    if (["CLOSED", "LOST"].includes(lead.status)) {
      throw new AppError("LEAD_NOT_ACTIVE", 409, "An application cannot be created for a closed or lost lead.");
    }
    await validateAssignee(tx, organisationId, data.assigneeMemberId);
    const { fields, documents, consents } = applicationWriteData(data);
    const now = new Date();
    const application = await tx.rentalApplication.create({
      data: {
        ...fields,
        listingId: listing.id,
        leadId: lead.id,
        applicantId: applicant.id,
        organisationId,
        createdByUserId: userId,
        statusHistory: { create: { actorUserId: userId, toStatus: "DRAFT" } },
        activities: { create: { actorUserId: userId, type: "application.created" } },
        documents: {
          create: (documents ?? []).map((document) => ({
            ...document,
            metadata: document.metadata ? json(document.metadata) : undefined,
            uploadedByUserId: userId,
          })),
        },
        consents: {
          create: (consents ?? []).map((consent) => ({
            ...consent,
            metadata: consent.metadata ? json(consent.metadata) : undefined,
            grantedAt: consent.granted ? (consent.grantedAt ?? now) : consent.grantedAt,
            recordedByUserId: userId,
          })),
        },
      },
      include: applicationInclude,
    });
    await transitionLead(tx, lead, userId, "APPLICATION_STARTED", "Rental application created.");
    await record(tx, organisationId, userId, "application.created", "rental_application", application.id, {
      listingId: listing.id,
      leadId: lead.id,
      applicantId: applicant.id,
    });
    return application;
  });
}

export async function getRentalApplication(userId: string, organisationId: string, applicationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.applicationRead);
  applicationId = applicationIdSchema.parse(applicationId);
  const application = await db.rentalApplication.findFirst({
    where: { id: applicationId, organisationId },
    include: applicationInclude,
  });
  if (!application) throw notFound();
  return application;
}

export async function listRentalApplications(userId: string, organisationId: string, query: unknown = {}) {
  await requirePermission(userId, organisationId, PERMISSIONS.applicationRead);
  const filters = applicationListSchema.parse(query);
  const where: Prisma.RentalApplicationWhereInput = {
    organisationId,
    ...(filters.listingId ? { listingId: filters.listingId } : {}),
    ...(filters.leadId ? { leadId: filters.leadId } : {}),
    ...(filters.applicantId ? { applicantId: filters.applicantId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.assigneeMemberId ? { assigneeMemberId: filters.assigneeMemberId } : {}),
  };
  const [items, total] = await db.$transaction([
    db.rentalApplication.findMany({
      where,
      include: applicationInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.rentalApplication.count({ where }),
  ]);
  return { items, pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) } };
}

export async function updateRentalApplication(userId: string, organisationId: string, applicationId: string, input: unknown) {
  applicationId = applicationIdSchema.parse(applicationId);
  const data = updateRentalApplicationSchema.parse(input);
  await requirePermission(userId, organisationId, PERMISSIONS.applicationCreate);
  if (data.staffReviewNotes !== undefined || data.assigneeMemberId !== undefined) {
    await requirePermission(userId, organisationId, PERMISSIONS.applicationReview);
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${applicationId}))::text AS locked`;
    const current = await tx.rentalApplication.findFirst({ where: { id: applicationId, organisationId } });
    if (!current) throw notFound();
    if (!["DRAFT", "MORE_INFORMATION_REQUIRED"].includes(current.status)) {
      throw new AppError("APPLICATION_NOT_EDITABLE", 409, "Only draft applications or applications awaiting more information can be edited.");
    }
    await validateAssignee(tx, organisationId, data.assigneeMemberId);
    const { fields, documents, consents } = applicationWriteData(data);
    const now = new Date();
    const application = await tx.rentalApplication.update({
      where: { id: current.id },
      data: {
        ...fields,
        lastActivityAt: now,
        activities: { create: { actorUserId: userId, type: "application.updated", metadata: json({ changedFields: Object.keys(data).sort() }) } },
        ...(documents ? {
          documents: {
            create: documents.map((document) => ({
              ...document,
              metadata: document.metadata ? json(document.metadata) : undefined,
              uploadedByUserId: userId,
            })),
          },
        } : {}),
        ...(consents ? {
          consents: {
            create: consents.map((consent) => ({
              ...consent,
              metadata: consent.metadata ? json(consent.metadata) : undefined,
              grantedAt: consent.granted ? (consent.grantedAt ?? now) : consent.grantedAt,
              recordedByUserId: userId,
            })),
          },
        } : {}),
      },
      include: applicationInclude,
    });
    await record(tx, organisationId, userId, "application.updated", "rental_application", application.id, {
      changedFields: Object.keys(data).sort(),
    });
    return application;
  });
}

const transitions: Record<RentalApplicationStatus, RentalApplicationStatus[]> = {
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["UNDER_REVIEW", "WITHDRAWN", "EXPIRED"],
  UNDER_REVIEW: ["MORE_INFORMATION_REQUIRED", "APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED"],
  MORE_INFORMATION_REQUIRED: ["SUBMITTED", "WITHDRAWN", "EXPIRED"],
  APPROVED: [],
  REJECTED: [],
  WITHDRAWN: [],
  EXPIRED: [],
};

const transitionEvents: Partial<Record<RentalApplicationStatus, string>> = {
  SUBMITTED: "application.submitted",
  UNDER_REVIEW: "application.review_started",
  MORE_INFORMATION_REQUIRED: "application.more_information_requested",
  APPROVED: "application.approved",
  REJECTED: "application.rejected",
  WITHDRAWN: "application.withdrawn",
  EXPIRED: "application.expired",
};

export async function transitionRentalApplication(userId: string, organisationId: string, applicationId: string, input: unknown) {
  applicationId = applicationIdSchema.parse(applicationId);
  const data = applicationTransitionSchema.parse(input);
  const applicantControlled = ["SUBMITTED", "WITHDRAWN"].includes(data.status);
  await requirePermission(
    userId,
    organisationId,
    applicantControlled ? PERMISSIONS.applicationCreate : PERMISSIONS.applicationReview,
  );
  if (data.staffReviewNotes !== undefined) {
    await requirePermission(userId, organisationId, PERMISSIONS.applicationReview);
  }
  return db.$transaction(async (tx) => {
    const current = await tx.rentalApplication.findFirst({
      where: { id: applicationId, organisationId },
      include: { lead: true, applicant: true, consents: { orderBy: { createdAt: "desc" } } },
    });
    if (!current) throw notFound();
    if (["CLOSED", "LOST"].includes(current.lead.status) && data.status !== "WITHDRAWN") {
      throw new AppError("LEAD_NOT_ACTIVE", 409, "A closed or lost prospect cannot continue an application.");
    }
    if (data.status === "SUBMITTED") {
      const processingConsent = current.consents.find(({ type }) => type === "APPLICATION_PROCESSING");
      if (!processingConsent?.granted || processingConsent.revokedAt) {
        throw new AppError("APPLICATION_CONSENT_REQUIRED", 422, "Current application-processing consent is required before submission.");
      }
    }
    if (!transitions[current.status].includes(data.status)) {
      throw new AppError("INVALID_APPLICATION_TRANSITION", 409, `A ${current.status} application cannot transition to ${data.status}.`);
    }
    const now = new Date();
    const eventName = transitionEvents[data.status]!;
    const application = await tx.rentalApplication.update({
      where: { id: current.id },
      data: {
        status: data.status,
        lastActivityAt: now,
        ...(data.status === "SUBMITTED" ? { submittedAt: current.submittedAt ?? now } : {}),
        ...(data.status === "UNDER_REVIEW" ? { reviewedAt: current.reviewedAt ?? now } : {}),
        ...(["APPROVED", "REJECTED"].includes(data.status) ? {
          decisionAt: now,
          decisionCategory: data.decisionCategory,
          decisionReason: data.decisionReason,
        } : {}),
        ...(data.staffReviewNotes !== undefined ? { staffReviewNotes: data.staffReviewNotes } : {}),
        statusHistory: {
          create: { actorUserId: userId, fromStatus: current.status, toStatus: data.status, note: data.note },
        },
        activities: {
          create: {
            actorUserId: userId,
            type: eventName,
            note: data.note,
            metadata: json({ fromStatus: current.status, toStatus: data.status }),
          },
        },
      },
      include: applicationInclude,
    });
    if (data.status === "SUBMITTED") {
      await transitionLead(tx, current.lead, userId, "APPLICATION_SUBMITTED", "Rental application submitted.");
    }
    if (["REJECTED", "WITHDRAWN", "EXPIRED"].includes(data.status)) {
      await transitionLead(tx, current.lead, userId, "LOST", `Application ${data.status.toLowerCase()}.`);
    }
    await record(tx, organisationId, userId, eventName, "rental_application", application.id, {
      fromStatus: current.status,
      toStatus: data.status,
      listingId: current.listingId,
      leadId: current.leadId,
      applicantId: current.applicantId,
    });
    return application;
  });
}

function normalizedPhone(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

export async function convertApprovedApplicationToTenant(userId: string, organisationId: string, applicationId: string) {
  applicationId = applicationIdSchema.parse(applicationId);
  await requirePermission(userId, organisationId, PERMISSIONS.applicationConvert);
  await requirePermission(userId, organisationId, PERMISSIONS.tenantCreate);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${organisationId}))::text AS locked`;
    const application = await tx.rentalApplication.findFirst({
      where: { id: applicationId, organisationId },
      include: { applicant: true, lead: true, tenantOrganisation: { include: { tenant: true } } },
    });
    if (!application) throw notFound();
    if (application.status !== "APPROVED") {
      throw new AppError("APPLICATION_NOT_APPROVED", 409, "Only approved applications can be converted to tenants.");
    }
    if (application.tenantOrganisation) return application.tenantOrganisation;

    const email = application.applicant.email?.trim().toLowerCase() ?? null;
    const phone = normalizedPhone(application.applicant.phone);
    const emailMatches = email
      ? await tx.tenantOrganisation.findMany({ where: { organisationId, email }, include: { tenant: true } })
      : [];
    const phoneMatches = phone
      ? (await tx.tenantOrganisation.findMany({
          where: { organisationId, phone: { not: null } },
          include: { tenant: true },
        })).filter((candidate) => normalizedPhone(candidate.phone) === phone)
      : [];
    const matches = [...new Map([...emailMatches, ...phoneMatches].map((candidate) => [candidate.id, candidate])).values()];
    if (matches.length > 1) {
      throw new AppError("AMBIGUOUS_TENANT_MATCH", 409, "Multiple tenant records match this applicant. Resolve the duplicate records before conversion.");
    }
    let relationship = matches[0] ?? null;
    const reused = Boolean(relationship);
    if (relationship) {
      if (relationship.archivedAt) {
        relationship = await tx.tenantOrganisation.update({
          where: { id: relationship.id },
          data: { archivedAt: null },
          include: { tenant: true },
        });
      }
    } else {
      const tenant = await tx.tenant.create({
        data: { legalName: application.applicant.legalName, preferredName: application.applicant.preferredName },
      });
      relationship = await tx.tenantOrganisation.create({
        data: {
          tenantId: tenant.id,
          organisationId,
          email,
          phone,
          addressLine1: application.applicant.addressLine1,
          city: application.applicant.city,
          countryCode: application.applicant.countryCode,
        },
        include: { tenant: true },
      });
    }
    const now = new Date();
    await tx.rentalApplication.update({
      where: { id: application.id },
      data: {
        tenantOrganisationId: relationship.id,
        lastActivityAt: now,
        activities: {
          create: {
            actorUserId: userId,
            type: "applicant.converted_to_tenant",
            metadata: json({ tenantOrganisationId: relationship.id }),
          },
        },
      },
    });
    await transitionLead(tx, application.lead, userId, "CLOSED", "Approved applicant converted to tenant.");
    await record(tx, organisationId, userId, "applicant.converted_to_tenant", "rental_application", application.id, {
      applicantId: application.applicantId,
      tenantOrganisationId: relationship.id,
      reused,
    });
    return relationship;
  });
}

export async function createDraftLeaseFromApplication(userId: string, organisationId: string, applicationId: string, input: unknown) {
  applicationId = applicationIdSchema.parse(applicationId);
  await requirePermission(userId, organisationId, PERMISSIONS.applicationConvert);
  await requirePermission(userId, organisationId, PERMISSIONS.leaseCreate);
  const request = createApplicationLeaseSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${applicationId}))::text AS locked`;
    const application = await tx.rentalApplication.findFirst({
      where: { id: applicationId, organisationId },
      include: { listing: true },
    });
    if (!application) throw notFound();
    if (application.status !== "APPROVED") {
      throw new AppError("APPLICATION_NOT_APPROVED", 409, "Only approved applications can create a lease.");
    }
    if (!application.tenantOrganisationId) {
      throw new AppError("APPLICATION_TENANT_REQUIRED", 409, "Convert the approved applicant to a tenant before creating a lease.");
    }
    if (application.leaseId) {
      throw new AppError("APPLICATION_LEASE_EXISTS", 409, "This application already has a lease.");
    }
    if (application.listing.listingType !== "RENT" || !application.listing.rentAmountMinor || !application.listing.frequency) {
      throw new AppError("LISTING_RENT_TERMS_REQUIRED", 409, "The rental listing does not have complete default rent terms.");
    }
    if (!application.listing.propertyId) throw new AppError("PROPERTYOS_LISTING_REQUIRED", 422, "Marketplace-native listings cannot be converted into UmoAfric leases.");
    const property = await tx.property.findFirst({
      where: { id: application.listing.propertyId, organisationId, archivedAt: null, status: "ACTIVE" },
      select: { id: true },
    });
    if (!property) throw new AppError("INVALID_LEASE_PROPERTY", 422, "The listing property is no longer available for lease creation.");
    if (application.listing.unitId) {
      const unit = await tx.unit.findFirst({
        where: { id: application.listing.unitId, propertyId: property.id, archivedAt: null },
        select: { id: true },
      });
      if (!unit) throw new AppError("INVALID_LEASE_UNIT", 422, "The listing unit is no longer available for lease creation.");
    }
    const tenant = await tx.tenantOrganisation.findFirst({
      where: { id: application.tenantOrganisationId, organisationId, archivedAt: null },
      select: { id: true },
    });
    if (!tenant) throw new AppError("INVALID_APPLICATION_TENANT", 422, "The converted tenant is no longer available.");
    const leaseData = createLeaseSchema.parse({
      referenceNumber: request.referenceNumber,
      propertyId: application.listing.propertyId,
      ...(application.listing.unitId ? { unitId: application.listing.unitId } : {}),
      tenantOrganisationIds: [application.tenantOrganisationId],
      startDate: request.startDate,
      endDate: request.endDate,
      rentAmountMinor: request.rentAmountMinor ?? application.listing.rentAmountMinor.toString(),
      currencyCode: request.currencyCode ?? application.listing.currencyCode,
      rentFrequency: request.rentFrequency ?? application.listing.frequency,
      customFrequency: request.customFrequency ?? undefined,
      depositAmountMinor: request.depositAmountMinor,
      status: "DRAFT",
      renewalStatus: "NOT_RENEWED",
      moveStatus: "NOT_MOVED_IN",
      notes: request.notes,
      documents: [],
    });
    const currency = await tx.currency.findUnique({ where: { code: leaseData.currencyCode } });
    if (!currency?.isActive) {
      throw new AppError("INVALID_LEASE_CURRENCY", 422, "The lease currency is not supported.");
    }
    const lease = await createLeaseInTransaction(tx, userId, organisationId, leaseData);
    await tx.rentalApplication.update({
      where: { id: application.id },
      data: {
        leaseId: lease.id,
        lastActivityAt: new Date(),
        activities: {
          create: {
            actorUserId: userId,
            type: "lease.draft_created_from_application",
            metadata: json({ leaseId: lease.id }),
          },
        },
      },
    });
    await record(tx, organisationId, userId, "lease.draft_created_from_application", "lease", lease.id, {
      applicationId: application.id,
      listingId: application.listingId,
      tenantOrganisationId: application.tenantOrganisationId,
    });
    return lease;
  });
}

export async function getCrmDashboard(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.applicationRead);
  await requirePermission(userId, organisationId, PERMISSIONS.listingLeadRead);
  await requirePermission(userId, organisationId, PERMISSIONS.listingViewingRead);
  const [leadCounts, viewingCounts, applicationCounts, recentLeads, recentApplications] = await db.$transaction([
    db.marketplaceLead.groupBy({ by: ["status"], where: { organisationId }, orderBy: { status: "asc" }, _count: { id: true } }),
    db.viewingRequest.groupBy({ by: ["status"], where: { organisationId }, orderBy: { status: "asc" }, _count: { id: true } }),
    db.rentalApplication.groupBy({ by: ["status"], where: { organisationId }, orderBy: { status: "asc" }, _count: { id: true } }),
    db.marketplaceLead.findMany({
      where: { organisationId },
      include: { listing: { select: { id: true, title: true } }, assignee: { include: { user: true } } },
      orderBy: { lastActivityAt: "desc" },
      take: 20,
    }),
    db.rentalApplication.findMany({
      where: { organisationId },
      include: { applicant: true, listing: { select: { id: true, title: true } }, assignee: { include: { user: true } } },
      orderBy: { lastActivityAt: "desc" },
      take: 20,
    }),
  ]);
  return {
    counts: {
      leads: Object.fromEntries(leadCounts.map(({ status, _count }) => [
        status,
        typeof _count === "object" && _count !== null ? (_count.id ?? 0) : 0,
      ])),
      viewings: Object.fromEntries(viewingCounts.map(({ status, _count }) => [
        status,
        typeof _count === "object" && _count !== null ? (_count.id ?? 0) : 0,
      ])),
      applications: Object.fromEntries(applicationCounts.map(({ status, _count }) => [
        status,
        typeof _count === "object" && _count !== null ? (_count.id ?? 0) : 0,
      ])),
    },
    recentLeads,
    recentApplications,
  };
}
