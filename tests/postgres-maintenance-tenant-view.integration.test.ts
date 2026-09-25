import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createLease } from "./helpers/lease";
import {
  approveMaintenanceRequest,
  assignWorkOrder,
  createMaintenanceRequest,
  createWorkOrder,
  getMaintenanceRequest,
  getTenantMaintenanceHistory,
  recordWorkOrderCost,
  requestMaintenanceApproval,
  transitionMaintenanceRequest,
} from "@/modules/maintenance/service";

// Regression: tenant users must only receive a tenant-safe maintenance view.
// Staff notes, approvals, costs, payment/ledger references, assignees and storage keys stay internal.
// Assertions only check key names and booleans so no record content is printed on failure.

async function cleanDatabase() {
  await db.workOrderHistory.deleteMany();
  await db.workOrder.deleteMany();
  await db.maintenanceApproval.deleteMany();
  await db.maintenanceAttachment.deleteMany();
  await db.maintenanceHistory.deleteMany();
  await db.maintenanceRequest.deleteMany();
  await db.paymentReconciliationEvent.deleteMany();
  await db.paymentAllocation.deleteMany();
  await db.receipt.deleteMany();
  await db.financialLedgerEntry.deleteMany();
  await db.payment.deleteMany();
  await db.paymentIntent.deleteMany();
  await db.securityDeposit.deleteMany();
  await db.backgroundJob.deleteMany();
  await db.domainEvent.deleteMany();
  await db.auditEvent.deleteMany();
  await db.notification.deleteMany();
  await db.reminderPolicy.deleteMany();
  await db.rentObligation.deleteMany();
  await db.leaseAmendment.deleteMany();
  await db.leaseDocument.deleteMany();
  await db.leaseHistory.deleteMany();
  await db.leaseParty.deleteMany();
  await db.lease.deleteMany();
  await db.tenantOrganisation.deleteMany();
  await db.tenant.deleteMany();
  await db.organisationInvitation.deleteMany();
  await db.membershipRole.deleteMany();
  await db.organisationMember.deleteMany();
  await db.unit.deleteMany();
  await db.building.deleteMany();
  await db.property.deleteMany();
  await db.portfolio.deleteMany();
  await db.propertyOwner.deleteMany();
  await db.subscriptionInvoice.deleteMany();
  await db.subscriptionStatusHistory.deleteMany();
  await db.organisationEntitlementOverride.deleteMany();
  await db.organisationFeatureFlagOverride.deleteMany();
  await db.platformSupportSession.deleteMany();
  await db.organisationSubscription.deleteMany();
  await db.organisation.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
}

const REQUEST_KEYS = [
  "attachments", "category", "closedAt", "completedAt", "createdAt", "description", "id", "priority",
  "property", "status", "tenantOrganisationId", "timeline", "title", "unit", "updatedAt", "workOrders",
].sort();
const FORBIDDEN_TEXT = ["STAFF-ONLY-NOTE", "STAFF-APPROVAL-REASON", "STAFF-COST-NOTE", "ledger-ref-secret", "pay-ref-secret", "maintenance/secret-key.jpg", "quote-secret"];

function expectTenantSafe(value: unknown) {
  const record = value as Record<string, unknown>;
  expect(Object.keys(record).sort()).toEqual(REQUEST_KEYS);
  expect(Object.keys(record.property as object).sort()).toEqual(["id", "name"]);
  expect(Object.keys(record.unit as object).sort()).toEqual(["id", "name"]);
  for (const attachment of record.attachments as object[]) {
    expect(Object.keys(attachment).sort()).toEqual(["contentType", "createdAt", "fileName", "id", "sizeBytes"]);
  }
  for (const entry of record.timeline as object[]) {
    expect(Object.keys(entry).sort()).toEqual(["createdAt", "fromStatus", "id", "toStatus"]);
  }
  for (const workOrder of record.workOrders as object[]) {
    expect(Object.keys(workOrder).sort()).toEqual(["assignedAt", "completedAt", "createdAt", "dueAt", "id", "startedAt", "status", "title"]);
  }
  const serialised = JSON.stringify(record, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
  for (const marker of FORBIDDEN_TEXT) expect(serialised.includes(marker), "tenant view leaked an internal marker").toBe(false);
}

describe("PostgreSQL tenant-safe maintenance view", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("returns only tenant-safe fields to the linked tenant and keeps the staff view unchanged", async () => {
    const owner = await registerUser({ displayName: "View Owner", email: "tview-owner@example.com", password: "secure-password-123" });
    const otherOwner = await registerUser({ displayName: "View Other Owner", email: "tview-other-owner@example.com", password: "secure-password-123" });
    const tenantUser = await registerUser({ displayName: "View Tenant", email: "tview-tenant@example.com", password: "secure-password-123" });
    const neighbourUser = await registerUser({ displayName: "View Neighbour", email: "tview-neighbour@example.com", password: "secure-password-123" });
    const artisanUser = await registerUser({ displayName: "View Artisan", email: "tview-artisan@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Tenant View Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(otherOwner.id, { name: "Tenant View Other Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, {
      name: "View House", referenceNumber: "TVIEW-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }, { name: "A2" }],
    });
    const [unit, neighbourUnit] = await db.unit.findMany({ where: { propertyId: property.id }, orderBy: { name: "asc" } });
    const tenant = await createTenant(owner.id, organisation.id, { legalName: "View Tenant Record", email: "tview-record@example.com" });
    const neighbour = await createTenant(owner.id, organisation.id, { legalName: "View Neighbour Record", email: "tview-neighbour-record@example.com" });
    await db.tenantOrganisation.update({ where: { id: tenant.relationship.id }, data: { userId: tenantUser.id } });
    await db.tenantOrganisation.update({ where: { id: neighbour.relationship.id }, data: { userId: neighbourUser.id } });
    for (const [reference, unitId, tenantOrganisationId] of [
      ["TVIEW-LEASE-1", unit.id, tenant.relationship.id],
      ["TVIEW-LEASE-2", neighbourUnit.id, neighbour.relationship.id],
    ] as const) {
      await createLease(owner.id, organisation.id, {
        referenceNumber: reference, propertyId: property.id, unitId, tenantOrganisationIds: [tenantOrganisationId],
        startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "100000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE",
      });
    }

    const created = await createMaintenanceRequest(tenantUser.id, organisation.id, {
      propertyId: property.id, unitId: unit.id, tenantOrganisationId: tenant.relationship.id,
      title: "Broken window latch", description: "The bedroom window does not lock", category: "security", priority: "URGENT",
      attachments: [{ fileKey: "maintenance/secret-key.jpg", fileName: "latch.jpg", contentType: "image/jpeg", sizeBytes: 1200 }],
    });
    expectTenantSafe(created);

    await transitionMaintenanceRequest(owner.id, organisation.id, created.id, { status: "TRIAGED", note: "STAFF-ONLY-NOTE" });
    await requestMaintenanceApproval(owner.id, organisation.id, created.id, { requestedAmountMinor: "50000", currencyCode: "GHS", reason: "STAFF-APPROVAL-REASON" });
    await approveMaintenanceRequest(owner.id, organisation.id, created.id, { approvedAmountMinor: "45000", reason: "STAFF-APPROVAL-REASON" });
    const artisan = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: artisanUser.id } });
    const workOrder = await createWorkOrder(owner.id, organisation.id, created.id, {
      title: "Replace latch", currencyCode: "GHS", estimateAmountMinor: "45000", quotationReference: "quote-secret", paymentReference: "pay-ref-secret",
    });
    await assignWorkOrder(owner.id, organisation.id, workOrder.id, { assigneeMemberId: artisan.id, note: "STAFF-ONLY-NOTE" });
    await transitionMaintenanceRequest(owner.id, organisation.id, created.id, { status: "IN_PROGRESS", note: "STAFF-ONLY-NOTE" });
    await recordWorkOrderCost(owner.id, organisation.id, workOrder.id, {
      type: "ACTUAL", amountMinor: "44000", currencyCode: "GHS", note: "STAFF-COST-NOTE",
      financialLedgerReference: "ledger-ref-secret",
    });

    const detail = await getMaintenanceRequest(tenantUser.id, organisation.id, created.id);
    expectTenantSafe(detail);
    const timeline = (detail as unknown as { timeline: { toStatus: string | null }[] }).timeline.map((entry) => entry.toStatus);
    expect(timeline).toEqual(expect.arrayContaining(["REPORTED", "TRIAGED", "AWAITING_APPROVAL", "APPROVED", "ASSIGNED", "IN_PROGRESS"]));
    expect((detail as unknown as { workOrders: unknown[] }).workOrders).toHaveLength(1);

    const history = await getTenantMaintenanceHistory(tenantUser.id, organisation.id, tenant.relationship.id);
    expect(history).toHaveLength(1);
    history.forEach(expectTenantSafe);

    // Another tenant in the same organisation cannot read this tenant's request or history.
    await expect(getMaintenanceRequest(neighbourUser.id, organisation.id, created.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getTenantMaintenanceHistory(neighbourUser.id, organisation.id, tenant.relationship.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A tenant cannot report against another tenant's relationship.
    await expect(createMaintenanceRequest(neighbourUser.id, organisation.id, {
      propertyId: property.id, unitId: unit.id, tenantOrganisationId: tenant.relationship.id,
      title: "Impersonation", description: "Should be refused", category: "other",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A forged organisation header (another organisation id) finds nothing.
    await expect(getMaintenanceRequest(tenantUser.id, otherOrganisation.id, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getTenantMaintenanceHistory(tenantUser.id, otherOrganisation.id, tenant.relationship.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getMaintenanceRequest(otherOwner.id, otherOrganisation.id, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Staff keep the full internal view.
    const staff = await getMaintenanceRequest(owner.id, organisation.id, created.id);
    if (!("approvals" in staff)) throw new Error("Staff must receive the internal maintenance view.");
    expect(staff.approvals.length > 0).toBe(true);
    expect(staff.workOrders[0].actualCostAmountMinor?.toString()).toBe("44000");
    expect(staff.history.some((entry) => entry.note === "STAFF-ONLY-NOTE")).toBe(true);
    expect(staff.attachments[0].fileKey).toBe("maintenance/secret-key.jpg");
    const staffHistory = await getTenantMaintenanceHistory(owner.id, organisation.id, tenant.relationship.id);
    expect("approvals" in staffHistory[0]).toBe(true);
    const staffCreated = await createMaintenanceRequest(owner.id, organisation.id, {
      propertyId: property.id, title: "Staff inspection", description: "Routine staff report", category: "other",
    });
    expect("history" in staffCreated && "approvals" in staffCreated).toBe(true);
  });
});
