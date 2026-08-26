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
  getMaintenanceDashboardMetrics,
  getMaintenanceRequest,
  getPropertyMaintenanceHistory,
  getTenantMaintenanceHistory,
  listMaintenanceRequests,
  recordWorkOrderCost,
  rejectMaintenanceRequest,
  requestMaintenanceApproval,
  transitionMaintenanceRequest,
  updateWorkOrder,
} from "@/modules/maintenance/service";

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
  await db.organisation.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
}

describe("PostgreSQL Phase 6 maintenance and work orders", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("validates tenant/property relationships, lifecycle, approvals, assignment, costs, history, isolation, RBAC, audits, and events", async () => {
    const owner = await registerUser({ displayName: "Maintenance Owner", email: "maintenance-owner@example.com", password: "secure-password-123" });
    const otherOwner = await registerUser({ displayName: "Other Owner", email: "maintenance-other@example.com", password: "secure-password-123" });
    const reporter = await registerUser({ displayName: "Tenant Reporter", email: "maintenance-tenant@example.com", password: "secure-password-123" });
    const assigneeUser = await registerUser({ displayName: "Internal Artisan", email: "maintenance-artisan@example.com", password: "secure-password-123" });
    const suspendedUser = await registerUser({ displayName: "Suspended Artisan", email: "maintenance-suspended@example.com", password: "secure-password-123" });
    const viewer = await registerUser({ displayName: "Maintenance Viewer", email: "maintenance-viewer@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Maintenance Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(otherOwner.id, { name: "Other Maintenance Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, {
      name: "Primary House", referenceNumber: "MAINT-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }],
    });
    const unrelatedProperty = await createProperty(owner.id, organisation.id, {
      name: "Unrelated House", referenceNumber: "MAINT-2", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "B1" }],
    });
    const otherProperty = await createProperty(otherOwner.id, otherOrganisation.id, {
      name: "Other Org House", referenceNumber: "MAINT-X", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "X1" }],
    });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const unrelatedUnit = await db.unit.findFirstOrThrow({ where: { propertyId: unrelatedProperty.id } });
    const tenant = await createTenant(owner.id, organisation.id, { legalName: "Maintenance Tenant", email: "tenant-record@example.com" });
    await db.tenantOrganisation.update({ where: { id: tenant.relationship.id }, data: { userId: reporter.id } });
    await createLease(owner.id, organisation.id, {
      referenceNumber: "MAINT-LEASE-1",
      propertyId: property.id,
      unitId: unit.id,
      tenantOrganisationIds: [tenant.relationship.id],
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      rentAmountMinor: "100000",
      currencyCode: "GHS",
      rentFrequency: "MONTHLY",
      status: "ACTIVE",
    });

    await expect(createMaintenanceRequest(owner.id, organisation.id, {
      propertyId: property.id, unitId: unrelatedUnit.id, title: "Invalid unit", description: "Wrong property and unit", category: "other",
    })).rejects.toMatchObject({ code: "INVALID_MAINTENANCE_UNIT" });
    await expect(createMaintenanceRequest(reporter.id, organisation.id, {
      propertyId: unrelatedProperty.id, unitId: unrelatedUnit.id, tenantOrganisationId: tenant.relationship.id,
      title: "No lease", description: "Tenant has no lease here", category: "plumbing",
    })).rejects.toMatchObject({ code: "TENANT_LEASE_REQUIRED" });
    await expect(createMaintenanceRequest(reporter.id, organisation.id, {
      propertyId: otherProperty.id, tenantOrganisationId: tenant.relationship.id,
      title: "Cross org", description: "Must remain isolated", category: "security",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const request = await createMaintenanceRequest(reporter.id, organisation.id, {
      propertyId: property.id,
      unitId: unit.id,
      tenantOrganisationId: tenant.relationship.id,
      title: "Leaking kitchen sink",
      description: "Water leaks below the sink",
      category: "plumbing",
      priority: "URGENT",
      attachments: [{ fileKey: "maintenance/leak.jpg", fileName: "leak.jpg", contentType: "image/jpeg", sizeBytes: 3210 }],
    });
    expect(request).toMatchObject({ status: "REPORTED", reportedByUserId: reporter.id });
    expect(request.attachments).toHaveLength(1);
    expect((await getTenantMaintenanceHistory(reporter.id, organisation.id, tenant.relationship.id))[0].id).toBe(request.id);

    const viewerRole = await db.role.findUniqueOrThrow({ where: { key: "viewer" } });
    const viewerMembership = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: viewer.id } });
    await db.membershipRole.create({ data: { memberId: viewerMembership.id, roleId: viewerRole.id } });
    expect(await listMaintenanceRequests(viewer.id, organisation.id)).toHaveLength(1);
    await expect(createMaintenanceRequest(viewer.id, organisation.id, {
      propertyId: property.id, title: "Denied", description: "Viewer cannot create", category: "other",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(transitionMaintenanceRequest(viewer.id, organisation.id, request.id, { status: "TRIAGED" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "TRIAGED", note: "Confirmed plumbing failure" });
    await expect(transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "COMPLETED" })).rejects.toMatchObject({ code: "INVALID_MAINTENANCE_TRANSITION" });
    const approval = await requestMaintenanceApproval(owner.id, organisation.id, request.id, {
      requestedAmountMinor: "85000", currencyCode: "GHS", reason: "Parts and labour", thresholdReference: "default-v1",
    });
    await expect(approveMaintenanceRequest(viewer.id, organisation.id, request.id, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    const decision = await approveMaintenanceRequest(owner.id, organisation.id, request.id, { approvedAmountMinor: "80000", reason: "Approved within budget" });
    expect(decision).toMatchObject({ id: approval.id, status: "APPROVED" });
    expect(decision.approvedAmountMinor?.toString()).toBe("80000");

    const assignee = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: assigneeUser.id } });
    const suspended = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: suspendedUser.id, status: "SUSPENDED" } });
    const workOrder = await createWorkOrder(owner.id, organisation.id, request.id, {
      title: "Repair kitchen plumbing", description: "Replace trap and seals", currencyCode: "GHS", estimateAmountMinor: "80000",
      quotationReference: "quote-001",
    });
    await expect(assignWorkOrder(owner.id, organisation.id, workOrder.id, { assigneeMemberId: suspended.id })).rejects.toMatchObject({ code: "INVALID_WORK_ORDER_ASSIGNEE" });
    const assigned = await assignWorkOrder(owner.id, organisation.id, workOrder.id, { assigneeMemberId: assignee.id, note: "Assigned internally" });
    expect(assigned).toMatchObject({ status: "ASSIGNED", assigneeUserId: assigneeUser.id });

    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "IN_PROGRESS", note: "Repair started" });
    await expect(recordWorkOrderCost(owner.id, organisation.id, workOrder.id, {
      type: "ESTIMATE", amountMinor: "90000", currencyCode: "GHS",
    })).rejects.toMatchObject({ code: "INVALID_ESTIMATE_STATE" });
    await recordWorkOrderCost(owner.id, organisation.id, workOrder.id, {
      type: "ACTUAL", amountMinor: "76000", currencyCode: "GHS", note: "Final parts and labour", financialLedgerReference: "future-ledger-001",
    });
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "COMPLETED", note: "Leak resolved and tested" });
    const completedHistoryCount = await db.workOrderHistory.count({ where: { workOrderId: workOrder.id } });
    await expect(updateWorkOrder(owner.id, organisation.id, workOrder.id, { title: "Rewrite completed work" })).rejects.toMatchObject({ code: "IMMUTABLE_WORK_ORDER" });
    await expect(recordWorkOrderCost(owner.id, organisation.id, workOrder.id, {
      type: "ACTUAL", amountMinor: "1", currencyCode: "GHS",
    })).rejects.toMatchObject({ code: "INVALID_ACTUAL_COST_STATE" });
    expect(await db.workOrderHistory.count({ where: { workOrderId: workOrder.id } })).toBe(completedHistoryCount);
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "CLOSED", note: "Tenant confirmed" });

    const detail = await getMaintenanceRequest(owner.id, organisation.id, request.id);
    expect(detail.status).toBe("CLOSED");
    expect(detail.workOrders[0].actualCostAmountMinor?.toString()).toBe("76000");
    expect(detail.history.map(({ toStatus }) => toStatus).filter(Boolean)).toEqual(expect.arrayContaining(["REPORTED", "TRIAGED", "AWAITING_APPROVAL", "APPROVED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CLOSED"]));
    await expect(getMaintenanceRequest(otherOwner.id, otherOrganisation.id, request.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getPropertyMaintenanceHistory(owner.id, organisation.id, property.id))[0].id).toBe(request.id);
    expect(await getMaintenanceDashboardMetrics(owner.id, organisation.id)).toMatchObject({ total: 1, open: 0, estimateAmountMinor: "80000", actualCostAmountMinor: "76000" });

    const expectedEvents = [
      "maintenance.requested", "maintenance.triaged", "maintenance.approval_requested", "maintenance.approved",
      "workorder.created", "workorder.assigned", "maintenance.started", "maintenance.completed", "maintenance.closed",
    ];
    for (const name of expectedEvents) {
      expect(await db.domainEvent.count({ where: { organisationId: organisation.id, name } }), name).toBeGreaterThan(0);
    }
    expect(await db.auditEvent.count({ where: { organisationId: organisation.id, entityId: request.id } })).toBeGreaterThanOrEqual(7);
  });

  it("records rejected approvals and cancellation events without permitting terminal rewrites", async () => {
    const owner = await registerUser({ displayName: "Reject Owner", email: "maintenance-reject@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Reject Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, {
      name: "Reject House", referenceNumber: "REJECT-1", category: "Residential", countryCode: "GH", currencyCode: "GHS",
    });
    const rejected = await createMaintenanceRequest(owner.id, organisation.id, {
      propertyId: property.id, title: "Paint exterior", description: "Exterior needs repainting", category: "painting",
    });
    await transitionMaintenanceRequest(owner.id, organisation.id, rejected.id, { status: "TRIAGED" });
    await requestMaintenanceApproval(owner.id, organisation.id, rejected.id, { requestedAmountMinor: "200000", currencyCode: "GHS" });
    await rejectMaintenanceRequest(owner.id, organisation.id, rejected.id, { reason: "Deferred until next quarter" });
    await expect(transitionMaintenanceRequest(owner.id, organisation.id, rejected.id, { status: "CANCELLED" })).rejects.toMatchObject({ code: "INVALID_MAINTENANCE_TRANSITION" });
    expect(await db.domainEvent.count({ where: { aggregateId: rejected.id, name: "maintenance.rejected" } })).toBe(1);

    const cancelled = await createMaintenanceRequest(owner.id, organisation.id, {
      propertyId: property.id, title: "False alarm", description: "No repair is needed", category: "other",
    });
    await transitionMaintenanceRequest(owner.id, organisation.id, cancelled.id, { status: "CANCELLED", note: "Reported by mistake" });
    expect(await db.domainEvent.count({ where: { aggregateId: cancelled.id, name: "maintenance.cancelled" } })).toBe(1);
  });
});
