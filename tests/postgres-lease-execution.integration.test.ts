import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createLease } from "@/modules/leases/service";
import { createSecurityDeposit } from "@/modules/payments/service";
import {
  actOnLeaseSignature,
  activateExecutedLease,
  completeMoveIn,
  createLeaseDocumentVersion,
  createMoveInInspection,
  getActivationReadiness,
  getLeaseExecution,
  getTenantOnboarding,
  issueMoveInKeys,
  requestLeaseSignatures,
  scheduleMoveIn,
} from "@/modules/lease-execution/service";

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

describe("PostgreSQL Phase 11 lease execution and move-in", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("preserves documents, validates multiple signers and activation, and records permanent move-in history", async () => {
    const owner = await registerUser({ displayName: "Execution Owner", email: "execution-owner@example.com", password: "secure-password-123" });
    const tenantUser = await registerUser({ displayName: "Signing Tenant", email: "signing-tenant@example.com", password: "secure-password-123" });
    const viewer = await registerUser({ displayName: "Execution Viewer", email: "execution-viewer@example.com", password: "secure-password-123" });
    const outsider = await registerUser({ displayName: "Other Owner", email: "execution-other@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Execution Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(outsider.id, { name: "Other Execution Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const ownerMember = await db.organisationMember.findFirstOrThrow({ where: { organisationId: organisation.id, userId: owner.id } });
    await addMember(organisation.id, viewer.id, "viewer");
    const property = await createProperty(owner.id, organisation.id, {
      name: "Execution House",
      referenceNumber: "EXEC-001",
      category: "Residential",
      countryCode: "GH",
      currencyCode: "GHS",
      units: [{ name: "A1" }],
    });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const { relationship } = await createTenant(owner.id, organisation.id, {
      legalName: "Signing Tenant",
      email: "signing-tenant@example.com",
      phone: "+233200000001",
      countryCode: "GH",
    });
    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });
    await expect(createLease(owner.id, organisation.id, {
      referenceNumber: "EXEC-LEASE-BYPASS",
      propertyId: property.id,
      unitId: unit.id,
      tenantOrganisationIds: [relationship.id],
      startDate: "2026-08-01",
      rentAmountMinor: "250000",
      currencyCode: "GHS",
      rentFrequency: "MONTHLY",
      status: "ACTIVE",
    })).rejects.toMatchObject({ code: "LEASE_EXECUTION_REQUIRED" });
    const lease = await createLease(owner.id, organisation.id, {
      referenceNumber: "EXEC-LEASE-001",
      propertyId: property.id,
      unitId: unit.id,
      tenantOrganisationIds: [relationship.id],
      startDate: "2026-08-01",
      endDate: "2027-07-31",
      rentAmountMinor: "250000",
      currencyCode: "GHS",
      rentFrequency: "MONTHLY",
      depositAmountMinor: "500000",
      status: "DRAFT",
      documents: [],
    });
    const party = await db.leaseParty.findFirstOrThrow({ where: { leaseId: lease.id } });

    const firstDocument = await createLeaseDocumentVersion(owner.id, organisation.id, lease.id, {
      source: "GENERATED",
      fileKey: "leases/execution/v1.pdf",
      fileName: "lease-v1.pdf",
      contentType: "application/pdf",
    });
    const document = await createLeaseDocumentVersion(owner.id, organisation.id, lease.id, {
      source: "UPLOADED",
      fileKey: "leases/execution/v2.pdf",
      fileName: "lease-v2.pdf",
      contentType: "application/pdf",
    });
    expect(document).toMatchObject({ version: 2, supersedesId: firstDocument.id, status: "READY" });
    expect((await db.leaseExecutionDocument.findUniqueOrThrow({ where: { id: firstDocument.id } })).status).toBe("SUPERSEDED");
    await expect(createLeaseDocumentVersion(viewer.id, organisation.id, lease.id, {
      source: "UPLOADED", fileKey: "denied.pdf", fileName: "denied.pdf",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const signatures = await requestLeaseSignatures(owner.id, organisation.id, lease.id, {
      documentId: document.id,
      signers: [
        { role: "ORG_REPRESENTATIVE", organisationMemberId: ownerMember.id },
        { role: "TENANT", leasePartyId: party.id },
      ],
      activationRequirements: {
        signaturesRequired: true,
        depositRequired: true,
        initialRentRequired: false,
        moveInRequired: true,
        documentRequired: true,
      },
    });
    expect(signatures).toHaveLength(2);
    await expect(createLeaseDocumentVersion(owner.id, organisation.id, lease.id, {
      source: "UPLOADED", fileKey: "leases/execution/v3.pdf", fileName: "lease-v3.pdf",
    })).rejects.toMatchObject({ code: "LEASE_DOCUMENT_LOCKED" });
    await expect(activateExecutedLease(owner.id, organisation.id, lease.id))
      .rejects.toMatchObject({ code: "LEASE_NOT_ACTIVATION_READY" });
    const organisationSignature = signatures.find(({ role }) => role === "ORG_REPRESENTATIVE")!;
    const tenantSignature = signatures.find(({ role }) => role === "TENANT")!;
    await expect(actOnLeaseSignature(tenantUser.id, organisation.id, lease.id, organisationSignature.id, { status: "SIGNED" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(actOnLeaseSignature(owner.id, organisation.id, lease.id, tenantSignature.id, { status: "SIGNED" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await actOnLeaseSignature(owner.id, organisation.id, lease.id, organisationSignature.id, { status: "SIGNED", providerReference: "internal-owner-signature" });
    expect((await db.lease.findUniqueOrThrow({ where: { id: lease.id } })).executionStatus).toBe("PARTIALLY_SIGNED");
    await actOnLeaseSignature(tenantUser.id, organisation.id, lease.id, tenantSignature.id, { status: "VIEWED" });
    await actOnLeaseSignature(tenantUser.id, organisation.id, lease.id, tenantSignature.id, { status: "SIGNED", providerReference: "internal-tenant-signature" });
    expect((await db.lease.findUniqueOrThrow({ where: { id: lease.id } })).executionStatus).toBe("FULLY_SIGNED");
    await expect(db.leaseExecutionDocument.update({ where: { id: document.id }, data: { fileName: "rewritten.pdf" } })).rejects.toBeTruthy();

    const moveIn = await scheduleMoveIn(owner.id, organisation.id, lease.id, {
      scheduledDate: "2026-08-01",
      responsibleMemberId: ownerMember.id,
      notes: "Coordinate handover.",
    });
    const inspection = await createMoveInInspection(owner.id, organisation.id, lease.id, {
      inspectorMemberId: ownerMember.id,
      inspectedAt: "2026-08-01T09:00:00Z",
      overallCondition: "GOOD",
      tenantAcknowledged: true,
      areas: [{
        name: "Living room",
        condition: "GOOD",
        defects: [{ type: "SCUFF", severity: "MINOR" }],
        media: [{ storageKey: "inspections/living-room.jpg", fileName: "living-room.jpg", contentType: "image/jpeg" }],
      }],
      meterReadings: [{ type: "ELECTRICITY", identifier: "ECG-001", value: "125.5", unit: "kWh", readAt: "2026-08-01T09:00:00Z" }],
      inventory: [{ category: "APPLIANCE", item: "Refrigerator", quantity: 1, condition: "GOOD" }],
    });
    expect(inspection).toMatchObject({ tenantAcknowledged: true });
    expect(inspection.meterReadings[0]?.value.toString()).toBe("125.5");
    expect(inspection.inventory[0]).toMatchObject({ item: "Refrigerator", condition: "GOOD" });
    await issueMoveInKeys(owner.id, organisation.id, lease.id, {
      tenantOrganisationId: relationship.id,
      type: "FRONT_DOOR_KEY",
      quantity: 2,
      identifier: "KEY-A1",
      issuedAt: "2026-08-01T10:00:00Z",
    });
    await createSecurityDeposit(owner.id, organisation.id, {
      tenantOrganisationId: relationship.id,
      leaseId: lease.id,
      amountMinor: "500000",
      currencyCode: "GHS",
      receivedAt: "2026-07-30",
      method: "BANK_TRANSFER",
      externalReference: "DEP-EXEC-001",
      idempotencyKey: "dep-exec-001",
    });
    await completeMoveIn(owner.id, organisation.id, lease.id, { actualDate: "2026-08-01", note: "Handover complete." });
    expect(await db.moveInChecklistItem.findFirstOrThrow({ where: { moveInId: moveIn.id, key: "deposit" } })).toMatchObject({ completed: true });
    await expect(scheduleMoveIn(owner.id, organisation.id, lease.id, { scheduledDate: "2026-08-02" }))
      .rejects.toMatchObject({ code: "MOVE_IN_COMPLETED" });

    const readiness = await getActivationReadiness(owner.id, organisation.id, lease.id);
    expect(readiness).toMatchObject({ ready: true, signaturesSatisfied: true, depositSatisfied: true, moveInSatisfied: true, documentSatisfied: true });
    expect(readiness.deposit).toEqual({ requiredMinor: "500000", recordedMinor: "500000" });
    const activated = await activateExecutedLease(owner.id, organisation.id, lease.id);
    expect(activated).toMatchObject({ status: "ACTIVE", executionStatus: "ACTIVE", moveStatus: "MOVED_IN" });
    const onboarding = await getTenantOnboarding(tenantUser.id, organisation.id, lease.id);
    expect(onboarding.requiredActions).toEqual([]);
    expect(JSON.stringify(onboarding)).not.toContain("internal-owner-signature");
    expect(JSON.stringify(onboarding)).not.toContain("leases/execution/v2.pdf");
    expect((await getLeaseExecution(viewer.id, organisation.id, lease.id)).capabilities).toMatchObject({ manage: false, moveInManage: false });
    await expect(getLeaseExecution(outsider.id, otherOrganisation.id, lease.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    for (const eventName of [
      "lease.document_version_created",
      "lease.ready_for_signature",
      "lease.signature_requested",
      "lease.signed",
      "lease.fully_signed",
      "move_in.scheduled",
      "move_in.inspection_completed",
      "move_in.keys_issued",
      "move_in.completed",
      "lease.activation_ready",
      "lease.activated",
    ]) {
      expect(await db.domainEvent.count({ where: { organisationId: organisation.id, name: eventName } }), eventName).toBeGreaterThan(0);
      expect(await db.auditEvent.count({ where: { organisationId: organisation.id, action: eventName } }), eventName).toBeGreaterThan(0);
    }
  });
});
