import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";
import { AppError, forbidden, notFound } from "@/platform/errors";
import { getObjectStorageAdapter } from "@/platform/storage";
import { renderSimpleDocument } from "./pdf";
import { getActiveDocumentTemplate, fillTemplate } from "./templates";
import { getFinalTenantStatement } from "@/modules/move-out/service";
import { createLeaseDocumentVersion } from "@/modules/lease-execution/service";
import { assertOperational, assertWithinLimit } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";

type GeneratedDocumentTypeValue = "RECEIPT" | "TENANT_STATEMENT" | "MOVE_OUT_STATEMENT" | "LEASE_AGREEMENT";
const json = (value: unknown) => value as Prisma.InputJsonValue;
const money = (minor: string | Prisma.Decimal, currencyCode: string) => `${currencyCode} ${(Number(minor) / 100).toFixed(2)}`;
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

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

function referencePrefix(documentType: GeneratedDocumentTypeValue) {
  return { RECEIPT: "RCT", TENANT_STATEMENT: "STM", MOVE_OUT_STATEMENT: "MOS", LEASE_AGREEMENT: "LSE" }[documentType];
}

/**
 * Idempotent, immutable, versioned document generation core (item 3). `snapshot` captures exactly
 * the source data that determined the rendered bytes: an unchanged snapshot always returns the
 * already-issued document instead of re-rendering, and a changed snapshot creates a new `version`
 * while every previous version's bytes remain retrievable — legal/financial documents are never
 * overwritten.
 */
async function storeGeneratedDocument(params: {
  organisationId: string;
  documentType: GeneratedDocumentTypeValue;
  sourceType: string;
  sourceId: string;
  snapshot: unknown;
  bytes: Uint8Array;
  fileName: string;
  generatedByUserId: string;
  leaseId?: string | null;
  tenantOrganisationId?: string | null;
  propertyId?: string | null;
}) {
  const dataHash = createHash("sha256").update(JSON.stringify(params.snapshot)).digest("hex");
  const existing = await db.generatedDocument.findUnique({
    where: {
      organisationId_documentType_sourceType_sourceId_dataHash: {
        organisationId: params.organisationId, documentType: params.documentType, sourceType: params.sourceType, sourceId: params.sourceId, dataHash,
      },
    },
    include: { storageObject: true },
  });
  if (existing) return existing;

  // Representative entitlement checks (item 2): generated documents are metered per billing
  // period, and their bytes count against the same storage ceiling uploads do. Both are only
  // evaluated once we know this call will actually create a new document/version — an unchanged
  // snapshot returning the already-issued document above never counts as new usage.
  const bytesBuffer = Buffer.from(params.bytes);
  await assertOperational(params.organisationId, ENTITLEMENTS.documentsMonthlyMax.key);
  await assertWithinLimit(params.organisationId, ENTITLEMENTS.storageBytesMax.key, bytesBuffer.length);
  const sha256 = createHash("sha256").update(bytesBuffer).digest("hex");
  const storageKey = `${params.organisationId}/GENERATED/${params.documentType}/${params.sourceId}/${randomUUID()}-${params.fileName}`;
  const adapter = getObjectStorageAdapter();
  await adapter.putObject({ key: storageKey, body: bytesBuffer, contentType: "application/pdf", classification: "PRIVATE" });

  try {
    return await db.$transaction(async (tx) => {
      const maxVersion = await tx.generatedDocument.aggregate({
        where: { organisationId: params.organisationId, documentType: params.documentType, sourceType: params.sourceType, sourceId: params.sourceId },
        _max: { version: true },
      });
      const nextVersion = (maxVersion._max.version ?? 0) + 1;
      if (nextVersion > 1) {
        await tx.generatedDocument.updateMany({
          where: { organisationId: params.organisationId, documentType: params.documentType, sourceType: params.sourceType, sourceId: params.sourceId, supersededAt: null },
          data: { supersededAt: new Date() },
        });
      }
      const storageObject = await tx.storageObject.create({
        data: {
          organisationId: params.organisationId,
          storageKey,
          origin: "GENERATED",
          classification: "PRIVATE",
          targetType: "GENERATED_DOCUMENT",
          originalFileName: params.fileName,
          safeFileName: params.fileName,
          declaredContentType: "application/pdf",
          contentType: "application/pdf",
          sizeBytes: bytesBuffer.length,
          sha256,
          uploadedByUserId: params.generatedByUserId,
          malwareScanStatus: "SKIPPED",
          malwareScanDetail: "Internally generated document; not user-uploaded content.",
        },
      });
      const referenceNumber = `${referencePrefix(params.documentType)}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const created = await tx.generatedDocument.create({
        data: {
          organisationId: params.organisationId,
          storageObjectId: storageObject.id,
          documentType: params.documentType,
          referenceNumber,
          version: nextVersion,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
          dataHash,
          leaseId: params.leaseId ?? null,
          tenantOrganisationId: params.tenantOrganisationId ?? null,
          propertyId: params.propertyId ?? null,
          generatedByUserId: params.generatedByUserId,
        },
      });
      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId, actorUserId: params.generatedByUserId, action: "document.generated",
          entityType: "generated_document", entityId: created.id,
          metadata: json({ documentType: params.documentType, sourceType: params.sourceType, sourceId: params.sourceId, version: nextVersion }),
        },
      });
      await tx.domainEvent.create({
        data: {
          organisationId: params.organisationId, name: "document.generated", aggregateType: "generated_document", aggregateId: created.id,
          payload: json({ documentType: params.documentType, sourceType: params.sourceType, sourceId: params.sourceId, version: nextVersion }),
        },
      });
      if (params.documentType === "LEASE_AGREEMENT" && params.leaseId) {
        await tx.domainEvent.create({
          data: {
            organisationId: params.organisationId, name: "lease.document_generated", aggregateType: "lease", aggregateId: params.leaseId,
            payload: json({ generatedDocumentId: created.id, version: nextVersion }),
          },
        });
      }
      return tx.generatedDocument.findUniqueOrThrow({ where: { id: created.id }, include: { storageObject: true } });
    });
  } catch (error) {
    await adapter.deleteObject(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function generateReceiptPdf(userId: string, organisationId: string, receiptId: string) {
  const receipt = await db.receipt.findFirst({
    where: { id: receiptId, organisationId },
    include: {
      tenantOrganisation: { include: { tenant: true } },
      lease: true,
      property: true,
      unit: true,
      payment: { include: { allocations: { include: { rentObligation: true } } } },
    },
  });
  if (!receipt) throw notFound();
  const internal = await hasPermission(userId, organisationId, PERMISSIONS.paymentRead);
  if (!internal) {
    const tenant = await db.tenantOrganisation.findFirst({ where: { id: receipt.tenantOrganisationId, organisationId, userId, archivedAt: null } });
    if (!tenant) throw forbidden();
  }
  const organisation = await db.organisation.findUniqueOrThrow({ where: { id: organisationId } });
  const tenantName = receipt.tenantOrganisation.tenant.preferredName || receipt.tenantOrganisation.tenant.legalName;
  const snapshot = {
    receiptNumber: receipt.receiptNumber,
    amountMinor: receipt.amountMinor.toString(),
    currencyCode: receipt.currencyCode,
    method: receipt.method,
    paidAt: receipt.paidAt.toISOString(),
    status: receipt.status,
    voidedAt: receipt.voidedAt?.toISOString() ?? null,
    allocations: receipt.payment.allocations.map((allocation) => ({ amountMinor: allocation.amountMinor.toString(), dueDate: allocation.rentObligation.dueDate.toISOString() })),
  };
  const bytes = await renderSimpleDocument({
    title: "Payment receipt",
    subtitle: organisation.name,
    referenceNumber: receipt.receiptNumber,
    issuedLabel: `Issued ${dateOnly(receipt.issuedAt)}`,
    sections: [{
      rows: [
        { label: "Status", value: receipt.status },
        { label: "Tenant", value: tenantName },
        { label: "Lease", value: receipt.lease.referenceNumber },
        { label: "Property", value: receipt.unit ? `${receipt.property.name} / ${receipt.unit.name}` : receipt.property.name },
        { label: "Payment method", value: receipt.method.replaceAll("_", " ") },
        { label: "Paid on", value: dateOnly(receipt.paidAt) },
        { label: "Amount", value: money(receipt.amountMinor, receipt.currencyCode) },
      ],
    }],
    table: receipt.payment.allocations.length
      ? {
        headers: ["Rent obligation due", "Allocated amount"],
        columnWidths: [320, 200],
        rows: receipt.payment.allocations.map((allocation) => [dateOnly(allocation.rentObligation.dueDate), money(allocation.amountMinor, receipt.currencyCode)]),
      }
      : undefined,
    footerLines: [
      "Generated by PropertyOS from the organisation's payment records.",
      ...(receipt.status === "VOIDED" ? ["This receipt has been voided and is retained for audit purposes only."] : []),
    ],
  });
  return storeGeneratedDocument({
    organisationId,
    documentType: "RECEIPT",
    sourceType: "RECEIPT",
    sourceId: receipt.id,
    snapshot,
    bytes,
    fileName: `receipt-${receipt.receiptNumber}.pdf`,
    generatedByUserId: userId,
    leaseId: receipt.leaseId,
    tenantOrganisationId: receipt.tenantOrganisationId,
    propertyId: receipt.propertyId,
  });
}

export async function generateTenantStatementPdf(userId: string, organisationId: string, leaseId: string, input: { asOfDate?: Date } = {}) {
  const internal = await hasPermission(userId, organisationId, PERMISSIONS.paymentRead);
  const tenantParty = internal ? null : await isLeaseTenant(userId, organisationId, leaseId);
  if (!internal && !tenantParty) throw forbidden();
  const lease = await db.lease.findFirst({ where: { id: leaseId, organisationId }, include: { property: true, unit: true } });
  if (!lease) throw notFound();
  const asOfDate = input.asOfDate ?? new Date();
  const obligations = await db.rentObligation.findMany({ where: { leaseId, organisationId, dueDate: { lte: asOfDate } }, orderBy: { dueDate: "asc" } });
  const payments = await db.payment.findMany({ where: { leaseId, organisationId, status: "SUCCEEDED", paidAt: { lte: asOfDate } }, orderBy: { paidAt: "asc" } });
  const totalCharged = obligations.reduce((sum, item) => sum.plus(item.amountMinor), new Prisma.Decimal(0));
  const totalCollected = obligations.reduce((sum, item) => sum.plus(item.collectedAmountMinor), new Prisma.Decimal(0));
  const organisation = await db.organisation.findUniqueOrThrow({ where: { id: organisationId } });
  const snapshot = {
    asOfDate: asOfDate.toISOString(),
    obligations: obligations.map((item) => ({ dueDate: item.dueDate.toISOString(), amountMinor: item.amountMinor.toString(), collectedAmountMinor: item.collectedAmountMinor.toString(), status: item.status, collectionState: item.collectionState })),
    payments: payments.map((item) => ({ paidAt: item.paidAt.toISOString(), amountMinor: item.amountMinor.toString(), method: item.method })),
  };
  const bytes = await renderSimpleDocument({
    title: "Tenant rent statement",
    subtitle: organisation.name,
    referenceNumber: lease.referenceNumber,
    issuedLabel: `Statement as of ${dateOnly(asOfDate)}`,
    sections: [{
      rows: [
        { label: "Lease", value: lease.referenceNumber },
        { label: "Property", value: lease.unit ? `${lease.property.name} / ${lease.unit.name}` : lease.property.name },
        { label: "Total charged", value: money(totalCharged, lease.currencyCode) },
        { label: "Total collected", value: money(totalCollected, lease.currencyCode) },
        { label: "Outstanding balance", value: money(totalCharged.minus(totalCollected), lease.currencyCode) },
      ],
    }],
    table: {
      headers: ["Rent period due", "Charged", "Collected", "State"],
      columnWidths: [140, 130, 130, 130],
      rows: obligations.map((item) => [dateOnly(item.dueDate), money(item.amountMinor, lease.currencyCode), money(item.collectedAmountMinor, lease.currencyCode), item.collectionState]),
    },
    footerLines: ["Generated by PropertyOS from the lease's rent obligation and payment ledger."],
  });
  return storeGeneratedDocument({
    organisationId,
    documentType: "TENANT_STATEMENT",
    sourceType: "LEASE",
    sourceId: leaseId,
    snapshot,
    bytes,
    fileName: `tenant-statement-${lease.referenceNumber}.pdf`,
    generatedByUserId: userId,
    leaseId,
    propertyId: lease.propertyId,
  });
}

export async function generateMoveOutStatementPdf(userId: string, organisationId: string, leaseId: string) {
  const statement = await getFinalTenantStatement(userId, organisationId, leaseId);
  const organisation = await db.organisation.findUniqueOrThrow({ where: { id: organisationId } });
  const snapshot = {
    currencyCode: statement.currencyCode,
    outstandingRentMinor: statement.outstandingRentMinor,
    depositReceivedMinor: statement.depositReceivedMinor,
    approvedDeductionMinor: statement.approvedDeductionMinor,
    refundAmountMinor: statement.refundAmountMinor,
    refundedAmountMinor: statement.refundedAmountMinor,
    status: statement.status,
    deductions: statement.deductions.map((deduction) => ({ category: deduction.category, amountMinor: deduction.amountMinor.toString(), status: deduction.status })),
  };
  const tenantName = statement.tenant.preferredName || statement.tenant.legalName;
  const bytes = await renderSimpleDocument({
    title: "Final move-out statement",
    subtitle: organisation.name,
    referenceNumber: statement.lease.referenceNumber,
    issuedLabel: `Move-out ${statement.moveOutDate ? dateOnly(statement.moveOutDate) : "date pending"}`,
    sections: [{
      rows: [
        { label: "Tenant", value: tenantName },
        { label: "Lease", value: statement.lease.referenceNumber },
        { label: "Property", value: statement.unit ? `${statement.property.name} / ${statement.unit.name}` : statement.property.name },
        { label: "Deposit received", value: money(statement.depositReceivedMinor, statement.currencyCode) },
        { label: "Outstanding rent", value: money(statement.outstandingRentMinor, statement.currencyCode) },
        { label: "Approved deductions", value: money(statement.approvedDeductionMinor, statement.currencyCode) },
        { label: "Refund due", value: money(statement.refundAmountMinor, statement.currencyCode) },
        { label: "Refunded so far", value: money(statement.refundedAmountMinor, statement.currencyCode) },
        { label: "Settlement status", value: statement.status },
      ],
    }],
    table: statement.deductions.length
      ? {
        headers: ["Deduction category", "Amount", "Status"],
        columnWidths: [220, 180, 150],
        rows: statement.deductions.map((deduction) => [deduction.category, money(deduction.amountMinor, statement.currencyCode), deduction.status]),
      }
      : undefined,
    footerLines: ["Generated by PropertyOS from the lease's deposit settlement records."],
  });
  return storeGeneratedDocument({
    organisationId,
    documentType: "MOVE_OUT_STATEMENT",
    sourceType: "DEPOSIT_SETTLEMENT",
    sourceId: statement.settlementId,
    snapshot,
    bytes,
    fileName: `move-out-statement-${statement.lease.referenceNumber}.pdf`,
    generatedByUserId: userId,
    leaseId,
    tenantOrganisationId: statement.tenantOrganisationId,
    propertyId: statement.property.id,
  });
}

/**
 * Generates the lease agreement PDF from real lease/party/property data plus (if configured) the
 * organisation's own legal template — PropertyOS never invents legal clauses. While the lease is
 * still DRAFT, this also registers a new Phase 11 `LeaseExecutionDocument` version (source
 * GENERATED), reusing that model's existing locking/versioning rules unchanged. Once a lease is no
 * longer DRAFT, execution documents are immutable (Phase 11), so this instead returns/creates a
 * standalone `GeneratedDocument` snapshot of the current record for download purposes only.
 */
export async function generateLeaseAgreementPdf(userId: string, organisationId: string, leaseId: string) {
  const internal = await hasPermission(userId, organisationId, PERMISSIONS.leaseExecutionRead) || await hasPermission(userId, organisationId, PERMISSIONS.leaseRead);
  const tenantParty = internal ? null : await isLeaseTenant(userId, organisationId, leaseId);
  if (!internal && !tenantParty) throw forbidden();
  const lease = await db.lease.findFirst({
    where: { id: leaseId, organisationId, archivedAt: null },
    include: { property: true, unit: true, parties: { include: { tenantOrganisation: { include: { tenant: true } } } } },
  });
  if (!lease) throw notFound();
  const organisation = await db.organisation.findUniqueOrThrow({ where: { id: organisationId } });
  const template = await getActiveDocumentTemplate(organisationId, "LEASE_AGREEMENT");
  const tenantNames = lease.parties.map((party) => party.tenantOrganisation.tenant.preferredName || party.tenantOrganisation.tenant.legalName).join(", ") || "Unassigned";
  const placeholders = {
    organisation_name: organisation.name,
    lease_reference: lease.referenceNumber,
    property_name: lease.property.name,
    unit_name: lease.unit?.name ?? "",
    tenant_names: tenantNames,
    start_date: dateOnly(lease.startDate),
    end_date: lease.endDate ? dateOnly(lease.endDate) : "Open-ended",
    rent_amount: money(lease.rentAmountMinor, lease.currencyCode),
    rent_frequency: lease.rentFrequency,
    deposit_amount: lease.depositAmountMinor ? money(lease.depositAmountMinor, lease.currencyCode) : "None",
  };
  const templateConfigured = Boolean(template);
  const bodyParagraphs = template
    ? fillTemplate(template.bodyTemplate, placeholders).split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
    : [
      `This document is a factual summary of lease ${lease.referenceNumber}. ${organisation.name} has not configured a legal lease template for this organisation, so no legal clauses are included — configure one to generate a full agreement.`,
    ];
  const snapshot = {
    templateId: template?.id ?? null,
    templateUpdatedAt: template?.updatedAt.toISOString() ?? null,
    placeholders,
    leaseStatus: lease.status,
  };
  const bytes = await renderSimpleDocument({
    title: "Lease agreement",
    subtitle: organisation.name,
    referenceNumber: lease.referenceNumber,
    issuedLabel: `Generated ${dateOnly(new Date())}${templateConfigured ? "" : " (no organisation template configured)"}`,
    sections: [{
      rows: [
        { label: "Tenant(s)", value: tenantNames },
        { label: "Property", value: lease.unit ? `${lease.property.name} / ${lease.unit.name}` : lease.property.name },
        { label: "Term", value: `${placeholders.start_date} to ${placeholders.end_date}` },
        { label: "Rent", value: `${placeholders.rent_amount} (${lease.rentFrequency})` },
        { label: "Deposit", value: placeholders.deposit_amount },
      ],
    }],
    paragraphs: bodyParagraphs,
    footerLines: [
      templateConfigured
        ? "Rendered from the organisation's configured lease template with real lease data."
        : "No organisation-specific legal template is configured; this is a factual summary only, not a legal contract.",
    ],
  });
  const fileName = `lease-agreement-${lease.referenceNumber}.pdf`;

  if (lease.status === "DRAFT") {
    // A DRAFT lease has no finalised agreement yet: only internal staff (never a mere tenant
    // party) may create or supersede its generated agreement/execution-document version. This
    // guard must run *before* `storeGeneratedDocument` — that call has real side effects (writes
    // a new `StorageObject`/`GeneratedDocument`, supersedes the previous version, and emits
    // audit/domain events) even when it is later found the caller isn't allowed to be here, so
    // checking authorization first ensures a denied tenant never creates/supersedes anything.
    if (!internal) throw forbidden();
    const created = await storeGeneratedDocument({
      organisationId, documentType: "LEASE_AGREEMENT", sourceType: "LEASE", sourceId: leaseId,
      snapshot, bytes, fileName, generatedByUserId: userId, leaseId, propertyId: lease.propertyId,
    });
    const existingVersion = await db.leaseExecutionDocument.findFirst({ where: { leaseId, fileKey: created.storageObject.storageKey } });
    if (existingVersion) return { generatedDocument: created, executionDocument: existingVersion };
    try {
      const executionDocument = await createLeaseDocumentVersion(userId, organisationId, leaseId, {
        source: "GENERATED",
        fileKey: created.storageObject.storageKey,
        fileName,
        contentType: "application/pdf",
        sizeBytes: created.storageObject.sizeBytes,
      });
      return { generatedDocument: created, executionDocument };
    } catch (error) {
      if (error instanceof AppError && (error.code === "LEASE_DOCUMENT_LOCKED" || error.code === "EXECUTED_DOCUMENT_IMMUTABLE")) {
        return { generatedDocument: created, executionDocument: null };
      }
      throw error;
    }
  }

  const created = await storeGeneratedDocument({
    organisationId, documentType: "LEASE_AGREEMENT", sourceType: "LEASE", sourceId: leaseId,
    snapshot, bytes, fileName, generatedByUserId: userId, leaseId, propertyId: lease.propertyId,
  });
  return { generatedDocument: created, executionDocument: null };
}
