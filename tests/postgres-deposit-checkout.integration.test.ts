import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createLease } from "./helpers/lease";
import { generateRentSchedule } from "@/modules/rent-schedules/service";
import {
  createDepositCheckout,
  createPaymentIntent,
  createTenantDepositCheckout,
  getPaymentIntent,
  getSecurityDeposit,
  getTenantDepositHistory,
  listReconciliationEvents,
  listSecurityDeposits,
  reconcileProviderEvent,
} from "@/modules/payments/service";
import { paymentProviders, type PaymentProviderAdapter } from "@/modules/payments/providers";
import { POST as webhookRoute } from "@/app/api/webhooks/payments/[organisationId]/[providerKey]/route";

async function cleanDatabase() {
  await db.paymentReconciliationEvent.deleteMany();
  await db.paymentAllocation.deleteMany();
  await db.receipt.deleteMany();
  await db.financialLedgerEntry.deleteMany();
  await db.payment.deleteMany();
  await db.securityDeposit.deleteMany();
  await db.paymentIntent.deleteMany();
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
  await db.organisation.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
}

const ENV_KEYS = ["MTN_MOMO_BASE_URL", "MTN_MOMO_API_KEY", "MTN_MOMO_SUBSCRIPTION_KEY", "MTN_MOMO_WEBHOOK_SECRET"] as const;

function clearGatewayEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function configureMtnMomo() {
  process.env.MTN_MOMO_BASE_URL = "https://momo.example.test";
  process.env.MTN_MOMO_API_KEY = "test-api-key";
  process.env.MTN_MOMO_SUBSCRIPTION_KEY = "test-subscription-key";
  process.env.MTN_MOMO_WEBHOOK_SECRET = "mtn-webhook-secret";
}

async function fixture() {
  const owner = await registerUser({ displayName: "Deposit Checkout Owner", email: "deposit-owner@example.com", password: "secure-password-123" });
  const outsider = await registerUser({ displayName: "Deposit Checkout Outsider", email: "deposit-outsider@example.com", password: "secure-password-123" });
  const tenantUser = await registerUser({ displayName: "Deposit Payer", email: "deposit-tenant@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(owner.id, { name: "Deposit Checkout Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
  const property = await createProperty(owner.id, organisation.id, { name: "Osu Heights", referenceNumber: "OSU-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "1A" }] });
  const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
  const tenant = await createTenant(owner.id, organisation.id, { legalName: "Ama Boateng", email: "ama@example.com" });
  await db.tenantOrganisation.update({ where: { id: tenant.relationship.id }, data: { userId: tenantUser.id } });
  const lease = await createLease(owner.id, organisation.id, {
    referenceNumber: "DEP-LEASE-1",
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
  await generateRentSchedule(owner.id, organisation.id, lease.id, 2);
  return { owner, outsider, tenantUser, organisation, property, unit, tenant, lease };
}

function depositEvent(overrides: Partial<{ eventId: string; reference: string; transactionId: string; amount: string; currency: string; status: string; occurredAt: string; reason: string }> = {}) {
  return {
    eventId: overrides.eventId ?? "evt-1",
    reference: overrides.reference ?? "provider-intent-ref",
    transactionId: overrides.transactionId ?? "txn-1",
    amount: overrides.amount ?? "100000",
    currency: overrides.currency ?? "GHS",
    status: overrides.status ?? "SUCCESSFUL",
    occurredAt: overrides.occurredAt ?? "2026-03-01T10:00:00Z",
    reason: overrides.reason,
  };
}

describe("PostgreSQL Phase 18 provider-backed security-deposit checkout", () => {
  beforeEach(async () => {
    await cleanDatabase();
    clearGatewayEnv();
  });
  afterEach(() => {
    clearGatewayEnv();
    vi.unstubAllGlobals();
  });
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("initiates a manager deposit checkout as purpose DEPOSIT, staying PROCESSING with no SecurityDeposit/Payment until reconciled", async () => {
    const { owner, organisation, lease, tenant } = await fixture();
    configureMtnMomo();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reference: "deposit-intent-ref-1" }), { status: 200 })));

    const intent = await createDepositCheckout(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "deposit-checkout-1",
    });
    expect(intent.purpose).toBe("DEPOSIT");
    expect(["PENDING", "PROCESSING"]).toContain(intent.status);
    expect(intent.providerIntentRef).toBe("deposit-intent-ref-1");
    expect(await db.securityDeposit.count({ where: { organisationId: organisation.id } })).toBe(0);
    expect(await db.payment.count({ where: { organisationId: organisation.id } })).toBe(0);
  });

  it("reconciles a verified successful deposit webhook into a SecurityDeposit tagged source=PROVIDER with an immutable DEPOSIT_RECEIPT ledger entry, never a Payment/Receipt, and never touches rent allocation", async () => {
    const { owner, organisation, lease, tenant, property, unit } = await fixture();
    configureMtnMomo();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reference: "deposit-intent-ref-2" }), { status: 200 })));
    const intent = await createDepositCheckout(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "deposit-success-1",
    });

    const event = depositEvent({ eventId: "evt-deposit-success-1", reference: "deposit-intent-ref-2", transactionId: "deposit-txn-1" });
    const reconciled = await reconcileProviderEvent(organisation.id, "mtn-momo-gh", event);
    expect(reconciled.status).toBe("MATCHED");

    const deposit = await db.securityDeposit.findFirstOrThrow({ where: { organisationId: organisation.id, providerTransactionRef: "deposit-txn-1" }, include: { ledgerEntries: true } });
    expect(deposit.source).toBe("PROVIDER");
    expect(deposit.providerKey).toBe("mtn-momo-gh");
    expect(deposit.paymentIntentId).toBe(intent.id);
    expect(deposit.amountMinor.toString()).toBe("100000");
    expect(deposit.ledgerEntries).toHaveLength(1);
    expect(deposit.ledgerEntries[0].type).toBe("DEPOSIT_RECEIPT");
    expect(deposit.ledgerEntries[0].direction).toBe("CREDIT");
    expect(deposit.ledgerEntries[0].propertyId).toBe(property.id);
    expect(deposit.ledgerEntries[0].unitId).toBe(unit.id);

    // Financially separate from rent: no Payment/Receipt, and rent obligations are untouched.
    expect(await db.payment.count({ where: { organisationId: organisation.id } })).toBe(0);
    expect(await db.receipt.count({ where: { organisationId: organisation.id } })).toBe(0);
    expect((await db.rentObligation.findFirstOrThrow({ where: { leaseId: lease.id }, orderBy: { dueDate: "asc" } })).collectionState).toBe("UNPAID");

    const updatedIntent = await getPaymentIntent(owner.id, organisation.id, intent.id);
    expect(updatedIntent.status).toBe("SUCCEEDED");

    const fetchedDeposit = await getSecurityDeposit(owner.id, organisation.id, deposit.id);
    expect(fetchedDeposit.id).toBe(deposit.id);
    expect((await listSecurityDeposits(owner.id, organisation.id)).map(({ id }) => id)).toContain(deposit.id);
  });

  it("never creates a SecurityDeposit for a failed or mismatched deposit webhook", async () => {
    const { owner, organisation, lease, tenant } = await fixture();
    configureMtnMomo();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reference: "deposit-intent-ref-3" }), { status: 200 })));
    const intent = await createDepositCheckout(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "deposit-failure-1",
    });

    const failedEvent = depositEvent({ eventId: "evt-deposit-failure-1", reference: "deposit-intent-ref-3", transactionId: "deposit-txn-2", status: "FAILED", reason: "Payer rejected the prompt." });
    const failedReconciliation = await reconcileProviderEvent(organisation.id, "mtn-momo-gh", failedEvent);
    expect(failedReconciliation.status).toBe("MATCHED");
    expect(await db.securityDeposit.count({ where: { organisationId: organisation.id } })).toBe(0);
    expect((await getPaymentIntent(owner.id, organisation.id, intent.id)).status).toBe("FAILED");

    const mismatchEvent = depositEvent({ eventId: "evt-deposit-mismatch-1", reference: "deposit-intent-ref-3", transactionId: "deposit-txn-3", amount: "1" });
    const mismatched = await reconcileProviderEvent(organisation.id, "mtn-momo-gh", mismatchEvent);
    expect(mismatched.status).toBe("MISMATCHED");
    expect(await db.securityDeposit.count({ where: { organisationId: organisation.id } })).toBe(0);

    const events = await listReconciliationEvents(owner.id, organisation.id);
    expect(events.map(({ status }) => status).sort()).toEqual(["MATCHED", "MISMATCHED"]);
  });

  it("treats a replayed deposit webhook event (same eventKey) as idempotent and never double-creates the deposit", async () => {
    const { owner, organisation, lease, tenant } = await fixture();
    configureMtnMomo();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reference: "deposit-intent-ref-4" }), { status: 200 })));
    await createDepositCheckout(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "deposit-replay-1",
    });
    const event = depositEvent({ eventId: "evt-deposit-replay-1", reference: "deposit-intent-ref-4", transactionId: "deposit-txn-4" });
    const first = await reconcileProviderEvent(organisation.id, "mtn-momo-gh", event);
    const replay = await reconcileProviderEvent(organisation.id, "mtn-momo-gh", event);
    expect(replay.id).toBe(first.id);
    expect(await db.securityDeposit.count({ where: { organisationId: organisation.id, providerTransactionRef: "deposit-txn-4" } })).toBe(1);

    // A different payload reusing the same event key is a tamper/replay attempt, not a legitimate retry.
    await expect(reconcileProviderEvent(organisation.id, "mtn-momo-gh", { ...event, amount: "1" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("dedupes a duplicate provider transaction reference even without a reconciliation-event replay, without creating a second deposit", async () => {
    const { owner, organisation, lease, tenant } = await fixture();
    configureMtnMomo();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reference: "deposit-intent-ref-5" }), { status: 200 })));
    await createDepositCheckout(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "deposit-dedupe-1",
    });
    const event = depositEvent({ eventId: "evt-deposit-dedupe-1", reference: "deposit-intent-ref-5", transactionId: "deposit-txn-5" });
    await reconcileProviderEvent(organisation.id, "mtn-momo-gh", event);

    // Same provider transaction ref surfacing again under a brand-new eventKey is still a
    // duplicate of the underlying money movement, not a second deposit.
    const replayedTransaction = depositEvent({ eventId: "evt-deposit-dedupe-2", reference: "deposit-intent-ref-5", transactionId: "deposit-txn-5" });
    const reconciled = await reconcileProviderEvent(organisation.id, "mtn-momo-gh", replayedTransaction);
    expect(reconciled.status).toBe("DUPLICATE");
    expect(await db.securityDeposit.count({ where: { organisationId: organisation.id, providerTransactionRef: "deposit-txn-5" } })).toBe(1);
  });

  it("lets a tenant self-service deposit checkout for their own lease, forbids other users, and keeps a deposit idempotency key distinct from a rent checkout's", async () => {
    const { owner, organisation, lease, tenant, tenantUser, outsider } = await fixture();
    configureMtnMomo();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reference: "tenant-deposit-intent-ref-1" }), { status: 200 })));
    const intent = await createTenantDepositCheckout(tenantUser.id, organisation.id, tenant.relationship.id, {
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "tenant-deposit-checkout-1",
    });
    expect(intent.purpose).toBe("DEPOSIT");
    expect(["PENDING", "PROCESSING"]).toContain(intent.status);

    await expect(createTenantDepositCheckout(outsider.id, organisation.id, tenant.relationship.id, {
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "tenant-deposit-checkout-forbidden",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Reusing the exact same idempotency key for a rent checkout must not silently resolve to
    // the deposit intent — a client can never relabel a checkout's purpose after the fact.
    await expect(createPaymentIntent(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "tenant-deposit-checkout-1",
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const event = depositEvent({ eventId: "evt-tenant-deposit-1", reference: "tenant-deposit-intent-ref-1", transactionId: "tenant-deposit-txn-1" });
    await reconcileProviderEvent(organisation.id, "mtn-momo-gh", event);
    const history = await getTenantDepositHistory(tenantUser.id, organisation.id, tenant.relationship.id);
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe("PROVIDER");
    await expect(getTenantDepositHistory(outsider.id, organisation.id, tenant.relationship.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a payment webhook when the registered provider adapter has no verifyWebhookSignature implementation at all", async () => {
    const noVerifyAdapter: PaymentProviderAdapter = {
      key: "test-no-verify-adapter",
      supportedMethods: ["MOBILE_MONEY"],
      async createIntent(request) {
        return { providerIntentReference: `provider-${request.internalReference}`, status: "PROCESSING" };
      },
      async parseEvent(payload) {
        return payload as Awaited<ReturnType<PaymentProviderAdapter["parseEvent"]>>;
      },
      // Deliberately no `verifyWebhookSignature` — the route must fail closed, not treat this as
      // pre-verified the way it does an adapter whose method returns `{ verified: false }`.
    };
    paymentProviders.register(noVerifyAdapter);

    const request = new Request("https://example.test/api/webhooks/payments/org-1/test-no-verify-adapter", {
      method: "POST",
      body: JSON.stringify({ any: "payload" }),
    });
    const response = await webhookRoute(request, { params: Promise.resolve({ organisationId: "org-1", providerKey: "test-no-verify-adapter" }) });
    expect(response.status).toBe(401);
  });

  it("still rejects a real MTN MoMo webhook without a valid signature via the route, and accepts one with a valid signature", async () => {
    const { owner, organisation, lease, tenant } = await fixture();
    configureMtnMomo();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reference: "route-deposit-intent-ref-1" }), { status: 200 })));
    await createDepositCheckout(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "route-deposit-checkout-1",
    });

    const event = depositEvent({ eventId: "evt-route-deposit-1", reference: "route-deposit-intent-ref-1", transactionId: "route-deposit-txn-1" });
    const body = JSON.stringify(event);

    const unsigned = new Request(`https://example.test/api/webhooks/payments/${organisation.id}/mtn-momo-gh`, { method: "POST", body });
    const unsignedResponse = await webhookRoute(unsigned, { params: Promise.resolve({ organisationId: organisation.id, providerKey: "mtn-momo-gh" }) });
    expect(unsignedResponse.status).toBe(401);
    expect(await db.securityDeposit.count({ where: { organisationId: organisation.id } })).toBe(0);

    const { createHmac } = await import("node:crypto");
    const signed = new Request(`https://example.test/api/webhooks/payments/${organisation.id}/mtn-momo-gh`, {
      method: "POST",
      body,
      headers: { "x-momo-signature": createHmac("sha256", "mtn-webhook-secret").update(body).digest("hex") },
    });
    const signedResponse = await webhookRoute(signed, { params: Promise.resolve({ organisationId: organisation.id, providerKey: "mtn-momo-gh" }) });
    expect(signedResponse.status).toBe(200);
    const json = await signedResponse.json();
    expect(json.securityDepositId).toBeTruthy();
    expect(await db.securityDeposit.count({ where: { organisationId: organisation.id, providerTransactionRef: "route-deposit-txn-1" } })).toBe(1);
  });
});
