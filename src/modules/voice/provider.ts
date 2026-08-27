import { createHmac, randomUUID } from "crypto";
import { AppError } from "@/platform/errors";

/**
 * Provider-neutral telephony adapter contract (item 1). Which real vendor (Twilio, Africa's
 * Talking, Vonage, ...) sits behind a given `providerKey` is an operational/credentials concern,
 * never a code concern — every voice orchestration function in `service.ts` talks to this
 * interface only, exactly as `PaymentProviderAdapter`/`GeocodingAdapter` already do for their
 * domains. No production telephony credentials exist in this environment, so `MockVoiceProviderAdapter`
 * remains the only adapter ever *selected* (see `getActiveVoiceProviderKey`); `TwilioVoiceProviderAdapter`
 * (Phase 22B item 1) is registered alongside it and implements the same interface against real
 * credentials, but is inert (`isConfigured()` false) until an operator supplies them.
 */
export type OutboundCallRequest = {
  toNumber: string;
  fromNumber: string;
  metadata?: Record<string, string>;
};

export type ProviderCallResult =
  | { status: "QUEUED"; providerCallId: string }
  | { status: "FAILED"; providerCallId: string; failureReason: string };

export type CallControlResult =
  | { status: "OK" }
  | { status: "FAILED"; failureReason: string };

/** What a given provider adapter can actually do (Phase 22B item 1) — read by UI/settings to
 * avoid offering a capability (e.g. "transfer") the active provider cannot perform. */
export type VoiceProviderCapabilities = {
  mediaStreaming: boolean;
  dtmf: boolean;
  transfer: boolean;
  recording: boolean;
};

export interface VoiceProviderAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly capabilities: VoiceProviderCapabilities;
  isConfigured(): boolean;
  placeOutboundCall(request: OutboundCallRequest): Promise<ProviderCallResult>;
  /** Explicitly answer an already-ringing inbound call (item 1's "call answer"). */
  answerCall(providerCallId: string): Promise<CallControlResult>;
  /** Explicitly terminate an in-progress call (item 1's "call termination"). */
  terminateCall(providerCallId: string, reason?: string): Promise<CallControlResult>;
  /** Bridge an in-progress call to a human number (item 1's "call transfer readiness" / item 8). */
  transferCall(providerCallId: string, toNumber: string): Promise<CallControlResult>;
  /** Send DTMF tones on an in-progress call (item 1's "DTMF readiness"). */
  sendDigits(providerCallId: string, digits: string): Promise<CallControlResult>;
  /**
   * Phase 22C item 1 — instructs the provider to open a real-time, bidirectional media stream for
   * an in-progress call to `streamUrl` (the deployed media-bridge process's `wss://` endpoint),
   * carrying `streamToken` so the bridge can authenticate the connection without trusting anything
   * the audio client itself claims (item 2). A no-op success for adapters that have nowhere to
   * stream to yet (the mock transport never has real audio).
   */
  startMediaStream(providerCallId: string, streamUrl: string, streamToken: string): Promise<CallControlResult>;
  /**
   * Verify an inbound webhook actually originated from this provider. Adapters with no signing
   * secret configured return `{ verified: false, reason: "not-configured" }` rather than
   * throwing — mirrors `PaymentProviderAdapter.verifyWebhookSignature`.
   */
  verifyWebhookSignature(rawBody: string, headers: Record<string, string | null>): { verified: boolean; reason?: string };
  /** Normalizes this provider's own webhook payload shape (JSON for the mock transport, form-encoded
   * for Twilio) into the one common event shape `ingestProviderWebhook` operates on, so that
   * function stays provider-neutral rather than assuming one wire format. */
  normalizeWebhookPayload(rawBody: string): WebhookEvent | null;
}

export type WebhookEvent = { externalEventId: string; type: string; providerCallId: string; status?: string; durationSeconds?: number };

function env(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Deterministic, credential-free transport used whenever no real telephony provider is
 * configured (item 1: "If no production credentials exist, use a deterministic test/mock
 * transport"). Every call it "places" resolves synchronously and deterministically — never a
 * real ring, never real audio — so orchestration logic and tests can rely on it completely.
 *
 * A `toNumber` beginning with the reserved prefix `+000` is a deliberate, documented failure
 * trigger (item 19/20's "provider outage" test) — this is the only way this adapter ever fails.
 */
export class MockVoiceProviderAdapter implements VoiceProviderAdapter {
  readonly key = "MOCK";
  readonly displayName = "Deterministic test transport";
  readonly capabilities: VoiceProviderCapabilities = { mediaStreaming: true, dtmf: true, transfer: true, recording: true };

  isConfigured() {
    return true;
  }

  async placeOutboundCall(request: OutboundCallRequest): Promise<ProviderCallResult> {
    const providerCallId = `mock_${randomUUID()}`;
    if (request.toNumber.startsWith("+000")) {
      return { status: "FAILED", providerCallId, failureReason: "Simulated provider outage (deterministic +000 test trigger)." };
    }
    return { status: "QUEUED", providerCallId };
  }

  async answerCall(): Promise<CallControlResult> {
    return { status: "OK" };
  }

  /** Deterministic failure trigger: a `providerCallId` ending in `_unreachable` (tests only ever
   * construct this by appending the suffix themselves) simulates a provider that can no longer
   * reach the call — mirrors the `+000` outbound-outage convention. */
  async terminateCall(providerCallId: string): Promise<CallControlResult> {
    if (providerCallId.endsWith("_unreachable")) return { status: "FAILED", failureReason: "Simulated provider outage: call no longer reachable." };
    return { status: "OK" };
  }

  async transferCall(providerCallId: string, toNumber: string): Promise<CallControlResult> {
    if (providerCallId.endsWith("_unreachable")) return { status: "FAILED", failureReason: "Simulated provider outage: call no longer reachable." };
    if (toNumber.startsWith("+000")) return { status: "FAILED", failureReason: "Simulated transfer-target outage (deterministic +000 test trigger)." };
    return { status: "OK" };
  }

  async sendDigits(providerCallId: string, digits: string): Promise<CallControlResult> {
    if (providerCallId.endsWith("_unreachable")) return { status: "FAILED", failureReason: "Simulated provider outage: call no longer reachable." };
    if (digits === "FAIL") return { status: "FAILED", failureReason: "Simulated DTMF-send failure (deterministic 'FAIL' test trigger)." };
    return { status: "OK" };
  }

  async startMediaStream(providerCallId: string): Promise<CallControlResult> {
    if (providerCallId.endsWith("_unreachable")) return { status: "FAILED", failureReason: "Simulated provider outage: call no longer reachable." };
    return { status: "OK" };
  }

  private secret() {
    return env("VOICE_MOCK_WEBHOOK_SECRET") ?? "mock-voice-webhook-secret";
  }

  verifyWebhookSignature(rawBody: string, headers: Record<string, string | null>) {
    const provided = headers["x-voice-signature"];
    if (!provided) return { verified: false, reason: "missing-signature" };
    const expected = createHmac("sha256", this.secret()).update(rawBody).digest("hex");
    return { verified: provided === expected };
  }

  normalizeWebhookPayload(rawBody: string): WebhookEvent | null {
    try {
      const payload = JSON.parse(rawBody) as Partial<WebhookEvent>;
      if (!payload.externalEventId || !payload.type || !payload.providerCallId) return null;
      return { externalEventId: payload.externalEventId, type: payload.type, providerCallId: payload.providerCallId, status: payload.status, durationSeconds: payload.durationSeconds };
    } catch {
      return null;
    }
  }

  /** Test/tooling helper: compute the signature header a real caller would send. */
  signPayload(rawBody: string) {
    return createHmac("sha256", this.secret()).update(rawBody).digest("hex");
  }
}

// ---------------------------------------------------------------------------
// Real production telephony adapter (Phase 22B item 1). Twilio's REST API is used directly via
// `fetch` (no vendor SDK dependency) so the adapter stays a thin, auditable translation layer —
// exactly the same shape as `MockVoiceProviderAdapter`, just backed by real HTTP calls. Every
// method that would reach Twilio is gated behind `isConfigured()`; without `TWILIO_ACCOUNT_SID`/
// `TWILIO_AUTH_TOKEN` this adapter is registered but never selected (see `getActiveVoiceProviderKey`),
// so the application still operates fully in mock mode with zero credentials, per item 1.
// ---------------------------------------------------------------------------

function twilioConfig() {
  const accountSid = env("TWILIO_ACCOUNT_SID");
  const authToken = env("TWILIO_AUTH_TOKEN");
  if (!accountSid || !authToken) return undefined;
  return { accountSid, authToken, apiBaseUrl: env("TWILIO_API_BASE_URL") ?? "https://api.twilio.com" };
}

/** Pure request-construction, exported so item 19's "real-adapter request construction" test can
 * assert the exact outbound HTTP shape without any network access or real credentials. */
export function buildTwilioCallRequest(config: { accountSid: string; authToken: string; apiBaseUrl: string }, request: OutboundCallRequest, statusCallbackUrl: string) {
  const url = `${config.apiBaseUrl}/2010-04-01/Accounts/${config.accountSid}/Calls.json`;
  const body = new URLSearchParams({
    To: request.toNumber,
    From: request.fromNumber,
    Twiml: `<Response><Say>${escapeTwiml("Please hold while we connect your call.")}</Say></Response>`,
    StatusCallback: statusCallbackUrl,
    StatusCallbackEvent: "initiated ringing answered completed",
    StatusCallbackMethod: "POST",
  });
  const headers = { authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" };
  return { url, method: "POST" as const, headers, body: body.toString() };
}

function escapeTwiml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Twilio's own X-Twilio-Signature algorithm: base64(HMAC-SHA1(authToken, url + sorted-concatenated-params)). */
export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

/**
 * Phase 22C item 1 — Twilio's real-time media-streaming mechanism is the `<Connect><Stream>` TwiML
 * verb: it opens a bidirectional WebSocket from Twilio's media servers to `streamUrl`, carrying
 * `<Parameter>` values as the connection's first `start` event payload, which is exactly how the
 * bridge authenticates the connection to a `streamToken` (item 2) without ever trusting a
 * caller/organisation id supplied over the socket itself. Pure and exported so item 16's "real-
 * adapter request construction" style tests can assert the exact TwiML without any network access.
 */
export function buildTwilioMediaStreamTwiml(streamUrl: string, streamToken: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${escapeTwiml(streamUrl)}"><Parameter name="token" value="${escapeTwiml(streamToken)}"/></Stream></Connect></Response>`;
}

/** The safe fallback TwiML used whenever live media streaming cannot be offered (no
 * `mediaStreamWsUrl` configured, or STT/TTS not actually configured) — item 4's "fail safely...
 * do not pretend that live AI voice is operational." A caller always at least reaches a human
 * queue rather than dead air. */
export function buildTwilioFallbackTwiml(message: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeTwiml(message)}</Say></Response>`;
}

// ---------------------------------------------------------------------------
// Twilio Media Streams WebSocket protocol (item 1/3) — the JSON message shapes Twilio's real-time
// audio connection sends/expects, documented at Twilio's own Media Streams reference. These are
// pure parse/encode functions so the protocol-level integration work is fully unit-testable
// without a live socket, independent of whichever process actually terminates the WebSocket
// (see `media-bridge.ts`'s module doc comment for why that process cannot be a Next.js route
// handler in this codebase).
// ---------------------------------------------------------------------------

export type TwilioMediaStreamMessage =
  | { event: "connected" }
  | { event: "start"; streamSid: string; callSid: string; customParameters: Record<string, string> }
  | { event: "media"; streamSid: string; payloadBase64: string }
  | { event: "stop"; streamSid: string }
  | { event: "mark"; streamSid: string; name: string };

export function parseTwilioMediaStreamMessage(raw: string): TwilioMediaStreamMessage | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const event = parsed.event;
  if (event === "connected") return { event: "connected" };
  if (event === "start") {
    const start = parsed.start as Record<string, unknown> | undefined;
    if (typeof start?.streamSid !== "string" || typeof start?.callSid !== "string") return null;
    const customParameters = (start.customParameters && typeof start.customParameters === "object" ? start.customParameters : {}) as Record<string, string>;
    return { event: "start", streamSid: start.streamSid, callSid: start.callSid, customParameters };
  }
  if (event === "media") {
    const media = parsed.media as Record<string, unknown> | undefined;
    if (typeof parsed.streamSid !== "string" || typeof media?.payload !== "string") return null;
    return { event: "media", streamSid: parsed.streamSid, payloadBase64: media.payload };
  }
  if (event === "stop") {
    if (typeof parsed.streamSid !== "string") return null;
    return { event: "stop", streamSid: parsed.streamSid };
  }
  if (event === "mark") {
    const mark = parsed.mark as Record<string, unknown> | undefined;
    if (typeof parsed.streamSid !== "string" || typeof mark?.name !== "string") return null;
    return { event: "mark", streamSid: parsed.streamSid, name: mark.name };
  }
  return null;
}

/** Encodes an outbound "play this audio to the caller" message in Twilio's expected shape. */
export function buildTwilioMediaStreamOutboundMessage(streamSid: string, audioPayloadBase64: string) {
  return JSON.stringify({ event: "media", streamSid, media: { payload: audioPayloadBase64 } });
}

/** Encodes a "clear any buffered/queued audio" message — the wire-level mechanism behind
 * stopping TTS playback the instant a caller barges in (item 3). */
export function buildTwilioMediaStreamClearMessage(streamSid: string) {
  return JSON.stringify({ event: "clear", streamSid });
}

export class TwilioVoiceProviderAdapter implements VoiceProviderAdapter {
  readonly key = "TWILIO";
  readonly displayName = "Twilio";
  readonly capabilities: VoiceProviderCapabilities = { mediaStreaming: true, dtmf: true, transfer: true, recording: true };

  isConfigured() {
    return Boolean(twilioConfig());
  }

  private requireConfig() {
    const config = twilioConfig();
    if (!config) throw new AppError("VOICE_PROVIDER_NOT_CONFIGURED", 422, "Twilio credentials (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN) are not configured.");
    return config;
  }

  async placeOutboundCall(request: OutboundCallRequest): Promise<ProviderCallResult> {
    const config = this.requireConfig();
    const statusCallbackUrl = `${env("APP_BASE_URL") ?? ""}/api/webhooks/voice/${this.key}`;
    const built = buildTwilioCallRequest(config, request, statusCallbackUrl);
    const providerCallId = `twilio_pending_${randomUUID()}`;
    try {
      const response = await fetch(built.url, { method: built.method, headers: built.headers, body: built.body });
      if (!response.ok) return { status: "FAILED", providerCallId, failureReason: `Twilio returned HTTP ${response.status}.` };
      const payload = (await response.json()) as { sid?: string };
      return { status: "QUEUED", providerCallId: payload.sid ?? providerCallId };
    } catch (error) {
      return { status: "FAILED", providerCallId, failureReason: error instanceof Error ? error.message : "Twilio request failed." };
    }
  }

  private async updateCall(providerCallId: string, params: Record<string, string>): Promise<CallControlResult> {
    const config = this.requireConfig();
    try {
      const response = await fetch(`${config.apiBaseUrl}/2010-04-01/Accounts/${config.accountSid}/Calls/${providerCallId}.json`, {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
      });
      if (!response.ok) return { status: "FAILED", failureReason: `Twilio returned HTTP ${response.status}.` };
      return { status: "OK" };
    } catch (error) {
      return { status: "FAILED", failureReason: error instanceof Error ? error.message : "Twilio request failed." };
    }
  }

  async answerCall(providerCallId: string): Promise<CallControlResult> {
    return this.updateCall(providerCallId, { Status: "in-progress" });
  }

  async terminateCall(providerCallId: string): Promise<CallControlResult> {
    return this.updateCall(providerCallId, { Status: "completed" });
  }

  async transferCall(providerCallId: string, toNumber: string): Promise<CallControlResult> {
    return this.updateCall(providerCallId, { Twiml: `<Response><Dial>${escapeTwiml(toNumber)}</Dial></Response>` });
  }

  async sendDigits(providerCallId: string, digits: string): Promise<CallControlResult> {
    return this.updateCall(providerCallId, { Twiml: `<Response><Play digits="${escapeTwiml(digits)}"/></Response>` });
  }

  async startMediaStream(providerCallId: string, streamUrl: string, streamToken: string): Promise<CallControlResult> {
    return this.updateCall(providerCallId, { Twiml: buildTwilioMediaStreamTwiml(streamUrl, streamToken) });
  }

  verifyWebhookSignature(rawBody: string, headers: Record<string, string | null>) {
    const config = twilioConfig();
    if (!config) return { verified: false, reason: "not-configured" };
    const provided = headers["x-twilio-signature"];
    if (!provided) return { verified: false, reason: "missing-signature" };
    const params = Object.fromEntries(new URLSearchParams(rawBody));
    const url = `${env("APP_BASE_URL") ?? ""}/api/webhooks/voice/${this.key}`;
    const expected = computeTwilioSignature(config.authToken, url, params);
    return { verified: provided === expected };
  }

  private static readonly STATUS_MAP: Record<string, string> = {
    ringing: "call.ringing",
    "in-progress": "call.answered",
    "no-answer": "call.no_answer",
    busy: "call.busy",
    completed: "call.completed",
    failed: "call.failed",
    canceled: "call.canceled",
  };

  normalizeWebhookPayload(rawBody: string): WebhookEvent | null {
    const params = Object.fromEntries(new URLSearchParams(rawBody));
    const callSid = params.CallSid;
    const callStatus = params.CallStatus;
    if (!callSid || !callStatus) return null;
    const type = TwilioVoiceProviderAdapter.STATUS_MAP[callStatus] ?? `call.${callStatus}`;
    // Twilio does not send its own event-id header; a callSid+status pair is stable across a
    // provider retry of the *same* status transition (its own idempotency guarantee for a given
    // callback), which is exactly what `[providerKey, externalEventId]` needs for replay dedupe.
    const externalEventId = `${callSid}:${callStatus}`;
    const durationSeconds = params.CallDuration ? Number(params.CallDuration) : undefined;
    return { externalEventId, type, providerCallId: callSid, status: callStatus, durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined };
  }
}

export class VoiceProviderRegistry {
  private readonly adapters = new Map<string, VoiceProviderAdapter>();

  constructor(adapters: VoiceProviderAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: VoiceProviderAdapter) {
    if (this.adapters.has(adapter.key)) throw new Error(`Voice provider adapter '${adapter.key}' is already registered.`);
    this.adapters.set(adapter.key, adapter);
    return this;
  }

  get(key: string) {
    const adapter = this.adapters.get(key);
    if (!adapter) throw new AppError("VOICE_PROVIDER_UNKNOWN", 404, `Voice provider adapter '${key}' is not registered.`);
    return adapter;
  }

  list() {
    return [...this.adapters.values()];
  }
}

export const voiceProviders = new VoiceProviderRegistry([new MockVoiceProviderAdapter(), new TwilioVoiceProviderAdapter()]);

/** Whether any real (non-mock) telephony credentials are configured in this environment, for the
 * specific provider named by `VOICE_PROVIDER_KEY` (default `TWILIO`, the only real adapter
 * currently registered). Selecting the provider through configuration (item 1) rather than
 * hard-coding which vendor is "the" real one. */
export function isRealVoiceProviderConfigured() {
  const key = env("VOICE_PROVIDER_KEY");
  if (!key || key === "MOCK") return false;
  try {
    return voiceProviders.get(key).isConfigured();
  } catch {
    return false;
  }
}

/** The provider key that should be used for new calls right now — always `MOCK` unless an
 * operator has both selected a real provider via `VOICE_PROVIDER_KEY` *and* that adapter reports
 * itself configured (real credentials present). No credentials are ever invented (item 1). */
export function getActiveVoiceProviderKey() {
  const key = env("VOICE_PROVIDER_KEY") ?? "MOCK";
  return isRealVoiceProviderConfigured() ? key : "MOCK";
}

/** Test/tooling helper: sign a webhook body exactly as a real `MOCK`-provider caller would, so
 * tests can exercise `ingestProviderWebhook`'s signature verification without reaching into the
 * registry's adapter instance directly. */
export function signMockVoiceWebhook(rawBody: string) {
  return (voiceProviders.get("MOCK") as MockVoiceProviderAdapter).signPayload(rawBody);
}
