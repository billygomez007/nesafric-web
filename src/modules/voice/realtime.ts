import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";

/**
 * Low-latency conversation state machine (Phase 22B item 3). Driven by transcript *deltas*
 * (partial or final), never by waiting for an entire call recording — a real STT adapter streams
 * these as it decodes audio; a test drives the exact same entrypoints with simulated deltas. This
 * keeps the turn-taking/barge-in/silence-timeout logic fully deterministic and testable without a
 * live media connection, while still being the real mechanism a production audio bridge would call
 * into for every chunk it receives.
 *
 * State machine: LISTENING (waiting for the caller) → PROCESSING (a final transcript just arrived,
 * the AI is generating a response) → AI_SPEAKING (TTS audio is playing to the caller) → back to
 * LISTENING. SILENCE_WARNING is a side branch from LISTENING when the caller goes quiet.
 */

const TERMINAL_SESSION_STATUSES = new Set(["CLOSED", "TIMED_OUT"]);

async function loadSession(callId: string) {
  const session = await db.voiceStreamingSession.findUnique({ where: { callId } });
  if (!session) throw notFound();
  return session;
}

function requireActive(session: { status: string }) {
  if (TERMINAL_SESSION_STATUSES.has(session.status)) {
    throw new AppError("VOICE_STREAMING_SESSION_ENDED", 409, "This call's streaming session has already ended.");
  }
}

/** Idempotent: calling this again for an already-`ACTIVE` session just returns it unchanged, so a
 * duplicate "call answered" event from a provider can never spawn a second session (item 17). A
 * session that already ended is never silently reopened — a fresh call gets a fresh session. */
export async function openStreamingSession(callId: string) {
  const existing = await db.voiceStreamingSession.findUnique({ where: { callId } });
  if (existing) {
    if (TERMINAL_SESSION_STATUSES.has(existing.status)) {
      throw new AppError("VOICE_STREAMING_SESSION_ENDED", 409, "This call's streaming session has already ended and cannot be reopened.");
    }
    return existing;
  }
  return db.voiceStreamingSession.create({ data: { callId } });
}

async function appendTurn(callId: string, sequence: number, speaker: "CALLER" | "AI" | "SYSTEM", text: string, options: { isFinal?: boolean; interrupted?: boolean; endedAt?: Date } = {}) {
  return db.voiceCallTurn.create({
    data: { callId, sequence, speaker, text, isFinal: options.isFinal ?? true, interrupted: options.interrupted ?? false, endedAt: options.endedAt },
  });
}

/**
 * Feeds one caller transcript delta into the session (item 3/4). `isFinal` distinguishes a partial
 * (still-being-spoken) chunk from the completed utterance. Barge-in (item 3): if the AI was mid-
 * speech (`AI_SPEAKING`) when caller audio arrives, the in-progress AI turn is marked `interrupted`
 * and ended immediately — the caller is never made to wait for the AI to finish talking.
 */
export async function pushCallerTranscriptChunk(callId: string, input: { textDelta: string; isFinal: boolean }) {
  const session = await loadSession(callId);
  requireActive(session);

  let bargeIn = false;
  if (session.state === "AI_SPEAKING") {
    const openAiTurn = await db.voiceCallTurn.findFirst({ where: { callId, speaker: "AI", endedAt: null }, orderBy: { sequence: "desc" } });
    if (openAiTurn) await db.voiceCallTurn.update({ where: { id: openAiTurn.id }, data: { interrupted: true, endedAt: new Date() } });
    bargeIn = true;
  }

  const buffer = `${session.pendingTranscriptBuffer ?? ""}${input.textDelta}`;
  if (!input.isFinal) {
    await db.voiceStreamingSession.update({ where: { callId }, data: { pendingTranscriptBuffer: buffer, state: "LISTENING", lastActivityAt: new Date() } });
    return { finalTranscript: null, bargeIn, turn: null };
  }

  const nextSequence = session.turnSequence + 1;
  const turn = await appendTurn(callId, nextSequence, "CALLER", buffer.trim());
  await db.voiceStreamingSession.update({ where: { callId }, data: { pendingTranscriptBuffer: null, turnSequence: nextSequence, state: "PROCESSING", lastActivityAt: new Date() } });
  return { finalTranscript: buffer.trim(), bargeIn, turn };
}

/** Marks the moment the AI begins speaking a response (item 3). */
export async function startAITurn(callId: string, text: string) {
  const session = await loadSession(callId);
  requireActive(session);
  // Defensive: end any AI turn that was never explicitly closed (should not normally happen —
  // `endAITurn`/barge-in already close every prior one — but never leave two turns open at once).
  await db.voiceCallTurn.updateMany({ where: { callId, speaker: "AI", endedAt: null }, data: { endedAt: new Date() } });
  const nextSequence = session.turnSequence + 1;
  const turn = await appendTurn(callId, nextSequence, "AI", text, { endedAt: undefined });
  await db.voiceStreamingSession.update({ where: { callId }, data: { turnSequence: nextSequence, state: "AI_SPEAKING", lastActivityAt: new Date() } });
  return turn;
}

/** Marks the AI response as finished playing; returns the conversation to listening (item 3). */
export async function endAITurn(callId: string) {
  const session = await loadSession(callId);
  requireActive(session);
  await db.voiceCallTurn.updateMany({ where: { callId, speaker: "AI", endedAt: null }, data: { endedAt: new Date() } });
  return db.voiceStreamingSession.update({ where: { callId }, data: { state: "LISTENING", lastActivityAt: new Date() } });
}

export async function appendSystemTurn(callId: string, text: string) {
  const session = await loadSession(callId);
  const nextSequence = session.turnSequence + 1;
  await db.voiceStreamingSession.update({ where: { callId }, data: { turnSequence: nextSequence } });
  return appendTurn(callId, nextSequence, "SYSTEM", text);
}

export type SilenceCheckResult =
  | { timedOut: false }
  | { timedOut: true; action: "PROMPT"; session: Awaited<ReturnType<typeof loadSession>> }
  | { timedOut: true; action: "DISCONNECT"; session: Awaited<ReturnType<typeof loadSession>> };

/**
 * Silence-detection/timeout handling (item 3). Pure with respect to `now` (injectable) so tests
 * never depend on real wall-clock sleeps. First silence past the configured threshold escalates to
 * `SILENCE_WARNING` and asks the caller if they're still there (`PROMPT`); a *second* consecutive
 * silence while already in `SILENCE_WARNING` disconnects gracefully (`DISCONNECT`) rather than
 * leaving a call open indefinitely (item 17's "abandoned-call cleanup").
 */
export async function checkSilenceTimeout(callId: string, now = new Date()): Promise<SilenceCheckResult> {
  const session = await loadSession(callId);
  if (TERMINAL_SESSION_STATUSES.has(session.status)) return { timedOut: false };
  if (session.state !== "LISTENING" && session.state !== "SILENCE_WARNING") return { timedOut: false };
  const elapsedSeconds = (now.getTime() - session.lastActivityAt.getTime()) / 1000;
  if (elapsedSeconds < session.silenceTimeoutSeconds) return { timedOut: false };

  if (session.state === "SILENCE_WARNING") {
    return { timedOut: true, action: "DISCONNECT", session };
  }
  await db.voiceStreamingSession.update({ where: { callId }, data: { state: "SILENCE_WARNING", lastActivityAt: now } });
  return { timedOut: true, action: "PROMPT", session };
}

/** Idempotent close — safe to call twice (a caller-disconnect event racing a provider "completed"
 * webhook, for example) without throwing (item 17). */
export async function closeStreamingSession(callId: string, reason: string) {
  const session = await db.voiceStreamingSession.findUnique({ where: { callId } });
  if (!session || TERMINAL_SESSION_STATUSES.has(session.status)) return session;
  await db.voiceCallTurn.updateMany({ where: { callId, endedAt: null }, data: { endedAt: new Date() } });
  return db.voiceStreamingSession.update({
    where: { callId },
    data: { status: reason === "silence_timeout" ? "TIMED_OUT" : "CLOSED", state: "LISTENING", endedAt: new Date(), disconnectReason: reason },
  });
}

export async function getCallTurns(callId: string) {
  return db.voiceCallTurn.findMany({ where: { callId }, orderBy: { sequence: "asc" } });
}

export async function getStreamingSession(callId: string) {
  return db.voiceStreamingSession.findUnique({ where: { callId } });
}
