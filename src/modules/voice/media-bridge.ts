import { randomBytes } from "crypto";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";

/**
 * Phase 22C item 1/2 — the authenticated, provider-verified real-time media connection for one
 * call. This module is the actual, real, fully-tested "bridge" logic: session issuance,
 * cryptographic-token authentication, frame delivery into the existing Phase 22B pipeline
 * (`submitCallerAudioChunk` → STT → `VoiceStreamingSession` → AI reasoning/tool gateway → TTS),
 * and orphan cleanup. It never creates a second AI/voice domain — every frame that authenticates
 * here is handed straight to the exact same functions Phase 22B already built.
 *
 * What this module deliberately does NOT do: hold a raw WebSocket upgrade. This Next.js version's
 * own docs are explicit that Route Handlers cannot keep a WebSocket connection open
 * (`node_modules/next/dist/docs/01-app/02-guides/backend-for-frontend.md`: "WebSockets won't work
 * because the connection closes on timeout, or after the response is generated."). The actual
 * WebSocket that Twilio's Media Streams connects to must therefore be terminated by a small,
 * separate, always-on process (a standard pattern for Next.js + Twilio Media Streams in
 * production) that decodes each Twilio media-stream message
 * (`parseTwilioMediaStreamMessage` in `provider.ts`) and calls the functions in this module —
 * either directly (if colocated in the same deployment) or through the authenticated HTTP
 * endpoints under `/api/voice/media-stream/*`, which exist specifically so that process never
 * needs direct database access or shared secrets beyond the per-call stream token.
 */

const CONNECT_WINDOW_SECONDS = 120;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 45;

function generateStreamToken() {
  return randomBytes(32).toString("base64url");
}

function unauthorizedStream(): never {
  throw new AppError("VOICE_MEDIA_STREAM_UNAUTHORIZED", 401, "This media stream token is invalid, expired, or already in use.");
}

/**
 * Issues a fresh, single-use, call-bound, organisation-scoped stream token (item 1/2) — never
 * exposed to the caller, only ever handed to the telephony provider (embedded in TwiML) which
 * relays it back to the bridge as the first thing on the new connection. The partial unique index
 * `MediaStreamSession_one_active_per_call` (see the Phase 22C migration) is the actual
 * database-enforced guarantee that at most one `PENDING`/`CONNECTED` session can ever exist for a
 * given call, race-safe under concurrent attempts (item 2's "prevent duplicate active media
 * sessions for one call").
 */
export async function issueMediaStreamToken(callId: string) {
  const call = await db.voiceCall.findUnique({ where: { id: callId }, select: { id: true, organisationId: true, providerKey: true } });
  if (!call) throw notFound();
  const streamToken = generateStreamToken();
  const tokenExpiresAt = new Date(Date.now() + CONNECT_WINDOW_SECONDS * 1000);
  try {
    return await db.mediaStreamSession.create({
      data: { callId: call.id, organisationId: call.organisationId, providerKey: call.providerKey, streamToken, tokenExpiresAt },
    });
  } catch {
    throw new AppError("VOICE_MEDIA_STREAM_ALREADY_ACTIVE", 409, "A media stream is already active or pending for this call.");
  }
}

export type MediaStreamAuthResult = { streamId: string; callId: string; organisationId: string; providerKey: string };

/**
 * Item 2's core security boundary — the ONLY function that resolves which call/organisation a
 * connecting media stream belongs to, driven entirely by the opaque token. Nothing the connecting
 * client claims about its own identity, call, or organisation is ever consulted (item 2: "Never
 * trust organisation/user IDs supplied by the audio client itself. Derive scope from the
 * authenticated/provider-verified call context."). An invalid, expired, or already-consumed token
 * is rejected with the same generic error either way, so a prober cannot distinguish "token never
 * existed" from "token already used" from "token expired."
 */
export async function authenticateMediaStream(streamToken: string, now = new Date()): Promise<MediaStreamAuthResult> {
  const session = await db.mediaStreamSession.findUnique({ where: { streamToken } });
  if (!session || session.status !== "PENDING") unauthorizedStream();
  if (session.tokenExpiresAt < now) {
    await db.mediaStreamSession.updateMany({ where: { id: session.id, status: "PENDING" }, data: { status: "EXPIRED", closedAt: now, disconnectReason: "token_expired" } });
    unauthorizedStream();
  }
  // A second `updateMany` filtered by the still-`PENDING` status (not a plain `update` by id) is
  // the actual race guard: if two connection attempts present the same token simultaneously, only
  // one `updateMany` can ever match a still-`PENDING` row — the loser's `count` is 0.
  const claim = await db.mediaStreamSession.updateMany({ where: { id: session.id, status: "PENDING" }, data: { status: "CONNECTED", connectedAt: now, lastFrameAt: now } });
  if (claim.count !== 1) unauthorizedStream();
  return { streamId: session.id, callId: session.callId, organisationId: session.organisationId, providerKey: session.providerKey };
}

export type MediaFrameInput = { audioChunkBase64?: string; simulatedText?: string; isFinalChunk: boolean };

/**
 * Delivers one authenticated audio frame into the exact Phase 22B pipeline
 * (`submitCallerAudioChunk`) — STT → `VoiceStreamingSession` turn-taking → AI reasoning/tool
 * gateway → TTS — never a parallel implementation. `lastFrameAt` is the heartbeat
 * `sweepOrphanedMediaStreams` uses to detect a dead/orphaned connection (item 12/17).
 *
 * Imports `submitCallerAudioChunk` dynamically to avoid a static circular import with
 * `service.ts` (which statically imports this module to issue tokens/start streams when a call is
 * answered) — a normal, safe pattern here since the import only resolves at call time.
 */
export async function submitMediaStreamFrame(streamToken: string, input: MediaFrameInput, now = new Date()) {
  const session = await db.mediaStreamSession.findUnique({ where: { streamToken } });
  if (!session || session.status !== "CONNECTED") unauthorizedStream();
  await db.mediaStreamSession.update({ where: { id: session.id }, data: { lastFrameAt: now, frameCount: { increment: 1 } } });
  const { submitCallerAudioChunk } = await import("./service");
  return submitCallerAudioChunk(session.callId, { audioChunkBase64: input.audioChunkBase64, simulatedText: input.simulatedText, isFinalChunk: input.isFinalChunk });
}

/** Idempotent close — safe to call twice (a `stop` event racing an HTTP disconnect, for example). */
export async function closeMediaStream(streamToken: string, reason: string, now = new Date()) {
  const session = await db.mediaStreamSession.findUnique({ where: { streamToken } });
  if (!session) throw notFound();
  if (session.status !== "PENDING" && session.status !== "CONNECTED") return session;
  return db.mediaStreamSession.update({ where: { id: session.id }, data: { status: "CLOSED", closedAt: now, disconnectReason: reason } });
}

export async function getMediaStreamByCall(callId: string) {
  return db.mediaStreamSession.findFirst({ where: { callId }, orderBy: { createdAt: "desc" } });
}

/**
 * Orphan/stream-reconnect readiness (item 3/12/17): closes a `PENDING` session whose connect
 * window has passed (the provider never actually opened the socket) and any `CONNECTED` session
 * that has gone quiet for longer than `idleTimeoutSeconds` (a dead/orphaned connection — the
 * provider dropped the socket without sending a `stop` event). Pure with respect to `now`
 * (injectable) so it is fully testable without real elapsed time; safe to run repeatedly as a
 * periodic sweep since every transition only ever moves a row further toward `CLOSED`/`EXPIRED`.
 */
export async function sweepOrphanedMediaStreams(now = new Date(), idleTimeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS) {
  const expiredPending = await db.mediaStreamSession.updateMany({
    where: { status: "PENDING", tokenExpiresAt: { lt: now } },
    data: { status: "EXPIRED", closedAt: now, disconnectReason: "connect_window_expired" },
  });
  const idleCutoff = new Date(now.getTime() - idleTimeoutSeconds * 1000);
  const orphaned = await db.mediaStreamSession.updateMany({
    where: { status: "CONNECTED", lastFrameAt: { lt: idleCutoff } },
    data: { status: "CLOSED", closedAt: now, disconnectReason: "orphaned_no_frames" },
  });
  return { expiredPending: expiredPending.count, orphanedClosed: orphaned.count };
}
