import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createLease } from "@/modules/leases/service";
import {
  actOnLeaseSignature,
  createLeaseDocumentVersion,
  requestLeaseSignatures,
} from "@/modules/lease-execution/service";
import { esignatureProviders, type CreateEnvelopeRequest, type CreateEnvelopeResult, type ESignatureAdapter, type NormalizedSignatureEvent } from "@/modules/esignature/provider";
import { POST as esignatureWebhookRoute } from "@/app/api/webhooks/esignature/[organisationId]/[providerKey]/route";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

/** Deterministic, fully test-controlled e-signature adapter registered once for this suite — simulates a real external provider without any network dependency. */
class TestExternalSignatureAdapter implements ESignatureAdapter {
  readonly key = "TEST_EXTERNAL";
  readonly displayName = "Test external e-signature provider";
  readonly legallyBinding = true;
  configured = true;
  nextEvent: NormalizedSignatureEvent | null = null;
  verifyResult: { verified: boolean; reason?: string } = { verified: true };

  isConfigured() {
    return this.configured;
  }

  async createEnvelope(request: CreateEnvelopeRequest): Promise<CreateEnvelopeResult> {
    const signerUrls: Record<string, string> = {};
    for (const signer of request.signers) signerUrls[signer.signerReference] = `https://esign.example.test/sign/${signer.signerReference}`;
    return { providerEnvelopeReference: `envelope-${request.envelopeReference}`, signerUrls, status: "SENT" };
  }

  async parseEvent(): Promise<NormalizedSignatureEvent> {
    if (!this.nextEvent) throw new Error("Test adapter has no queued event.");
    return this.nextEvent;
  }

  verifyWebhookSignature() {
    return this.verifyResult;
  }
}

const testAdapter = new TestExternalSignatureAdapter();
esignatureProviders.register(testAdapter);

describe("PostgreSQL Phase 19 provider-neutral e-signature adapter", () => {
  beforeEach(async () => {
    await cleanDatabase();
    testAdapter.configured = true;
    testAdapter.verifyResult = { verified: true };
    testAdapter.nextEvent = null;
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("routes requests through the selected adapter, exposes signing URLs, verifies webhooks, prevents replay, and finalises the executed document", async () => {
    const owner = await registerUser({ displayName: "Sign Owner", email: "sign-owner@example.com", password: "secure-password-123" });
    const tenantUser = await registerUser({ displayName: "Sign Tenant", email: "sign-tenant@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Signature Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const ownerMember = await db.organisationMember.findFirstOrThrow({ where: { organisationId: organisation.id, userId: owner.id } });
    const property = await createProperty(owner.id, organisation.id, { name: "Signature House", referenceNumber: "SIGN-001", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
    const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
    const { relationship } = await createTenant(owner.id, organisation.id, { legalName: "Signature Tenant", email: "sign-tenant@example.com", countryCode: "GH" });
    await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });
    const lease = await createLease(owner.id, organisation.id, {
      referenceNumber: "SIGN-LEASE-001", propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id],
      startDate: "2026-09-01", endDate: "2027-08-31", rentAmountMinor: "250000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "DRAFT", documents: [],
    });
    const party = await db.leaseParty.findFirstOrThrow({ where: { leaseId: lease.id } });
    const document = await createLeaseDocumentVersion(owner.id, organisation.id, lease.id, {
      source: "GENERATED", fileKey: "leases/execution/sign-v1.pdf", fileName: "lease-v1.pdf", contentType: "application/pdf",
    });

    // Unconfigured provider rejects the request outright rather than silently falling back.
    testAdapter.configured = false;
    await expect(requestLeaseSignatures(owner.id, organisation.id, lease.id, {
      documentId: document.id, providerKey: "TEST_EXTERNAL",
      signers: [{ role: "ORG_REPRESENTATIVE", organisationMemberId: ownerMember.id }, { role: "TENANT", leasePartyId: party.id }],
    })).rejects.toMatchObject({ code: "ESIGNATURE_PROVIDER_UNAVAILABLE" });
    testAdapter.configured = true;

    const signatures = await requestLeaseSignatures(owner.id, organisation.id, lease.id, {
      documentId: document.id, providerKey: "TEST_EXTERNAL",
      signers: [{ role: "ORG_REPRESENTATIVE", organisationMemberId: ownerMember.id }, { role: "TENANT", leasePartyId: party.id }],
    });
    expect(signatures).toHaveLength(2);
    for (const signature of signatures) {
      expect(signature.providerKey).toBe("TEST_EXTERNAL");
      expect(signature.signingUrl).toBe(`https://esign.example.test/sign/${signature.id}`);
      expect(signature.providerReference).toBe(`envelope-${lease.id}`);
    }
    const documentAfterDispatch = await db.leaseExecutionDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(documentAfterDispatch.providerReference).toBe(`envelope-${lease.id}`);
    expect((await db.domainEvent.findMany({ where: { organisationId: organisation.id, name: "signature.request_created" } })).length).toBe(1);

    const orgSignature = signatures.find((s) => s.role === "ORG_REPRESENTATIVE")!;
    const tenantSignature = signatures.find((s) => s.role === "TENANT")!;

    // Invalid/unverifiable webhook is rejected at the route boundary before any processing.
    testAdapter.verifyResult = { verified: false, reason: "bad-signature" };
    const badRequest = new Request(`https://example.test/api/webhooks/esignature/${organisation.id}/TEST_EXTERNAL`, {
      method: "POST", body: JSON.stringify({ eventId: "evt-bad", envelopeReference: `envelope-${lease.id}`, signerReference: orgSignature.id, status: "SIGNED" }),
    });
    const badResponse = await esignatureWebhookRoute(badRequest, { params: Promise.resolve({ organisationId: organisation.id, providerKey: "TEST_EXTERNAL" }) });
    expect(badResponse.status).toBe(401);
    expect((await db.leaseSignatureRequest.findUniqueOrThrow({ where: { id: orgSignature.id } })).status).toBe("SENT");
    testAdapter.verifyResult = { verified: true };

    // Verified SIGNED webhook for the first signer.
    testAdapter.nextEvent = { eventKey: "evt-1", providerEnvelopeReference: `envelope-${lease.id}`, signerReference: orgSignature.id, status: "SIGNED", occurredAt: new Date("2026-08-01T10:00:00Z") };
    const goodRequest = () => new Request(`https://example.test/api/webhooks/esignature/${organisation.id}/TEST_EXTERNAL`, {
      method: "POST", body: JSON.stringify({ eventId: "evt-1", envelopeReference: `envelope-${lease.id}`, signerReference: orgSignature.id, status: "SIGNED" }),
    });
    const firstResponse = await esignatureWebhookRoute(goodRequest(), { params: Promise.resolve({ organisationId: organisation.id, providerKey: "TEST_EXTERNAL" }) });
    expect(firstResponse.status).toBe(200);
    expect((await firstResponse.json()).status).toBe("MATCHED");
    expect((await db.leaseSignatureRequest.findUniqueOrThrow({ where: { id: orgSignature.id } })).status).toBe("SIGNED");
    expect(await db.lease.findUniqueOrThrow({ where: { id: lease.id } }).then((l) => l.executionStatus)).toBe("PARTIALLY_SIGNED");

    // Replaying the exact same event is idempotent (never re-applied).
    const replayResponse = await esignatureWebhookRoute(goodRequest(), { params: Promise.resolve({ organisationId: organisation.id, providerKey: "TEST_EXTERNAL" }) });
    expect(replayResponse.status).toBe(200);
    expect((await replayResponse.json()).replay).toBe(true);
    expect(await db.signatureProviderEvent.count({ where: { organisationId: organisation.id, eventKey: "evt-1" } })).toBe(1);

    // Reusing the same event key with a different payload is rejected as a conflict, not silently trusted.
    testAdapter.nextEvent = { eventKey: "evt-1", providerEnvelopeReference: `envelope-${lease.id}`, signerReference: tenantSignature.id, status: "SIGNED", occurredAt: new Date() };
    const conflictRequest = new Request(`https://example.test/api/webhooks/esignature/${organisation.id}/TEST_EXTERNAL`, {
      method: "POST", body: JSON.stringify({ eventId: "evt-1", envelopeReference: `envelope-${lease.id}`, signerReference: tenantSignature.id, status: "SIGNED" }),
    });
    const conflictResponse = await esignatureWebhookRoute(conflictRequest, { params: Promise.resolve({ organisationId: organisation.id, providerKey: "TEST_EXTERNAL" }) });
    expect(conflictResponse.status).toBe(409);

    // Final signer completes the envelope: the executed document is finalised with the provider's returned bytes.
    const completedPdf = Buffer.from("%PDF-1.4\n%final-executed-bytes\n");
    testAdapter.nextEvent = {
      eventKey: "evt-2", providerEnvelopeReference: `envelope-${lease.id}`, signerReference: tenantSignature.id, status: "SIGNED",
      occurredAt: new Date("2026-08-02T10:00:00Z"), completedDocumentBase64: completedPdf.toString("base64"),
    };
    const finalRequest = new Request(`https://example.test/api/webhooks/esignature/${organisation.id}/TEST_EXTERNAL`, {
      method: "POST", body: JSON.stringify({ eventId: "evt-2", envelopeReference: `envelope-${lease.id}`, signerReference: tenantSignature.id, status: "SIGNED" }),
    });
    const finalResponse = await esignatureWebhookRoute(finalRequest, { params: Promise.resolve({ organisationId: organisation.id, providerKey: "TEST_EXTERNAL" }) });
    expect(finalResponse.status).toBe(200);
    const finalDocument = await db.leaseExecutionDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(finalDocument.status).toBe("EXECUTED");
    expect(finalDocument.fileKey).not.toBe("leases/execution/sign-v1.pdf");
    const executedStorageObject = await db.storageObject.findUniqueOrThrow({ where: { storageKey: finalDocument.fileKey } });
    expect(executedStorageObject.sha256).toBe(createHash("sha256").update(completedPdf).digest("hex"));
    expect(await db.lease.findUniqueOrThrow({ where: { id: lease.id } }).then((l) => l.executionStatus)).toBe("FULLY_SIGNED");

    // signature.completed / lease.fully_signed events (item 9).
    const eventNames = (await db.domainEvent.findMany({ where: { organisationId: organisation.id, name: { in: ["signature.completed", "lease.fully_signed", "lease.signed"] } } })).map(({ name }) => name);
    expect(eventNames).toContain("signature.completed");
    expect(eventNames).toContain("lease.fully_signed");

    // The pre-existing internal signing path (Phase 11) is fully preserved for INTERNAL-provider requests.
    const secondLease = await createLease(owner.id, organisation.id, {
      referenceNumber: "SIGN-LEASE-002", propertyId: property.id, tenantOrganisationIds: [relationship.id],
      startDate: "2026-10-01", endDate: "2027-09-30", rentAmountMinor: "200000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "DRAFT", documents: [],
    });
    const secondParty = await db.leaseParty.findFirstOrThrow({ where: { leaseId: secondLease.id } });
    const secondDocument = await createLeaseDocumentVersion(owner.id, organisation.id, secondLease.id, {
      source: "GENERATED", fileKey: "leases/execution/internal-v1.pdf", fileName: "internal-v1.pdf", contentType: "application/pdf",
    });
    const internalSignatures = await requestLeaseSignatures(owner.id, organisation.id, secondLease.id, {
      documentId: secondDocument.id,
      signers: [{ role: "ORG_REPRESENTATIVE", organisationMemberId: ownerMember.id }, { role: "TENANT", leasePartyId: secondParty.id }],
    });
    expect(internalSignatures.every((s) => s.providerKey === "INTERNAL")).toBe(true);
    await actOnLeaseSignature(owner.id, organisation.id, secondLease.id, internalSignatures.find((s) => s.role === "ORG_REPRESENTATIVE")!.id, { status: "SIGNED" });
    await actOnLeaseSignature(tenantUser.id, organisation.id, secondLease.id, internalSignatures.find((s) => s.role === "TENANT")!.id, { status: "SIGNED" });
    expect(await db.leaseExecutionDocument.findUniqueOrThrow({ where: { id: secondDocument.id } }).then((d) => d.status)).toBe("EXECUTED");
  });
});
