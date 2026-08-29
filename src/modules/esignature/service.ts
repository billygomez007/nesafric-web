import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { getObjectStorageAdapter } from "@/platform/storage";
import { recordIntegrationOutcome } from "@/modules/integrations/service";
import { esignatureProviders, type ESignatureProviderRegistry } from "./provider";

const json = (value: unknown) => value as Prisma.InputJsonValue;

export function listAvailableESignatureProviders(registry: ESignatureProviderRegistry = esignatureProviders) {
  return registry.list().map((adapter) => ({
    key: adapter.key,
    displayName: adapter.displayName,
    legallyBinding: adapter.legallyBinding,
    available: adapter.isConfigured(),
  }));
}

/**
 * Routes a freshly created batch of `LeaseSignatureRequest` rows through the selected e-signature
 * adapter: for the deterministic internal adapter this is a cheap, local, non-legal operation; for
 * a real provider this creates the external envelope, retrieves signer signing URLs, and persists
 * them. Always emits `signature.request_created` (item 9), regardless of provider.
 */
export async function dispatchSignatureEnvelope(params: {
  organisationId: string;
  leaseId: string;
  documentId: string;
  documentFileKey: string;
  documentFileName: string;
  providerKey: string;
  actorUserId: string;
  signers: Array<{ id: string; signerName: string; signerEmail: string | null; role: string }>;
}) {
  const adapter = esignatureProviders.get(params.providerKey);
  if (!adapter.isConfigured()) throw new AppError("ESIGNATURE_PROVIDER_UNAVAILABLE", 503, `${adapter.displayName} is not configured.`);
  const storageAdapter = getObjectStorageAdapter();
  const stored = await storageAdapter.getObject(params.documentFileKey, "PRIVATE").catch(() => null);
  let result;
  try {
    result = await adapter.createEnvelope({
      envelopeReference: params.leaseId,
      documentName: params.documentFileName,
      documentBytesBase64: stored ? stored.body.toString("base64") : "",
      signers: params.signers.map((signer) => ({ signerReference: signer.id, name: signer.signerName, email: signer.signerEmail ?? undefined, role: signer.role })),
    });
  } catch (error) {
    await recordIntegrationOutcome(params.organisationId, "ESIGNATURE", adapter.key, "FAILURE", error instanceof Error ? error.message : "Envelope creation failed.");
    throw error;
  }
  await recordIntegrationOutcome(params.organisationId, "ESIGNATURE", adapter.key, "SUCCESS");
  return db.$transaction(async (tx) => {
    await tx.leaseExecutionDocument.update({ where: { id: params.documentId }, data: { providerReference: result.providerEnvelopeReference } });
    for (const signer of params.signers) {
      await tx.leaseSignatureRequest.update({
        where: { id: signer.id },
        data: { providerReference: result.providerEnvelopeReference, signingUrl: result.signerUrls[signer.id] ?? null },
      });
    }
    await tx.auditEvent.create({
      data: {
        organisationId: params.organisationId, actorUserId: params.actorUserId, action: "signature.request_created",
        entityType: "lease_execution_document", entityId: params.documentId,
        metadata: json({ providerKey: params.providerKey, envelopeReference: result.providerEnvelopeReference, signerCount: params.signers.length }),
      },
    });
    await tx.domainEvent.create({
      data: {
        organisationId: params.organisationId, name: "signature.request_created", aggregateType: "lease_execution_document", aggregateId: params.documentId,
        payload: json({ providerKey: params.providerKey, envelopeReference: result.providerEnvelopeReference }),
      },
    });
    return result;
  });
}

const allowedTransitions: Record<string, string[]> = {
  PENDING: ["SENT", "VIEWED", "SIGNED", "DECLINED"],
  SENT: ["VIEWED", "SIGNED", "DECLINED"],
  VIEWED: ["SIGNED", "DECLINED"],
};

/**
 * Verified, replay-protected inbound webhook processing (item 4). Idempotency is enforced by the
 * `SignatureProviderEvent` (providerKey, eventKey) ledger, exactly mirroring
 * `PaymentReconciliationEvent`: a redelivered event with the same payload is recognised and never
 * re-applied; the same key with a *different* payload is rejected as a conflict rather than
 * silently trusted.
 */
export async function processSignatureProviderEvent(organisationId: string, providerKey: string, payload: unknown) {
  const adapter = esignatureProviders.get(providerKey);
  const event = await adapter.parseEvent(payload);
  const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const duplicate = await db.signatureProviderEvent.findUnique({ where: { providerKey_eventKey: { providerKey, eventKey: event.eventKey } } });
  if (duplicate) {
    if (duplicate.organisationId !== organisationId) throw new AppError("SIGNATURE_EVENT_ORGANISATION_MISMATCH", 403, "This event belongs to another organisation.");
    if (duplicate.payloadHash !== payloadHash) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "This provider event key was reused with a different payload.");
    return { status: duplicate.status, replay: true as const };
  }

  return db.$transaction(async (tx) => {
    const request = event.signerReference
      ? await tx.leaseSignatureRequest.findFirst({ where: { id: event.signerReference, lease: { organisationId } }, include: { document: true } })
      : await tx.leaseSignatureRequest.findFirst({ where: { providerReference: event.providerEnvelopeReference, lease: { organisationId } }, include: { document: true } });
    if (!request) {
      await tx.signatureProviderEvent.create({ data: { organisationId, providerKey, eventKey: event.eventKey, payloadHash, status: "UNMATCHED" } });
      return { status: "UNMATCHED" as const, replay: false as const };
    }
    if (!allowedTransitions[request.status]?.includes(event.status) || request.document.status !== "SIGNING") {
      await tx.signatureProviderEvent.create({ data: { organisationId, providerKey, eventKey: event.eventKey, payloadHash, signatureRequestId: request.id, status: "MISMATCHED" } });
      return { status: "MISMATCHED" as const, replay: false as const };
    }
    const now = event.occurredAt;
    const nextStatus = event.status as "VIEWED" | "SIGNED" | "DECLINED";
    const updated = await tx.leaseSignatureRequest.update({
      where: { id: request.id },
      data: {
        status: nextStatus,
        viewedAt: event.status === "VIEWED" ? now : request.viewedAt,
        signedAt: event.status === "SIGNED" ? now : request.signedAt,
        declinedAt: event.status === "DECLINED" ? now : request.declinedAt,
      },
    });
    if (event.status === "SIGNED") {
      await tx.auditEvent.create({ data: { organisationId, action: "lease.signed", entityType: "lease_signature", entityId: request.id, metadata: json({ leaseId: request.leaseId, role: request.role, providerKey }) } });
      await tx.domainEvent.create({ data: { organisationId, name: "lease.signed", aggregateType: "lease_signature", aggregateId: request.id, payload: json({ leaseId: request.leaseId, role: request.role }) } });
      await tx.auditEvent.create({ data: { organisationId, action: "signature.completed", entityType: "lease_signature", entityId: request.id, metadata: json({ providerKey }) } });
      await tx.domainEvent.create({ data: { organisationId, name: "signature.completed", aggregateType: "lease_signature", aggregateId: request.id, payload: json({ providerKey }) } });
    }
    const required = await tx.leaseSignatureRequest.findMany({ where: { leaseId: request.leaseId, documentId: request.documentId, required: true } });
    const signedCount = required.filter(({ status }) => status === "SIGNED").length;
    if (signedCount > 0) {
      await tx.lease.update({ where: { id: request.leaseId }, data: { executionStatus: signedCount === required.length ? "FULLY_SIGNED" : "PARTIALLY_SIGNED" } });
    }
    let executedDocument = null;
    if (required.length > 0 && signedCount === required.length) {
      const storageAdapter = getObjectStorageAdapter();
      let finalFileKey = request.document.fileKey;
      if (event.completedDocumentBase64) {
        const bytes = Buffer.from(event.completedDocumentBase64, "base64");
        const safeName = `executed-${request.document.fileName}`;
        finalFileKey = `${organisationId}/GENERATED/LEASE_EXECUTED/${request.leaseId}/${randomUUID()}-${safeName}`;
        await storageAdapter.putObject({ key: finalFileKey, body: bytes, contentType: "application/pdf", classification: "PRIVATE" });
        await tx.storageObject.create({
          data: {
            organisationId, storageKey: finalFileKey, origin: "GENERATED", classification: "PRIVATE",
            targetType: "LEASE_EXECUTION_DOCUMENT", targetId: request.documentId,
            originalFileName: safeName, safeFileName: safeName, contentType: "application/pdf", declaredContentType: "application/pdf",
            sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
            malwareScanStatus: "SKIPPED", malwareScanDetail: "Retrieved directly from the verified e-signature provider callback.",
          },
        });
      }
      executedDocument = await tx.leaseExecutionDocument.update({
        where: { id: request.documentId },
        data: { status: "EXECUTED", executedAt: now, ...(event.completedDocumentBase64 ? { fileKey: finalFileKey } : {}) },
      });
      await tx.auditEvent.create({ data: { organisationId, action: "lease.fully_signed", entityType: "lease", entityId: request.leaseId, metadata: json({ documentId: request.documentId }) } });
      await tx.domainEvent.create({ data: { organisationId, name: "lease.fully_signed", aggregateType: "lease", aggregateId: request.leaseId, payload: json({ documentId: request.documentId }) } });
    }
    await tx.signatureProviderEvent.create({ data: { organisationId, providerKey, eventKey: event.eventKey, payloadHash, signatureRequestId: request.id, status: "MATCHED", processedAt: new Date() } });
    return { status: "MATCHED" as const, replay: false as const, signatureRequest: updated, executedDocument };
  });
}
