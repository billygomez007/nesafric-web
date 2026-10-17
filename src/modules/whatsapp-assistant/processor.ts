import { db } from "@/platform/database/client";
import type { InboundLocation, InboundMedia } from "./cloud-api";
import { Ctx } from "./context";
import { runEngine, showMenu } from "./engine";
import { stateFromSession, stateToSession } from "./state";
import {
  acquireSession, extendSessionLease, flushOutbound, hasPendingInbound, MAX_INBOUND_ATTEMPTS, nextPendingInbound,
  queueOutboundInTransaction, recordEvent, releaseSession,
} from "./store";
import { createSupportRequest } from "./workflows/status";

type StoredContent = { choiceId?: string | null; media?: InboundMedia | null; location?: InboundLocation | null };

/**
 * Processes every pending message for one contact, oldest first, under the contact's lease so two
 * workers (the immediate `after()` run and the safety-net job) never interleave. For each message
 * the new session state, the replies and the PROCESSED mark are committed in one transaction:
 * either all of it happened or none of it did, so a crash leads to a clean re-run, and business
 * actions inside the step are guarded separately by `runOnce`.
 */
export async function processContact(contactId: string, options: { throwIfBusy?: boolean } = {}) {
  for (let round = 0; round < 3; round += 1) {
    const session = await acquireSession(contactId);
    if (!session) {
      // Another worker holds the lease. The safety-net job must not count that as done: if the
      // holder died, its lease expires and the job's retry processes the messages.
      if (options.throwIfBusy && (await hasPendingInbound(contactId))) throw new Error("Contact is being processed by another worker; retrying later.");
      return;
    }
    try {
      for (let processed = 0; processed < 25; processed += 1) {
        const inbound = await nextPendingInbound(contactId);
        if (!inbound) break;
        await processOne(session.id, inbound.id);
        await extendSessionLease(session.id);
      }
    } finally {
      await releaseSession(session.id);
    }
    await flushOutbound(contactId);
    // A message that arrived while we held the lease, after our last check: go round again.
    if (!(await hasPendingInbound(contactId))) return;
  }
}

async function processOne(sessionId: string, inboundId: string) {
  const inbound = await db.whatsAppInboundMessage.update({
    where: { id: inboundId },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
    include: { contact: true },
  });
  const session = await db.whatsAppAssistantSession.findUniqueOrThrow({ where: { id: sessionId } });
  const state = stateFromSession(session);
  const content = (inbound.content ?? {}) as StoredContent;
  const ctx = new Ctx(inbound.contact, state, {
    inboundId: inbound.id,
    text: inbound.text ?? undefined,
    choiceId: content.choiceId ?? undefined,
    media: content.media ?? undefined,
    location: content.location ?? undefined,
  }, new Date());

  try {
    if (content.location && !inbound.text) {
      // A shared pin is used as the area description; we never store exact coordinates for search.
      ctx.input.text = [content.location.name, content.location.address].filter(Boolean).join(", ") || undefined;
    }
    if (!ctx.input.text && !ctx.input.choiceId && !ctx.input.media) {
      ctx.say("Sorry, I can't read that type of message. Please send text, a photo or a document.");
    } else {
      await runEngine(ctx);
    }
  } catch (error) {
    console.error("[whatsapp-assistant] message processing failed", { inboundId, attempt: inbound.attempts, error: error instanceof Error ? error.message : "unknown" });
    await recordEvent("processing_error", inbound.contactId, { workflow: state.workflow, step: state.step, attempt: inbound.attempts });
    if (inbound.attempts < MAX_INBOUND_ATTEMPTS) {
      // Leave it for a retry (the safety-net job runs again shortly); nothing was committed.
      await db.whatsAppInboundMessage.update({ where: { id: inboundId }, data: { status: "RECEIVED", lastError: error instanceof Error ? error.message.slice(0, 500) : "Processing failed." } });
      throw error;
    }
    // Out of retries: tell the person honestly, keep their progress, and hand it to a human.
    const request = await createSupportRequest({
      contactId: inbound.contactId,
      userId: inbound.contact.userId,
      topic: "processing_failure",
      summary: `Automatic processing failed ${inbound.attempts} times for a message in ${state.workflow ?? "no workflow"} (step ${state.step ?? "-"}). Inbound message ${inbound.id}.`,
      workflow: state.workflow,
    });
    const fallback = new Ctx(inbound.contact, stateFromSession(session), ctx.input, new Date());
    fallback.say(`Sorry — something went wrong on our side and I couldn't complete that step. Your progress is saved, and our team has been alerted (reference ${request.reference}).`);
    showMenu(fallback, "You can try again with *resume*, or choose another option.");
    await commit(sessionId, inbound.id, inbound.contactId, fallback, "FAILED", error instanceof Error ? error.message : "Processing failed.");
    return;
  }
  await commit(sessionId, inbound.id, inbound.contactId, ctx, "PROCESSED");
}

async function commit(sessionId: string, inboundId: string, contactId: string, ctx: Ctx, status: "PROCESSED" | "FAILED", lastError?: string) {
  const persisted = stateToSession(ctx.state);
  await db.$transaction(async (tx) => {
    await tx.whatsAppAssistantSession.update({
      where: { id: sessionId },
      data: {
        ...persisted,
        version: { increment: 1 },
        lastActivityAt: ctx.now,
      },
    });
    await queueOutboundInTransaction(tx, contactId, ctx.replies.map((reply, index) => ({ idempotencyKey: `reply:${inboundId}:${String(index).padStart(2, "0")}`, reply })));
    await tx.whatsAppInboundMessage.update({ where: { id: inboundId }, data: { status, processedAt: new Date(), lastError: lastError?.slice(0, 500) ?? null } });
  });
}
