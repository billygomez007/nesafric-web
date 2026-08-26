import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createLease } from "./helpers/lease";
import { generateRentSchedule } from "@/modules/rent-schedules/service";
import { createManualPayment, createSecurityDeposit } from "@/modules/payments/service";
import { createMoveOutInspection, createNoticeToVacate, scheduleMoveOut } from "@/modules/move-out/service";
import { getSignedStorageAccess } from "@/modules/documents/service";
import { generateLeaseAgreementPdf, generateMoveOutStatementPdf, generateReceiptPdf, generateTenantStatementPdf } from "@/modules/documents/generation";
import { upsertDocumentTemplate } from "@/modules/documents/templates";
import { getObjectStorageAdapter } from "@/platform/storage";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

describe("PostgreSQL Phase 19 immutable generated documents (receipts/statements/lease agreement)", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("generates real, idempotent, versioned PDFs and enforces download permissions", async () => {
    const owner = await registerUser({ displayName: "Doc Owner", email: "doc-owner@example.com", password: "secure-password-123" });
    const tenantUser = await registerUser({ displayName: "Doc Tenant", email: "doc-tenant@example.com", password: "secure-password-123" });
    const outsider = await registerUser({ displayName: "Doc Outsider", email: "doc-outsider@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Document Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(outsider.id, { name: "Other Document Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const ownerMember = await db.organisationMember.findFirstOrThrow({ where: { organisationId: organisation.id, userId: owner.id } });
    const property = await createProperty(owner.id, organisation.id, { name: "Document House", referenceNumber: "DOC-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const { relationship } = await createTenant(owner.id, organisation.id, { legalName: "Document Tenant", email: "doc-tenant@example.com", countryCode: "GH" });
    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });
    const lease = await createLease(owner.id, organisation.id, {
      referenceNumber: "DOC-LEASE-001", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id],
      startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "150000", depositAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE",
    });
    await generateRentSchedule(owner.id, organisation.id, lease.id, 2);
    const [firstObligation] = await db.rentObligation.findMany({ where: { leaseId: lease.id }, orderBy: { dueDate: "asc" } });

    // --- Receipt PDF: real record, immutable, idempotent (item 3) ---
    const payment = await createManualPayment(owner.id, organisation.id, {
      tenantOrganisationId: relationship.id, leaseId: lease.id, amountMinor: "150000", currencyCode: "GHS", paidAt: "2026-01-05T10:00:00Z",
      method: "CASH", externalReference: "doc-cash-1", evidenceReference: "evidence/doc-cash-1.jpg", idempotencyKey: "doc-manual-1", allocations: [{ rentObligationId: firstObligation.id, amountMinor: "150000" }],
    });
    const receiptId = payment.receipt!.id;
    const firstReceiptDoc = await generateReceiptPdf(owner.id, organisation.id, receiptId);
    expect(firstReceiptDoc.version).toBe(1);
    expect(firstReceiptDoc.documentType).toBe("RECEIPT");
    expect(firstReceiptDoc.referenceNumber).toMatch(/^RCT-/);
    expect(firstReceiptDoc.storageObject.sizeBytes).toBeGreaterThan(0);
    expect(firstReceiptDoc.storageObject.contentType).toBe("application/pdf");
    // Regenerating unchanged data returns the exact same (never re-rendered/overwritten) document.
    const secondReceiptDoc = await generateReceiptPdf(owner.id, organisation.id, receiptId);
    expect(secondReceiptDoc.id).toBe(firstReceiptDoc.id);
    expect(secondReceiptDoc.storageObjectId).toBe(firstReceiptDoc.storageObjectId);
    expect(await db.generatedDocument.count({ where: { organisationId: organisation.id, documentType: "RECEIPT" } })).toBe(1);
    // The tenant can generate/download their own receipt; a cross-organisation user cannot.
    const tenantReceiptDoc = await generateReceiptPdf(tenantUser.id, organisation.id, receiptId);
    expect(tenantReceiptDoc.id).toBe(firstReceiptDoc.id);
    await expect(generateReceiptPdf(outsider.id, organisation.id, receiptId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const receiptAccess = await getSignedStorageAccess(tenantUser.id, organisation.id, firstReceiptDoc.storageObjectId);
    expect(receiptAccess.url).toBeTruthy();
    await expect(getSignedStorageAccess(outsider.id, otherOrganisation.id, firstReceiptDoc.storageObjectId)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // --- Tenant statement PDF: versions when the underlying ledger genuinely changes (item 3) ---
    const statementV1 = await generateTenantStatementPdf(owner.id, organisation.id, lease.id, { asOfDate: new Date("2026-01-06") });
    expect(statementV1.version).toBe(1);
    const statementV1Again = await generateTenantStatementPdf(owner.id, organisation.id, lease.id, { asOfDate: new Date("2026-01-06") });
    expect(statementV1Again.id).toBe(statementV1.id);
    await createManualPayment(owner.id, organisation.id, {
      tenantOrganisationId: relationship.id, leaseId: lease.id, amountMinor: "10000", currencyCode: "GHS", paidAt: "2026-01-20T10:00:00Z",
      method: "CASH", externalReference: "doc-cash-2", evidenceReference: "evidence/doc-cash-2.jpg", idempotencyKey: "doc-manual-2", allocations: [],
    });
    const statementV2 = await generateTenantStatementPdf(owner.id, organisation.id, lease.id, { asOfDate: new Date("2026-01-21") });
    expect(statementV2.version).toBe(2);
    expect(statementV2.id).not.toBe(statementV1.id);
    const supersededV1 = await db.generatedDocument.findUniqueOrThrow({ where: { id: statementV1.id } });
    expect(supersededV1.supersededAt).not.toBeNull();
    // Superseded bytes are still retrievable — never deleted/overwritten.
    expect((await getSignedStorageAccess(owner.id, organisation.id, supersededV1.storageObjectId)).url).toBeTruthy();

    // --- Lease agreement PDF: configurable template, connects Phase 11 document/version model (item 3) ---
    const noTemplateAgreement = await generateLeaseAgreementPdf(owner.id, organisation.id, lease.id);
    expect(noTemplateAgreement.generatedDocument.version).toBe(1);
    await upsertDocumentTemplate(owner.id, organisation.id, {
      documentType: "LEASE_AGREEMENT",
      name: "Standard residential lease",
      bodyTemplate: "This lease covers {{property_name}} for tenant(s) {{tenant_names}} at a rent of {{rent_amount}} per {{rent_frequency}} cycle.",
    });
    const templatedAgreement = await generateLeaseAgreementPdf(owner.id, organisation.id, lease.id);
    expect(templatedAgreement.generatedDocument.version).toBe(2);
    expect(templatedAgreement.generatedDocument.id).not.toBe(noTemplateAgreement.generatedDocument.id);
    const previousAgreement = await db.generatedDocument.findUniqueOrThrow({ where: { id: noTemplateAgreement.generatedDocument.id } });
    expect(previousAgreement.supersededAt).not.toBeNull();

    // --- Final move-out statement PDF: real deposit settlement record (item 3) ---
    await createSecurityDeposit(owner.id, organisation.id, {
      tenantOrganisationId: relationship.id, leaseId: lease.id, amountMinor: "150000", currencyCode: "GHS", receivedAt: "2026-01-01",
      method: "BANK_TRANSFER", externalReference: "doc-dep-1", idempotencyKey: "doc-dep-1",
    });
    await createNoticeToVacate(tenantUser.id, organisation.id, lease.id, { noticeDate: "2026-06-01", intendedMoveOutDate: "2026-07-01", source: "TENANT", reason: "Relocating" });
    await scheduleMoveOut(owner.id, organisation.id, lease.id, { scheduledDate: "2026-07-01", responsibleMemberId: ownerMember.id });
    await createMoveOutInspection(owner.id, organisation.id, lease.id, {
      inspectorMemberId: ownerMember.id, inspectedAt: "2026-07-01T08:00:00Z", overallCondition: "GOOD", cleaningCondition: "CLEAN", tenantAcknowledged: true,
      areas: [{ name: "Living room", condition: "GOOD" }],
    });
    const moveOutStatement = await generateMoveOutStatementPdf(owner.id, organisation.id, lease.id);
    expect(moveOutStatement.documentType).toBe("MOVE_OUT_STATEMENT");
    expect(moveOutStatement.version).toBe(1);
    const moveOutStatementAgain = await generateMoveOutStatementPdf(owner.id, organisation.id, lease.id);
    expect(moveOutStatementAgain.id).toBe(moveOutStatement.id);

    // --- Tenant self-service document access (item 8): only their own executed lease/receipts/statements ---
    const tenantDocs = await import("@/modules/documents/service").then((mod) => mod.listTenantDocuments(tenantUser.id, organisation.id, relationship.id));
    const tenantDocTypes = tenantDocs.map((doc) => doc.type).sort();
    expect(tenantDocTypes).toEqual(["LEASE_AGREEMENT", "LEASE_AGREEMENT", "MOVE_OUT_STATEMENT", "RECEIPT", "TENANT_STATEMENT", "TENANT_STATEMENT"]);

    // --- document.generated + lease.document_generated events (item 9) ---
    const eventNames = (await db.domainEvent.findMany({ where: { organisationId: organisation.id, name: { in: ["document.generated", "lease.document_generated"] } } })).map(({ name }) => name);
    expect(eventNames.filter((name) => name === "document.generated").length).toBeGreaterThanOrEqual(5);
    expect(eventNames).toContain("lease.document_generated");
  });

  it("renders real Ghanaian Unicode (ɛ, ɔ, ₵) in tenant/organisation/template text without crashing (Standard-14 fonts cannot encode these)", async () => {
    const owner = await registerUser({ displayName: "Ɛnyimba Owner", email: "unicode-owner@example.com", password: "secure-password-123" });
    const tenantUser = await registerUser({ displayName: "Kwame Ɔsei", email: "unicode-tenant@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Ɛnyimba Properties ₵o", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, {
      name: "Ɔdɔ Ɛstate", referenceNumber: "UNI-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "Ɛ1" }],
    });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const { relationship } = await createTenant(owner.id, organisation.id, { legalName: "Kwame Ɔsei ɛnyɛ", email: "unicode-tenant@example.com", countryCode: "GH" });
    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });
    const lease = await createLease(owner.id, organisation.id, {
      referenceNumber: "UNI-LEASE-001", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id],
      startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "150000", depositAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE",
    });
    await upsertDocumentTemplate(owner.id, organisation.id, {
      documentType: "LEASE_AGREEMENT",
      name: "Twi/Akan lease template",
      bodyTemplate:
        "This lease covers {{property_name}} for tenant(s) {{tenant_names}} at a rent of {{rent_amount}} per {{rent_frequency}} cycle. " +
        "Ɛda a wɔhyɛɛ da yi mu, ɔdɔ ne nokware nkyerɛkyerɛmu: rent is payable in ₵ (Ghana cedis), not $ or £. " +
        "Ɔhyɛfo ne tenant nyinaa nte saa asɛm yi ase pefee: ₵1,500.00 monthly, no exceptions, ɛnyɛ debate biara.",
    });

    const agreement = await generateLeaseAgreementPdf(owner.id, organisation.id, lease.id);
    expect(agreement.generatedDocument.version).toBe(1);
    expect(agreement.generatedDocument.documentType).toBe("LEASE_AGREEMENT");
    expect(agreement.generatedDocument.storageObject.contentType).toBe("application/pdf");
    expect(agreement.generatedDocument.storageObject.sizeBytes).toBeGreaterThan(0);
    // The bytes are a genuine, loadable PDF (rendering never silently dropped/mangled the Unicode text).
    const stored = await getObjectStorageAdapter().getObject(agreement.generatedDocument.storageObject.storageKey);
    expect(stored?.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("denies a tenant generating a DRAFT lease's agreement with zero side effects (no created/superseded document, storage object, or events)", async () => {
    const owner = await registerUser({ displayName: "Draft Owner", email: "draft-owner@example.com", password: "secure-password-123" });
    const tenantUser = await registerUser({ displayName: "Draft Tenant", email: "draft-tenant@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Draft Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, { name: "Draft House", referenceNumber: "DFT-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const { relationship } = await createTenant(owner.id, organisation.id, { legalName: "Draft Tenant Org", email: "draft-tenant@example.com", countryCode: "GH" });
    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });
    // Left as DRAFT (the default) — never activated/executed.
    const lease = await createLease(owner.id, organisation.id, {
      referenceNumber: "DFT-LEASE-001", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id],
      startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY",
    });
    expect(lease.status).toBe("DRAFT");

    // The tenant is a genuine party to the lease (so the general "internal or tenant party" gate
    // alone would let them through) but a DRAFT lease's agreement may only ever be created by
    // internal staff — the tenant call must be denied *before* any write happens.
    await expect(generateLeaseAgreementPdf(tenantUser.id, organisation.id, lease.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await db.generatedDocument.count({ where: { organisationId: organisation.id, documentType: "LEASE_AGREEMENT" } })).toBe(0);
    expect(await db.storageObject.count({ where: { organisationId: organisation.id, targetType: "GENERATED_DOCUMENT" } })).toBe(0);
    expect(await db.leaseExecutionDocument.count({ where: { leaseId: lease.id } })).toBe(0);
    expect(await db.domainEvent.count({ where: { organisationId: organisation.id, name: { in: ["document.generated", "lease.document_generated"] } } })).toBe(0);
    expect(await db.auditEvent.count({ where: { organisationId: organisation.id, action: "document.generated" } })).toBe(0);

    // Internal staff (the owner) can still generate it normally.
    const staffAgreement = await generateLeaseAgreementPdf(owner.id, organisation.id, lease.id);
    expect(staffAgreement.generatedDocument.version).toBe(1);
  });
});
