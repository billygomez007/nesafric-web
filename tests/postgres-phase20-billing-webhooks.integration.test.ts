import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createManualPayment } from "@/modules/payments/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createLease } from "./helpers/lease";
import { generateRentSchedule } from "@/modules/rent-schedules/service";
import { ensureBillingSubscriptionRef } from "@/modules/billing/service";
import { billingProviders } from "@/modules/billing/gateways";
import { processBillingWebhookEvent } from "@/modules/subscriptions/lifecycle";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

function signedHeaders(secret: string, body: string) {
  return { "x-billing-signature": createHmac("sha256", secret).update(body).digest("hex") };
}

describe("PostgreSQL Phase 20 SaaS billing (provider-neutral, isolated from tenant rent payments)", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("verifies the deterministic test adapter's webhook signature (fail-closed) without any configured credential", () => {
    const adapter = billingProviders.get("test");
    expect(adapter.isConfigured()).toBe(true);
    expect(adapter.verifyWebhookSignature("{}", {})).toMatchObject({ verified: false, reason: "missing-signature" });
    expect(adapter.verifyWebhookSignature("{}", { "x-billing-signature": "deadbeef" })).toMatchObject({ verified: false });
    const body = JSON.stringify({ eventId: "evt_sig", eventType: "INVOICE_PAID", subscriptionRef: "sub_test_x" });
    expect(adapter.verifyWebhookSignature(body, signedHeaders("nesafric-test-billing-webhook-secret", body))).toMatchObject({ verified: true });
  });

  it("fails closed for the configured HTTP adapter when no webhook secret is set (never trusts an unverifiable payload)", () => {
    const adapter = billingProviders.get("http");
    expect(adapter.isConfigured()).toBe(false);
    expect(adapter.verifyWebhookSignature("{}", { "x-billing-signature": "anything" })).toMatchObject({ verified: false, reason: "not-configured" });
  });

  it("processes a verified billing webhook idempotently, and a replay returns the cached outcome instead of re-applying it", async () => {
    const owner = await registerUser({ displayName: "Billing Owner", email: "billing-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Billing Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const withRef = await ensureBillingSubscriptionRef(organisation.id);
    expect(withRef.billingCustomerRef).toMatch(/^cus_test_/);
    expect(withRef.billingSubscriptionRef).toMatch(/^sub_test_/);

    const payload = { eventId: "evt_paid_1", eventType: "INVOICE_PAID", customerRef: withRef.billingCustomerRef, subscriptionRef: withRef.billingSubscriptionRef, providerInvoiceRef: "inv_paid_1", amountMinor: "25000", currencyCode: "GHS", occurredAt: new Date().toISOString() };
    const result = await processBillingWebhookEvent("test", payload);
    expect(result.status).toBe("PROCESSED");
    const activated = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id } });
    expect(activated.status).toBe("ACTIVE");
    expect(await db.subscriptionStatusHistory.count({ where: { organisationId: organisation.id, toStatus: "ACTIVE" } })).toBe(1);
    expect(await db.billingWebhookEvent.count({ where: { providerKey: "test", eventKey: "evt_paid_1" } })).toBe(1);

    // Replay: identical payload returns the cached record and never re-applies the transition.
    const replay = await processBillingWebhookEvent("test", payload);
    expect(replay.id).toBe(result.id);
    expect(await db.billingWebhookEvent.count({ where: { providerKey: "test", eventKey: "evt_paid_1" } })).toBe(1);
    expect(await db.subscriptionStatusHistory.count({ where: { organisationId: organisation.id, toStatus: "ACTIVE" } })).toBe(1);

    // The same event key with a different payload is a hard conflict, never silently applied.
    await expect(processBillingWebhookEvent("test", { ...payload, amountMinor: "99999" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("records an unmatched webhook durably when no subscription references the event's subscription ref, without changing any subscription", async () => {
    const owner = await registerUser({ displayName: "Unmatched Owner", email: "unmatched-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Unmatched Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const before = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id } });

    const payload = { eventId: "evt_unmatched_1", eventType: "INVOICE_PAID", subscriptionRef: "sub_test_does_not_exist", amountMinor: "25000", currencyCode: "GHS" };
    const result = await processBillingWebhookEvent("test", payload);
    expect(result.status).toBe("UNMATCHED");
    expect(result.organisationId).toBeNull();
    const after = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id } });
    expect(after.status).toBe(before.status);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("applies an INVOICE_FAILED event to move an active subscription to past due", async () => {
    const owner = await registerUser({ displayName: "Failed Invoice Owner", email: "failed-invoice-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Failed Invoice Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const withRef = await ensureBillingSubscriptionRef(organisation.id);
    await processBillingWebhookEvent("test", { eventId: "evt_activate", eventType: "INVOICE_PAID", subscriptionRef: withRef.billingSubscriptionRef, amountMinor: "25000", currencyCode: "GHS" });

    const failurePayload = { eventId: "evt_fail_1", eventType: "INVOICE_FAILED", subscriptionRef: withRef.billingSubscriptionRef, failureReason: "Card expired" };
    const failed = await processBillingWebhookEvent("test", failurePayload);
    expect(failed.status).toBe("PROCESSED");
    const subscription = await db.organisationSubscription.findUniqueOrThrow({ where: { organisationId: organisation.id } });
    expect(subscription.status).toBe("PAST_DUE");
    expect(await db.subscriptionInvoice.count({ where: { organisationId: organisation.id, status: "FAILED", failureReason: "Card expired" } })).toBe(1);
  });

  it("keeps SaaS billing entirely isolated from tenant rent-collection payments", async () => {
    const owner = await registerUser({ displayName: "Isolation Owner", email: "isolation-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Isolation Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const property = await createProperty(owner.id, organisation.id, { name: "Isolation House", referenceNumber: "ISO-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const { relationship } = await createTenant(owner.id, organisation.id, { legalName: "Isolation Tenant", email: "isolation-tenant@example.com", countryCode: "GH" });
    const lease = await createLease(owner.id, organisation.id, {
      referenceNumber: "ISO-LEASE-001", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id],
      startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "150000", depositAmountMinor: "150000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "ACTIVE",
    });
    await generateRentSchedule(owner.id, organisation.id, lease.id, 1);
    const [obligation] = await db.rentObligation.findMany({ where: { leaseId: lease.id } });
    // A real tenant rent payment...
    await createManualPayment(owner.id, organisation.id, {
      tenantOrganisationId: relationship.id, leaseId: lease.id, amountMinor: "150000", currencyCode: "GHS", paidAt: "2026-01-05T10:00:00Z",
      method: "CASH", externalReference: "iso-cash-1", evidenceReference: "evidence/iso-cash-1.jpg", idempotencyKey: "iso-manual-1", allocations: [{ rentObligationId: obligation.id, amountMinor: "150000" }],
    });
    // ...and a real SaaS billing charge for the same organisation.
    const withRef = await ensureBillingSubscriptionRef(organisation.id);
    await processBillingWebhookEvent("test", { eventId: "evt_isolation", eventType: "INVOICE_PAID", subscriptionRef: withRef.billingSubscriptionRef, amountMinor: "25000", currencyCode: "GHS" });

    // Tenant rent tables are completely untouched by the SaaS billing charge.
    expect(await db.payment.count({ where: { organisationId: organisation.id } })).toBe(1);
    expect(await db.paymentIntent.count({ where: { organisationId: organisation.id } })).toBe(0);
    // SaaS billing tables are completely untouched by the tenant rent payment.
    expect(await db.subscriptionInvoice.count({ where: { organisationId: organisation.id } })).toBe(1);
    expect(await db.billingWebhookEvent.count({ where: { organisationId: organisation.id } })).toBe(1);
    // The provider registries themselves are separate — billing providers never appear as payment providers and vice versa.
    expect(() => billingProviders.get("mtn-momo-gh")).toThrow();
  });
});
