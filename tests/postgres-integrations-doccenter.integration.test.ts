import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createListing, createMarketplaceLead, transitionListing, updateListingVerification } from "@/modules/listings/service";
import { createApplicant, createRentalApplication } from "@/modules/applications/service";
import { createMaintenanceRequest } from "@/modules/maintenance/service";
import { createServiceProvider } from "@/modules/providers/service";
import { getOrganisationIntegrationOverview, upsertIntegrationConfig } from "@/modules/integrations/service";
import { listDocumentCenter, uploadOrganisationDocument, uploadProviderEvidenceDocument } from "@/modules/documents/service";
import { upsertChannelConfig } from "@/modules/conversations/service";

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]);
const PDF_BYTES = Buffer.from("%PDF-1.4\n%mock-id-scan\n");
const base64 = (buffer: Buffer) => buffer.toString("base64");

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

async function addMember(organisationId: string, userId: string, roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const member = await db.organisationMember.create({ data: { organisationId, userId } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
  return member;
}

async function publishListing(userId: string, organisationId: string, listingId: string) {
  await updateListingVerification(userId, organisationId, listingId, {
    status: "PENDING", evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/evidence/deed.pdf" }],
  });
  await updateListingVerification(userId, organisationId, listingId, { status: "VERIFIED" });
  await transitionListing(userId, organisationId, listingId, { status: "PENDING_REVIEW" });
  return transitionListing(userId, organisationId, listingId, { status: "PUBLISHED" });
}

describe("PostgreSQL Phase 19 integration health, Document Center, and RBAC", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("reports non-secret integration health, browses the Document Center across domains with RBAC, and never leaks internal docs to tenants", async () => {
    const owner = await registerUser({ displayName: "Ops Owner", email: "ops-owner@example.com", password: "secure-password-123" });
    const viewer = await registerUser({ displayName: "Ops Viewer", email: "ops-viewer@example.com", password: "secure-password-123" });
    const tenantUser = await registerUser({ displayName: "Ops Tenant", email: "ops-tenant@example.com", password: "secure-password-123" });
    const individualProvider = await registerUser({ displayName: "Individual Provider", email: "ops-provider@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Ops Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await addMember(organisation.id, viewer.id, "viewer");

    // --- Integration configuration/health framework (item 7), no secrets ever exposed ---
    const overviewBefore = await getOrganisationIntegrationOverview(owner.id, organisation.id);
    const storageEntry = overviewBefore.find((entry) => entry.type === "STORAGE")!;
    // No S3-compatible credentials are configured in this test run: health honestly reports
    // NOT_CONFIGURED (a production-readiness signal) even though the local/in-memory fallback is
    // fully functional for uploads/downloads, as the storage test suite already demonstrates.
    expect(storageEntry.status).toBe("NOT_CONFIGURED");
    expect(storageEntry.provider).toBe("in-memory");
    expect(JSON.stringify(overviewBefore)).not.toMatch(/secret|apiKey|token|password/i);
    const esignatureEntry = overviewBefore.find((entry) => entry.type === "ESIGNATURE")!;
    expect(esignatureEntry.provider).toBe("INTERNAL"); // no external e-signature credentials configured in this test run

    await upsertChannelConfig(owner.id, organisation.id, "EMAIL", { enabled: true, providerKey: "test-smtp" });
    const overviewAfterChannel = await getOrganisationIntegrationOverview(owner.id, organisation.id);
    expect(overviewAfterChannel.find((entry) => entry.type === "COMMUNICATION_EMAIL")).toMatchObject({ enabled: true, status: "CONNECTED" });

    const updatedConfig = await upsertIntegrationConfig(owner.id, organisation.id, { integrationType: "CALENDAR", enabled: false, metadata: { note: "disabled for now" } });
    expect(updatedConfig.enabled).toBe(false);
    const overviewAfterDisable = await getOrganisationIntegrationOverview(owner.id, organisation.id);
    expect(overviewAfterDisable.find((entry) => entry.type === "CALENDAR")).toMatchObject({ enabled: false });
    await expect(getOrganisationIntegrationOverview(viewer.id, organisation.id)).resolves.toBeTruthy(); // viewer has integration.read
    await expect(upsertIntegrationConfig(viewer.id, organisation.id, { integrationType: "CALENDAR", enabled: true })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // --- Document Center across domains (item 8), with real permission checks per filter ---
    const property = await createProperty(owner.id, organisation.id, { name: "Ops House", referenceNumber: "OPS-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [] });
    const { relationship } = await createTenant(owner.id, organisation.id, { legalName: "Ops Tenant", email: "ops-tenant@example.com", countryCode: "GH" });
    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });

    const maintenanceRequest = await createMaintenanceRequest(owner.id, organisation.id, {
      propertyId: property.id, title: "Broken window", description: "The living room window latch is broken.", category: "carpentry",
    });
    const maintenanceUpload = await uploadOrganisationDocument(owner.id, organisation.id, {
      targetType: "MAINTENANCE_ATTACHMENT", targetId: maintenanceRequest.id, fileName: "window.jpg", contentType: "image/jpeg", dataBase64: base64(JPEG_BYTES),
    });

    // Regression: a successful local/in-memory upload writes a real `IntegrationConfig` history
    // row (`status: "CONNECTED"`, a real `lastSuccessAt`) for observability, but that must never
    // be surfaced as the organisation having production object storage. The overview must keep
    // reporting NOT_CONFIGURED (production readiness is real S3 configuration) while still
    // preserving the recorded operation history.
    const overviewAfterUpload = await getOrganisationIntegrationOverview(owner.id, organisation.id);
    const storageEntryAfterUpload = overviewAfterUpload.find((entry) => entry.type === "STORAGE")!;
    expect(storageEntryAfterUpload.status).toBe("NOT_CONFIGURED");
    expect(storageEntryAfterUpload.lastSuccessAt).not.toBeNull();
    expect((await db.integrationConfig.findUniqueOrThrow({ where: { organisationId_integrationType: { organisationId: organisation.id, integrationType: "STORAGE" } } })).status).toBe("CONNECTED");

    const listing = await createListing(owner.id, organisation.id, {
      propertyId: property.id, listingType: "RENT", category: "apartment", title: "Ops listing",
      publicDescription: "A listing used to validate the application document upload pipeline end to end.",
      rentAmountMinor: "200000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH",
      media: [{ type: "PHOTO", publicUrl: "https://cdn.example.test/ops-listing.jpg" }],
    });
    await publishListing(owner.id, organisation.id, listing.id);
    const lead = await createMarketplaceLead(listing.id, undefined, { name: "Applicant Lead", email: "applicant-lead@example.com" });
    const applicant = await createApplicant(owner.id, organisation.id, { legalName: "Ops Applicant", email: "ops-applicant@example.com" });
    const application = await createRentalApplication(owner.id, organisation.id, { listingId: listing.id, leadId: lead.id, applicantId: applicant.id });
    const applicationUpload = await uploadOrganisationDocument(owner.id, organisation.id, {
      targetType: "APPLICATION_DOCUMENT", targetId: application.id, documentType: "ID", fileName: "id-scan.pdf", contentType: "application/pdf", dataBase64: base64(PDF_BYTES),
    });
    expect((await db.rentalApplicationDocument.findUniqueOrThrow({ where: { id: applicationUpload.attached.id } })).type).toBe("ID");

    // Provider verification evidence (item 2): individually-owned providers have no organisation, yet the upload still works and is discoverable by a landlord org through its directory relationship.
    const provider = await createServiceProvider(individualProvider.id, { type: "INDIVIDUAL", displayName: "Ops Handyman", contactEmail: "ops-handyman@example.com" });
    const evidenceUpload = await uploadProviderEvidenceDocument(individualProvider.id, provider.id, {
      evidenceType: "IDENTITY", fileName: "national-id.pdf", contentType: "application/pdf", dataBase64: base64(PDF_BYTES),
    });
    expect(evidenceUpload.storageObject.organisationId).toBeNull();
    expect((await db.providerEvidence.findUniqueOrThrow({ where: { id: evidenceUpload.attached.id } })).reference).toBe(evidenceUpload.storageObject.storageKey);
    await expect(uploadProviderEvidenceDocument(owner.id, provider.id, {
      evidenceType: "IDENTITY", fileName: "not-mine.pdf", contentType: "application/pdf", dataBase64: base64(PDF_BYTES),
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Document Center: staff can filter precisely by domain-specific scope.
    const byMaintenance = await listDocumentCenter(owner.id, organisation.id, { maintenanceRequestId: maintenanceRequest.id });
    expect(byMaintenance.items.map((item) => item.id)).toEqual([maintenanceUpload.storageObject.id]);
    const byApplication = await listDocumentCenter(owner.id, organisation.id, { applicationId: application.id });
    expect(byApplication.items.map((item) => item.id)).toEqual([applicationUpload.storageObject.id]);
    const byProperty = await listDocumentCenter(owner.id, organisation.id, { propertyId: property.id, type: "MAINTENANCE_ATTACHMENT" });
    expect(byProperty.items.map((item) => item.id)).toEqual([maintenanceUpload.storageObject.id]);
    const byTenant = await listDocumentCenter(owner.id, organisation.id, { tenantOrganisationId: relationship.id });
    expect(byTenant.items.length).toBe(0); // this maintenance request has no tenant link in this fixture
    // A viewer (read-only role) can browse the Document Center too.
    await expect(listDocumentCenter(viewer.id, organisation.id, {})).resolves.toBeTruthy();
    // A tenant with no staff permission cannot reach the staff-only Document Center at all.
    await expect(listDocumentCenter(tenantUser.id, organisation.id, {})).rejects.toMatchObject({ code: "FORBIDDEN" });

    // document.uploaded events fired for every organisation-scoped upload (item 9). The individually-owned
    // provider's evidence upload has no organisation to scope an event to, so it does not emit one here.
    const uploadEvents = await db.domainEvent.findMany({ where: { organisationId: organisation.id, name: "document.uploaded" } });
    expect(uploadEvents.length).toBe(2);
  });
});
