import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createLease } from "./helpers/lease";
import { generateRentSchedule } from "@/modules/rent-schedules/service";
import {
  createManualPayment,
  createPaymentIntent,
  createSecurityDeposit,
  getPayment,
  getReceipt,
  getRentCollectionMetrics,
  getSecurityDeposit,
  reconcileProviderEvent,
  reversePayment,
} from "@/modules/payments/service";
import { PaymentProviderAdapter, PaymentProviderRegistry } from "@/modules/payments/providers";

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

const adapter: PaymentProviderAdapter = {
  key: "test-adapter",
  supportedMethods: ["MOBILE_MONEY", "BANK_TRANSFER", "CARD"],
  async createIntent(request) {
    return { providerIntentReference: `provider-${request.internalReference}`, status: "PENDING" };
  },
  async parseEvent(payload) {
    return payload as Awaited<ReturnType<PaymentProviderAdapter["parseEvent"]>>;
  },
};

describe("PostgreSQL Phase 5 payments and rent collection", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("handles allocations, overpayments, receipts, deposits, reversals, reconciliation, isolation, RBAC, and events", async () => {
    const ownerA = await registerUser({ displayName: "Payments Owner A", email: "payments-a@example.com", password: "secure-password-123" });
    const ownerB = await registerUser({ displayName: "Payments Owner B", email: "payments-b@example.com", password: "secure-password-123" });
    const organisationA = await createOrganisation(ownerA.id, { name: "Payments A", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const organisationB = await createOrganisation(ownerB.id, { name: "Payments B", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(ownerA.id, organisationA.id, { name: "Collection House", referenceNumber: "COL-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "1A" }] });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const tenant = await createTenant(ownerA.id, organisationA.id, { legalName: "Rent Payer", email: "payer@example.com" });
    const lease = await createLease(ownerA.id, organisationA.id, {
      referenceNumber: "PAY-LEASE-1",
      propertyId: property.id,
      unitId: unit.id,
      tenantOrganisationIds: [tenant.relationship.id],
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      rentAmountMinor: "100000",
      depositAmountMinor: "100000",
      currencyCode: "GHS",
      rentFrequency: "MONTHLY",
      status: "ACTIVE",
    });
    await generateRentSchedule(ownerA.id, organisationA.id, lease.id, 2);
    const [first, second] = await db.rentObligation.findMany({ where: { leaseId: lease.id }, orderBy: { dueDate: "asc" } });

    const partial = await createManualPayment(ownerA.id, organisationA.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "50000",
      currencyCode: "GHS",
      paidAt: "2026-01-05T12:00:00Z",
      method: "CASH",
      externalReference: "cash-book-001",
      evidenceReference: "evidence/cash-book-001.jpg",
      idempotencyKey: "manual-001",
      allocations: [{ rentObligationId: first.id, amountMinor: "50000" }],
    });
    expect(partial.source).toBe("MANUAL");
    expect(partial.receipt?.status).toBe("ISSUED");
    expect(partial.allocations).toHaveLength(1);
    expect((await db.rentObligation.findUniqueOrThrow({ where: { id: first.id } })).collectionState).toBe("PARTIALLY_PAID");
    expect((await createManualPayment(ownerA.id, organisationA.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "50000",
      currencyCode: "GHS",
      paidAt: "2026-01-05T12:00:00Z",
      method: "CASH",
      externalReference: "cash-book-001",
      evidenceReference: "evidence/cash-book-001.jpg",
      idempotencyKey: "manual-001",
    })).id).toBe(partial.id);

    await expect(createManualPayment(ownerA.id, organisationA.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "20000",
      currencyCode: "GHS",
      paidAt: "2026-01-06T12:00:00Z",
      method: "BANK_TRANSFER",
      externalReference: "duplicate-allocation",
      evidenceReference: "evidence/duplicate.pdf",
      idempotencyKey: "manual-duplicate-allocation",
      allocations: [
        { rentObligationId: first.id, amountMinor: "10000" },
        { rentObligationId: first.id, amountMinor: "10000" },
      ],
    })).rejects.toMatchObject({ code: "DUPLICATE_ALLOCATION" });

    const overpayment = await createManualPayment(ownerA.id, organisationA.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "200000",
      currencyCode: "GHS",
      paidAt: "2026-02-05T12:00:00Z",
      method: "BANK_TRANSFER",
      externalReference: "bank-002",
      evidenceReference: "evidence/bank-002.pdf",
      idempotencyKey: "manual-overpayment",
    });
    expect(overpayment.allocations.map(({ amountMinor }) => amountMinor.toString())).toEqual(["50000", "100000"]);
    expect((await db.rentObligation.findUniqueOrThrow({ where: { id: first.id } })).collectionState).toBe("FULLY_PAID");
    expect((await db.rentObligation.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("SATISFIED");
    expect((await db.rentObligation.findUniqueOrThrow({ where: { id: second.id } })).collectionState).toBe("FULLY_PAID");
    expect((await getRentCollectionMetrics(ownerA.id, organisationA.id, lease.id)).outstandingAmountMinor).toBe("0");
    expect((await getReceipt(ownerA.id, organisationA.id, overpayment.receipt!.id)).payment.allocations).toHaveLength(2);

    const deposit = await createSecurityDeposit(ownerA.id, organisationA.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      receivedAt: "2026-01-01T10:00:00Z",
      method: "MOBILE_MONEY",
      externalReference: "deposit-001",
      evidenceReference: "evidence/deposit-001.json",
      idempotencyKey: "deposit-001",
    });
    expect((await createSecurityDeposit(ownerA.id, organisationA.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      receivedAt: "2026-01-01T10:00:00Z",
      method: "MOBILE_MONEY",
      externalReference: "deposit-001",
      evidenceReference: "evidence/deposit-001.json",
      idempotencyKey: "deposit-001",
    })).id).toBe(deposit.id);
    expect((await getSecurityDeposit(ownerA.id, organisationA.id, deposit.id)).ledgerEntries[0].type).toBe("DEPOSIT_RECEIVED");
    expect(await db.paymentAllocation.count({ where: { payment: { leaseId: lease.id } } })).toBe(3);

    await reversePayment(ownerA.id, organisationA.id, overpayment.id, { reason: "Bank transfer was recalled" });
    expect((await getPayment(ownerA.id, organisationA.id, overpayment.id)).receipt?.status).toBe("VOIDED");
    expect((await db.rentObligation.findUniqueOrThrow({ where: { id: first.id } })).collectionState).toBe("PARTIALLY_PAID");
    expect((await db.rentObligation.findUniqueOrThrow({ where: { id: second.id } })).collectionState).toBe("UNPAID");
    expect((await db.rentObligation.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("OVERDUE");
    const ledger = await db.financialLedgerEntry.findMany({ where: { leaseId: lease.id } });
    expect(ledger.filter(({ type }) => type === "RENT_CHARGE")).toHaveLength(2);
    expect(ledger.filter(({ type }) => type === "RENT_PAYMENT")).toHaveLength(2);
    expect(ledger.filter(({ type }) => type === "PAYMENT_REVERSAL")).toHaveLength(1);
    expect(ledger.filter(({ type }) => type === "DEPOSIT_RECEIVED")).toHaveLength(1);

    const registry = new PaymentProviderRegistry([adapter]);
    const intent = await createPaymentIntent(ownerA.id, organisationA.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: adapter.key,
      idempotencyKey: "intent-001",
    }, registry);
    const providerEvent = {
      eventKey: "event-001",
      providerIntentReference: intent.providerIntentRef!,
      providerTransactionReference: "provider-tx-001",
      status: "SUCCEEDED" as const,
      amountMinor: "100000",
      currencyCode: "GHS",
      occurredAt: new Date("2026-03-05T12:00:00Z"),
    };
    const reconciled = await reconcileProviderEvent(organisationA.id, adapter.key, providerEvent, registry);
    const duplicate = await reconcileProviderEvent(organisationA.id, adapter.key, providerEvent, registry);
    expect((await db.payment.findUniqueOrThrow({ where: { providerKey_providerTransactionRef: { providerKey: adapter.key, providerTransactionRef: "provider-tx-001" } } })).source).toBe("PROVIDER");
    expect(duplicate.id).toBe(reconciled.id);
    expect(await db.payment.count({ where: { providerTransactionRef: "provider-tx-001" } })).toBe(1);
    await expect(reconcileProviderEvent(organisationB.id, adapter.key, providerEvent, registry)).rejects.toMatchObject({ code: "RECONCILIATION_ORGANISATION_MISMATCH" });
    await expect(reconcileProviderEvent(organisationB.id, adapter.key, {
      ...providerEvent,
      eventKey: "event-cross-organisation",
    }, registry)).rejects.toMatchObject({ code: "RECONCILIATION_ORGANISATION_MISMATCH" });
    expect(await db.paymentReconciliationEvent.count({ where: { organisationId: organisationB.id } })).toBe(0);

    const lateEvent = {
      eventKey: "event-before-intent-reference",
      providerIntentReference: "late-provider-intent",
      providerTransactionReference: "late-provider-transaction",
      status: "SUCCEEDED" as const,
      amountMinor: "25000",
      currencyCode: "GHS",
      occurredAt: new Date("2026-04-05T12:00:00Z"),
    };
    const unmatched = await reconcileProviderEvent(organisationA.id, adapter.key, lateEvent, registry);
    expect(unmatched.status).toBe("UNMATCHED");
    await db.paymentIntent.create({
      data: {
        organisationId: organisationA.id,
        tenantOrganisationId: tenant.relationship.id,
        leaseId: lease.id,
        propertyId: property.id,
        unitId: unit.id,
        internalReference: "late-intent-internal",
        amountMinor: "25000",
        currencyCode: "GHS",
        method: "MOBILE_MONEY",
        status: "PENDING",
        providerKey: adapter.key,
        providerIntentRef: "late-provider-intent",
        idempotencyKey: "late-intent-idempotency",
        createdByUserId: ownerA.id,
      },
    });
    const rematched = await reconcileProviderEvent(organisationA.id, adapter.key, lateEvent, registry);
    expect(rematched).toMatchObject({ id: unmatched.id, status: "MATCHED" });
    expect(await db.payment.count({ where: { providerTransactionRef: "late-provider-transaction" } })).toBe(1);

    await expect(getPayment(ownerB.id, organisationB.id, partial.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const viewer = await registerUser({ displayName: "Payments Viewer", email: "payments-viewer@example.com", password: "secure-password-123" });
    const viewerRole = await db.role.findUniqueOrThrow({ where: { key: "viewer" } });
    const membership = await db.organisationMember.create({ data: { organisationId: organisationA.id, userId: viewer.id } });
    await db.membershipRole.create({ data: { memberId: membership.id, roleId: viewerRole.id } });
    await expect(createManualPayment(viewer.id, organisationA.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "1000",
      currencyCode: "GHS",
      paidAt: new Date(),
      method: "CASH",
      externalReference: "viewer-denied",
      evidenceReference: "evidence/viewer-denied",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await db.auditEvent.count({ where: { organisationId: organisationA.id, action: { in: ["payment.manual_recorded", "payment.reversed", "deposit.received"] } } })).toBeGreaterThanOrEqual(4);
    expect(await db.domainEvent.count({ where: { organisationId: organisationA.id, name: { in: ["payment.created", "payment.succeeded", "payment.reversed", "payment.allocated", "rent_obligation.partially_paid", "rent_obligation.satisfied", "receipt.issued", "deposit.received", "ledger.entry_created"] } } })).toBeGreaterThanOrEqual(15);
  });
});
