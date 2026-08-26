import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { AppError } from "@/platform/errors";

/**
 * Provider-neutral e-signature adapter contract (item 4), matching the same shape as the
 * existing `PaymentProviderAdapter`/channel-adapter registries elsewhere in this codebase: a
 * registry of adapters, each independently reporting whether it is configured, so unconfigured
 * providers still show up (as unavailable) instead of silently disappearing.
 */
export type EnvelopeSigner = { signerReference: string; name: string; email?: string; role: string };

export type CreateEnvelopeRequest = {
  envelopeReference: string;
  documentName: string;
  documentBytesBase64: string;
  signers: EnvelopeSigner[];
  returnUrl?: string;
};

export type CreateEnvelopeResult = {
  providerEnvelopeReference: string;
  signerUrls: Record<string, string>;
  status: "SENT" | "CREATED";
};

export type NormalizedSignatureEvent = {
  eventKey: string;
  providerEnvelopeReference: string;
  signerReference?: string;
  status: "VIEWED" | "SIGNED" | "DECLINED" | "VOIDED";
  occurredAt: Date;
  completedDocumentBase64?: string;
};

export interface ESignatureAdapter {
  readonly key: string;
  readonly displayName: string;
  /** False for the deterministic internal/test adapter: it must never be mistaken for a real, legally-binding signature. */
  readonly legallyBinding: boolean;
  isConfigured(): boolean;
  createEnvelope(request: CreateEnvelopeRequest): Promise<CreateEnvelopeResult>;
  parseEvent(payload: unknown): Promise<NormalizedSignatureEvent>;
  verifyWebhookSignature(rawBody: string, headers: Record<string, string | null>): { verified: boolean; reason?: string };
}

function env(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function safeEqual(expected: string, actual: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Deterministic, credential-free adapter used whenever no real e-signature provider is
 * configured. It is always "configured" (there is nothing to misconfigure) but is explicitly
 * `legallyBinding: false` — signing happens through PropertyOS's own existing internal signature
 * action (`actOnLeaseSignature`), not a certified e-signature vendor, so callers must never
 * present it as a legally-binding signature.
 */
export class InternalTestSignatureAdapter implements ESignatureAdapter {
  readonly key = "INTERNAL";
  readonly displayName = "Internal (non-legal) signing";
  readonly legallyBinding = false;

  isConfigured() {
    return true;
  }

  async createEnvelope(request: CreateEnvelopeRequest): Promise<CreateEnvelopeResult> {
    const providerEnvelopeReference = `internal-envelope-${randomUUID()}`;
    const signerUrls: Record<string, string> = {};
    for (const signer of request.signers) signerUrls[signer.signerReference] = `/leases/${request.envelopeReference}/execution`;
    return { providerEnvelopeReference, signerUrls, status: "SENT" };
  }

  async parseEvent(): Promise<NormalizedSignatureEvent> {
    throw new AppError("ESIGNATURE_WEBHOOK_UNSUPPORTED", 501, "The internal signing adapter has no external webhook; signatures are recorded directly.");
  }

  verifyWebhookSignature(): { verified: boolean; reason?: string } {
    return { verified: false, reason: "not-configured" };
  }
}

/**
 * Provider-neutral REST e-signature adapter. Which certified vendor sits behind
 * `ESIGNATURE_BASE_URL` (or an aggregator unifying several) is an operational/env concern, matching
 * the pattern already used for Ghana payment gateways: `createEnvelope` posts the document and
 * signer list and expects `{ envelopeReference, signerUrls: { [signerReference]: url }, status }`;
 * webhooks are expected to post `{ eventId, envelopeReference, signerReference, status, occurredAt,
 * completedDocumentBase64? }` signed with `x-esignature-signature: sha256=<hmac>`.
 */
export class HttpEnvelopeSignatureAdapter implements ESignatureAdapter {
  readonly key = "HTTP_ENVELOPE";
  readonly displayName = "External e-signature provider";
  readonly legallyBinding = true;

  private credentials() {
    const baseUrl = env("ESIGNATURE_BASE_URL");
    const apiKey = env("ESIGNATURE_API_KEY");
    if (!baseUrl || !apiKey) return null;
    return { baseUrl, apiKey, webhookSecret: env("ESIGNATURE_WEBHOOK_SECRET") };
  }

  isConfigured() {
    return this.credentials() !== null;
  }

  async createEnvelope(request: CreateEnvelopeRequest): Promise<CreateEnvelopeResult> {
    const credentials = this.credentials();
    if (!credentials) throw new AppError("ESIGNATURE_PROVIDER_UNAVAILABLE", 503, "No e-signature provider is configured.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(env("ESIGNATURE_TIMEOUT_MS") ?? "15000"));
    try {
      const response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}/envelopes`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${credentials.apiKey}` },
        body: JSON.stringify({
          externalReference: request.envelopeReference,
          documentName: request.documentName,
          documentBase64: request.documentBytesBase64,
          signers: request.signers,
          returnUrl: request.returnUrl,
        }),
      });
      if (!response.ok) throw new AppError("ESIGNATURE_PROVIDER_ERROR", 502, `The e-signature provider rejected the request with status ${response.status}.`);
      const payload = (await response.json().catch(() => ({}))) as { envelopeReference?: string; signerUrls?: Record<string, string>; status?: string };
      if (!payload.envelopeReference) throw new AppError("ESIGNATURE_PROVIDER_ERROR", 502, "The e-signature provider response was missing an envelope reference.");
      return { providerEnvelopeReference: payload.envelopeReference, signerUrls: payload.signerUrls ?? {}, status: payload.status === "CREATED" ? "CREATED" : "SENT" };
    } finally {
      clearTimeout(timeout);
    }
  }

  async parseEvent(payload: unknown): Promise<NormalizedSignatureEvent> {
    const event = payload as {
      eventId?: string; envelopeReference?: string; signerReference?: string; status?: string; occurredAt?: string; completedDocumentBase64?: string;
    };
    if (!event.envelopeReference || !event.status) {
      throw new AppError("ESIGNATURE_EVENT_INVALID", 422, "The e-signature webhook event is missing required fields.");
    }
    const status = event.status.toUpperCase();
    const normalizedStatus: NormalizedSignatureEvent["status"] =
      status === "SIGNED" || status === "COMPLETED" ? "SIGNED" : status === "DECLINED" ? "DECLINED" : status === "VOIDED" ? "VOIDED" : "VIEWED";
    return {
      eventKey: event.eventId ?? `${event.envelopeReference}:${event.signerReference ?? "envelope"}:${status}`,
      providerEnvelopeReference: event.envelopeReference,
      signerReference: event.signerReference,
      status: normalizedStatus,
      occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
      completedDocumentBase64: event.completedDocumentBase64,
    };
  }

  verifyWebhookSignature(rawBody: string, headers: Record<string, string | null>) {
    const credentials = this.credentials();
    if (!credentials?.webhookSecret) return { verified: false, reason: "not-configured" };
    const header = headers["x-esignature-signature"];
    if (!header) return { verified: false, reason: "missing-signature" };
    const signature = header.replace(/^sha256=/, "");
    const expected = createHmac("sha256", credentials.webhookSecret).update(rawBody).digest("hex");
    return { verified: safeEqual(expected, signature) };
  }
}

export class ESignatureProviderRegistry {
  private readonly adapters = new Map<string, ESignatureAdapter>();

  constructor(adapters: ESignatureAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: ESignatureAdapter) {
    if (this.adapters.has(adapter.key)) throw new Error(`E-signature adapter '${adapter.key}' is already registered.`);
    this.adapters.set(adapter.key, adapter);
    return this;
  }

  get(key: string) {
    const adapter = this.adapters.get(key);
    if (!adapter) throw new AppError("ESIGNATURE_PROVIDER_UNKNOWN", 404, `E-signature adapter '${key}' is not registered.`);
    return adapter;
  }

  list() {
    return [...this.adapters.values()];
  }
}

export const esignatureProviders = new ESignatureProviderRegistry([new InternalTestSignatureAdapter(), new HttpEnvelopeSignatureAdapter()]);
