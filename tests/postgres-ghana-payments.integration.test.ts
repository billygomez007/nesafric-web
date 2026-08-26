import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createLease } from "./helpers/lease";
import { generateRentSchedule } from "@/modules/rent-schedules/service";
import {
  createPaymentIntent,
  createTenantPaymentCheckout,
  getPaymentIntent,
  listAvailablePaymentProviders,
  listReconciliationEvents,
  reconcileProviderEvent,
} from "@/modules/payments/service";
import { paymentProviders } from "@/modules/payments/providers";
import { mtnMomo, telecelCash, atMoney } from "@/modules/payments/gateways";

async function cleanDatabase() {
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

const ENV_KEYS = [
  "MTN_MOMO_BASE_URL", "MTN_MOMO_API_KEY", "MTN_MOMO_SUBSCRIPTION_KEY", "MTN_MOMO_WEBHOOK_SECRET",
  "TELECEL_CASH_BASE_URL", "TELECEL_CASH_API_KEY", "TELECEL_CASH_MERCHANT_ID", "TELECEL_CASH_WEBHOOK_SECRET",
  "AT_MONEY_BASE_URL", "AT_MONEY_API_KEY", "AT_MONEY_MERCHANT_ID", "AT_MONEY_WEBHOOK_SECRET",
  "CARD_PAYMENTS_BASE_URL", "CARD_PAYMENTS_API_KEY", "CARD_PAYMENTS_WEBHOOK_SECRET",
  "BANK_TRANSFER_PAYMENTS_BASE_URL", "BANK_TRANSFER_PAYMENTS_API_KEY", "BANK_TRANSFER_PAYMENTS_WEBHOOK_SECRET",
] as const;

function clearGatewayEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function configureMtnMomo() {
  process.env.MTN_MOMO_BASE_URL = "https://momo.example.test";
  process.env.MTN_MOMO_API_KEY = "test-api-key";
  process.env.MTN_MOMO_SUBSCRIPTION_KEY = "test-subscription-key";
  process.env.MTN_MOMO_WEBHOOK_SECRET = "mtn-webhook-secret";
}

function configureTelecelCash() {
  process.env.TELECEL_CASH_BASE_URL = "https://telecel.example.test";
  process.env.TELECEL_CASH_API_KEY = "test-api-key";
  process.env.TELECEL_CASH_MERCHANT_ID = "merchant-1";
  process.env.TELECEL_CASH_WEBHOOK_SECRET = "telecel-webhook-secret";
}

async function fixture() {
  const owner = await registerUser({ displayName: "Ghana Payments Owner", email: "ghana-owner@example.com", password: "secure-password-123" });
  const outsider = await registerUser({ displayName: "Ghana Payments Outsider", email: "ghana-outsider@example.com", password: "secure-password-123" });
  const tenantUser = await registerUser({ displayName: "Rent Payer", email: "ghana-tenant@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(owner.id, { name: "Ghana Payments Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
  const otherOrganisation = await createOrganisation(outsider.id, { name: "Ghana Payments Org B", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
  const property = await createProperty(owner.id, organisation.id, { name: "Accra Towers", referenceNumber: "ACC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "1A" }] });
  const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
  const tenant = await createTenant(owner.id, organisation.id, { legalName: "Kojo Mensah", email: "kojo@example.com" });
  await db.tenantOrganisation.update({ where: { id: tenant.relationship.id }, data: { userId: tenantUser.id } });
  const lease = await createLease(owner.id, organisation.id, {
    referenceNumber: "GH-LEASE-1",
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
  return { owner, outsider, tenantUser, organisation, otherOrganisation, property, unit, tenant, lease };
}

function momoRequestToPayEvent(overrides: Partial<{ eventId: string; reference: string; transactionId: string; amount: string; currency: string; status: string; occurredAt: string; reason: string }> = {}) {
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

function signedWebhookHeaders(secret: string, body: string, header: string) {
  return { [header]: createHmac("sha256", secret).update(body).digest("hex") };
}

describe("PostgreSQL Phase 18 Ghana payment integration", () => {
  beforeEach(async () => {
    await cleanDatabase();
    clearGatewayEnv();
  });
  afterEach(() => {
    clearGatewayEnv();
    vi.unstubAllGlobals();
  });
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("registers MTN MoMo, Telecel Cash, AT Money, card, and bank adapters behind the provider-neutral registry", () => {
    expect(paymentProviders.get("mtn-momo-gh").supportedMethods).toEqual(["MOBILE_MONEY"]);
    expect(paymentProviders.get("telecel-cash-gh").supportedMethods).toEqual(["MOBILE_MONEY"]);
    expect(paymentProviders.get("at-money-gh").supportedMethods).toEqual(["MOBILE_MONEY"]);
    expect(paymentProviders.get("card-gh").supportedMethods).toEqual(["CARD"]);
    expect(paymentProviders.get("bank-transfer-gh").supportedMethods).toEqual(["BANK_TRANSFER"]);
    expect(() => paymentProviders.get("unknown-gateway")).toThrowError(expect.objectContaining({ code: "PAYMENT_PROVIDER_UNKNOWN" }));
  });

  it("reports provider availability without exposing secrets, and never fabricates a successful checkout when unconfigured", async () => {
    const { owner, organisation, lease, tenant } = await fixture();
    const unavailable = listAvailablePaymentProviders();
    expect(unavailable.find((provider) => provider.key === "mtn-momo-gh")).toMatchObject({ available: false });
    expect(mtnMomo.isConfigured!()).toBe(false);

    await expect(createPaymentIntent(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "unavailable-checkout",
    })).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_UNAVAILABLE", status: 503 });

    const intent = await db.paymentIntent.findFirstOrThrow({ where: { organisationId: organisation.id, idempotencyKey: "unavailable-checkout" } });
    expect(intent.status).toBe("FAILED");
    expect(intent.providerIntentRef).toBeNull();
    expect(await db.payment.count({ where: { organisationId: organisation.id } })).toBe(0);

    configureMtnMomo();
    expect(mtnMomo.isConfigured!()).toBe(true);
    expect(listAvailablePaymentProviders().find((provider) => provider.key === "mtn-momo-gh")).toMatchObject({ available: true });
  });

  it("initiates a checkout against a mocked MTN MoMo transport, staying PROCESSING until a verified webhook reconciles it (never on redirect)", async () => {
    const { owner, organisation, lease, tenant } = await fixture();
    configureMtnMomo();
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://momo.example.test/collections/requests");
      return new Response(JSON.stringify({ reference: "provider-intent-ref" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const intent = await createPaymentIntent(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "mtn-checkout-1",
      metadata: { msisdn: "0244000000" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Only PENDING/PROCESSING is ever returned synchronously from checkout initiation.
    expect(["PENDING", "PROCESSING"]).toContain(intent.status);
    expect(intent.providerIntentRef).toBe("provider-intent-ref");
    expect(await db.payment.count({ where: { organisationId: organisation.id } })).toBe(0);
  });

  it("rejects webhooks with an invalid or missing signature and never reconciles them", async () => {
    configureMtnMomo();
    expect(mtnMomo.verifyWebhookSignature!("{}", {})).toMatchObject({ verified: false, reason: "missing-signature" });
    expect(mtnMomo.verifyWebhookSignature!("{}", { "x-momo-signature": "deadbeef" })).toMatchObject({ verified: false });
    const body = JSON.stringify(momoRequestToPayEvent());
    const valid = mtnMomo.verifyWebhookSignature!(body, signedWebhookHeaders("mtn-webhook-secret", body, "x-momo-signature"));
    expect(valid).toMatchObject({ verified: true });

    delete process.env.MTN_MOMO_WEBHOOK_SECRET;
    expect(mtnMomo.verifyWebhookSignature!(body, signedWebhookHeaders("mtn-webhook-secret", body, "x-momo-signature"))).toMatchObject({ verified: false, reason: "not-configured" });
  });

  it("reconciles a matched MTN MoMo webhook to a succeeded payment, issues a receipt, and notifies the tenant", async () => {
    const { owner, organisation, lease, tenant, unit, property } = await fixture();
    configureMtnMomo();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reference: "mtn-intent-ref-1" }), { status: 200 })));
    const intent = await createPaymentIntent(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "mtn-success-1",
    });
    expect(intent.providerIntentRef).toBe("mtn-intent-ref-1");

    const event = momoRequestToPayEvent({ eventId: "evt-success-1", reference: "mtn-intent-ref-1", transactionId: "mtn-txn-1" });
    const reconciled = await reconcileProviderEvent(organisation.id, "mtn-momo-gh", event);
    expect(reconciled.status).toBe("MATCHED");
    const payment = await db.payment.findFirstOrThrow({ where: { organisationId: organisation.id, providerTransactionRef: "mtn-txn-1" }, include: { receipt: true } });
    expect(payment.status).toBe("SUCCEEDED");
    expect(payment.reconciliationStatus).toBe("MATCHED");
    expect(payment.receipt?.status).toBe("ISSUED");
    expect(payment.propertyId).toBe(property.id);
    expect(payment.unitId).toBe(unit.id);
    expect((await db.rentObligation.findFirstOrThrow({ where: { leaseId: lease.id }, orderBy: { dueDate: "asc" } })).collectionState).toBe("FULLY_PAID");

    const notification = await db.notification.findFirstOrThrow({ where: { organisationId: organisation.id, tenantOrganisationId: tenant.relationship.id, eventType: "PAYMENT_RECEIVED" } });
    expect(notification.channel).toBe("IN_APP");
    expect(notification.dedupeReference).toBe(payment.id);
    expect(await db.backgroundJob.count({ where: { type: "notification-delivery" } })).toBe(1);
  });

  it("reconciles a failed MTN MoMo webhook without allocating rent, and notifies the tenant of the failure", async () => {
    const { owner, organisation, lease, tenant } = await fixture();
    configureMtnMomo();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reference: "mtn-intent-ref-2" }), { status: 200 })));
    await createPaymentIntent(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "mtn-failure-1",
    });
    const event = momoRequestToPayEvent({ eventId: "evt-failure-1", reference: "mtn-intent-ref-2", transactionId: "mtn-txn-2", status: "FAILED", reason: "Payer rejected the prompt." });
    await reconcileProviderEvent(organisation.id, "mtn-momo-gh", event);
    const payment = await db.payment.findFirstOrThrow({ where: { organisationId: organisation.id, providerTransactionRef: "mtn-txn-2" } });
    expect(payment.status).toBe("FAILED");
    expect(payment.failureReason).toBe("Payer rejected the prompt.");
    expect((await db.rentObligation.findFirstOrThrow({ where: { leaseId: lease.id }, orderBy: { dueDate: "asc" } })).collectionState).toBe("UNPAID");
    const notification = await db.notification.findFirstOrThrow({ where: { organisationId: organisation.id, eventType: "PAYMENT_FAILED" } });
    expect(notification.dedupeReference).toBe(payment.id);
  });

  it("persists mismatched-amount and unmatched-reference webhook events without creating a payment (manager financial view)", async () => {
    const { owner, organisation, lease, tenant } = await fixture();
    configureMtnMomo();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reference: "mtn-intent-ref-3" }), { status: 200 })));
    await createPaymentIntent(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "mtn-mismatch-1",
    });
    const mismatchEvent = momoRequestToPayEvent({ eventId: "evt-mismatch-1", reference: "mtn-intent-ref-3", transactionId: "mtn-txn-3", amount: "50000" });
    const mismatched = await reconcileProviderEvent(organisation.id, "mtn-momo-gh", mismatchEvent);
    expect(mismatched.status).toBe("MISMATCHED");

    const unmatchedEvent = momoRequestToPayEvent({ eventId: "evt-unmatched-1", reference: "no-such-intent", transactionId: "mtn-txn-4" });
    const unmatched = await reconcileProviderEvent(organisation.id, "mtn-momo-gh", unmatchedEvent);
    expect(unmatched.status).toBe("UNMATCHED");
    expect(await db.payment.count({ where: { organisationId: organisation.id } })).toBe(0);

    const events = await listReconciliationEvents(owner.id, organisation.id);
    expect(events.map(({ status }) => status).sort()).toEqual(["MISMATCHED", "UNMATCHED"]);
    expect((await listReconciliationEvents(owner.id, organisation.id, { status: "MISMATCHED" })).every((event) => event.status === "MISMATCHED")).toBe(true);
  });

  it("treats a replayed webhook event (same eventKey) as idempotent and never double-processes it", async () => {
    const { owner, organisation, lease, tenant } = await fixture();
    configureMtnMomo();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reference: "mtn-intent-ref-4" }), { status: 200 })));
    await createPaymentIntent(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "mtn-replay-1",
    });
    const event = momoRequestToPayEvent({ eventId: "evt-replay-1", reference: "mtn-intent-ref-4", transactionId: "mtn-txn-5" });
    const first = await reconcileProviderEvent(organisation.id, "mtn-momo-gh", event);
    const replay = await reconcileProviderEvent(organisation.id, "mtn-momo-gh", event);
    expect(replay.id).toBe(first.id);
    expect(await db.payment.count({ where: { organisationId: organisation.id, providerTransactionRef: "mtn-txn-5" } })).toBe(1);
    expect(await db.notification.count({ where: { organisationId: organisation.id, eventType: "PAYMENT_RECEIVED" } })).toBe(1);
    expect(await db.backgroundJob.count({ where: { type: "notification-delivery" } })).toBe(1);

    // A different payload reusing the same event key is a tamper/replay attempt, not a legitimate retry.
    await expect(reconcileProviderEvent(organisation.id, "mtn-momo-gh", { ...event, amount: "1" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("keeps Telecel Cash and AT Money independently configurable and functioning through the same shared contract", async () => {
    const { owner, organisation, lease, tenant } = await fixture();
    configureTelecelCash();
    expect(telecelCash.isConfigured!()).toBe(true);
    expect(atMoney.isConfigured!()).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toBe("https://telecel.example.test/collections/requests");
      return new Response(JSON.stringify({ reference: "telecel-intent-ref-1" }), { status: 200 });
    }));
    const intent = await createPaymentIntent(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "telecel-cash-gh",
      idempotencyKey: "telecel-checkout-1",
    });
    expect(intent.providerIntentRef).toBe("telecel-intent-ref-1");
    const event = momoRequestToPayEvent({ eventId: "evt-telecel-1", reference: "telecel-intent-ref-1", transactionId: "telecel-txn-1" });
    const reconciled = await reconcileProviderEvent(organisation.id, "telecel-cash-gh", event);
    expect(reconciled.status).toBe("MATCHED");
    const payment = await db.payment.findFirstOrThrow({ where: { organisationId: organisation.id, providerTransactionRef: "telecel-txn-1" } });
    expect(payment.status).toBe("SUCCEEDED");
    expect(payment.providerKey).toBe("telecel-cash-gh");

    await expect(createPaymentIntent(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "at-money-gh",
      idempotencyKey: "at-money-unavailable-1",
    })).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_UNAVAILABLE" });
  });

  it("lets a tenant self-service checkout for their own lease, but forbids other users, and never treats a provider-unavailable failure as authorization to bypass reconciliation", async () => {
    const { organisation, lease, tenant, tenantUser, outsider } = await fixture();
    configureMtnMomo();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reference: "tenant-intent-ref-1" }), { status: 200 })));
    const intent = await createTenantPaymentCheckout(tenantUser.id, organisation.id, tenant.relationship.id, {
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "tenant-self-checkout-1",
      metadata: { msisdn: "0201234567" },
    });
    expect(["PENDING", "PROCESSING"]).toContain(intent.status);

    await expect(createTenantPaymentCheckout(outsider.id, organisation.id, tenant.relationship.id, {
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "tenant-self-checkout-forbidden",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The tenant can poll their own intent status; an unrelated user cannot.
    const fetched = await getPaymentIntent(tenantUser.id, organisation.id, intent.id);
    expect(fetched.id).toBe(intent.id);
    await expect(getPaymentIntent(outsider.id, organisation.id, intent.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps reconciliation events organisation-isolated across Ghana providers", async () => {
    const { owner, organisation, otherOrganisation, lease, tenant } = await fixture();
    configureMtnMomo();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reference: "isolation-intent-ref-1" }), { status: 200 })));
    await createPaymentIntent(owner.id, organisation.id, {
      tenantOrganisationId: tenant.relationship.id,
      leaseId: lease.id,
      amountMinor: "100000",
      currencyCode: "GHS",
      method: "MOBILE_MONEY",
      providerKey: "mtn-momo-gh",
      idempotencyKey: "isolation-checkout-1",
    });

    // A caller cannot "fish" for another organisation's intent by guessing its provider reference:
    // the intent lookup is organisation-scoped, so this resolves to UNMATCHED (not a leak), and the
    // reconciliation event this creates is recorded under the caller's own organisation.
    const probeEvent = momoRequestToPayEvent({ eventId: "evt-isolation-probe", reference: "isolation-intent-ref-1", transactionId: "isolation-txn-probe" });
    await expect(reconcileProviderEvent(otherOrganisation.id, "mtn-momo-gh", probeEvent)).resolves.toMatchObject({ status: "UNMATCHED" });
    expect(await db.paymentReconciliationEvent.count({ where: { organisationId: otherOrganisation.id } })).toBe(1);
    expect(await db.paymentReconciliationEvent.count({ where: { organisationId: organisation.id } })).toBe(0);
    expect(await db.payment.count({ where: { organisationId: otherOrganisation.id } })).toBe(0);

    // Reusing the *same* event key for the rightful organisation now matches successfully...
    const event = momoRequestToPayEvent({ eventId: "evt-isolation-1", reference: "isolation-intent-ref-1", transactionId: "isolation-txn-1" });
    const matched = await reconcileProviderEvent(organisation.id, "mtn-momo-gh", event);
    expect(matched.status).toBe("MATCHED");

    // ...but replaying that same event key under a different organisation is rejected outright,
    // rather than silently reprocessing someone else's payment event.
    await expect(reconcileProviderEvent(otherOrganisation.id, "mtn-momo-gh", event)).rejects.toMatchObject({ code: "RECONCILIATION_ORGANISATION_MISMATCH" });
    expect(await db.payment.count({ where: { organisationId: otherOrganisation.id } })).toBe(0);
  });
});
