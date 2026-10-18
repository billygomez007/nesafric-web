import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import type { InboundLocation, InboundMedia } from "./cloud-api";
import { Ctx } from "./context";
import { runEngine, showMenu, WORKFLOWS } from "./engine";
import { stateFromSession, stateToSession } from "./state";
import {
  acquireSession, extendSessionLease, flushOutbound, LeaseLostError, MAX_INBOUND_ATTEMPTS, nextPendingInbound,
  queueOutboundInTransaction, recordEvent, releaseDeferredNotifications, releaseSession, type Lease,
} from "./store";
import { createSupportRequest } from "./workflows/status";
import { errorLabel } from "./log";

type StoredContent = { choiceId?: string | null; media?: InboundMedia | null; location?: InboundLocation | null };

/**
 * Processes every pending message for one contact, oldest first, under the contact's lease, so the
 * immediate `after()` run, the safety-net job and the recovery sweep never interleave. For each
 * message the new session state, the replies and the PROCESSED mark commit in one transaction
 * that is fenced by the lease token: a worker that stalled past its lease (and was replaced)
 * cannot commit anything, and a crash anywhere leads to a clean re-run. Business actions inside a
 * step are bound exactly once to their records by `runOnce`, so a re-run returns the original record.
 *
 * `throwIfBusy` (used by the safety-net job) turns "another worker holds the lease" into an error so
 * the job is retried rather than recorded as done: if the holder died, its lease expires.
 */
export async function processContact(contactId: string, options: { throwIfBusy?: boolean } = {}) {
  for (let round = 0; round < 3; round += 1) {
    const lease = await acquireSession(contactId);
    if (!lease) {
      if (options.throwIfBusy && (await nextPendingInbound(contactId))) throw new Error("Contact is being processed by another worker; retrying later.");
      return;
    }
    try {
      await failExhaustedMessages(lease);
      for (let processed = 0; processed < 25; processed += 1) {
        const inbound = await nextPendingInbound(contactId);
        if (!inbound) break;
        await processOne(lease, inbound.id);
      }
    } catch (error) {
      if (error instanceof LeaseLostError) {
        await recordEvent("lease_lost", contactId, {});
        return; // The newer lease holder owns these messages now.
      }
      throw error;
    } finally {
      await releaseSession(lease);
    }
    await flushOutbound(contactId);
    if (!(await nextPendingInbound(contactId))) return;
  }
}

/**
 * Claims one message under the lease. The claim and the lease extension happen together, so a
 * worker whose lease has expired cannot even start on a message.
 */
async function claim(lease: Lease, inboundId: string) {
  return db.$transaction(async (tx) => {
    await extendSessionLease(lease, tx);
    return tx.whatsAppInboundMessage.update({
      where: { id: inboundId },
      data: { status: "PROCESSING", attempts: { increment: 1 } },
      include: { contact: true },
    });
  });
}

async function processOne(lease: Lease, inboundId: string): Promise<"done"> {
  const inbound = await claim(lease, inboundId);
  if (inbound.attempts === 1) await releaseDeferredNotifications(inbound.contactId);
  const session = await db.whatsAppAssistantSession.findUniqueOrThrow({ where: { id: lease.sessionId } });
  const content = (inbound.content ?? {}) as StoredContent;
  const input = {
    inboundId: inbound.id,
    text: inbound.text ?? undefined,
    choiceId: content.choiceId ?? undefined,
    media: content.media ?? undefined,
    location: content.location ?? undefined,
  };
  const ctx = new Ctx(inbound.contact, stateFromSession(session), input, new Date());

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
    if (error instanceof LeaseLostError) throw error;
    if (error instanceof AppError && error.status >= 400 && error.status < 500) {
      // A business rule refused the step (permission revoked, record gone, invalid state). Not
      // worth retrying: answer from the state as it was before this message.
      const fallback = new Ctx(inbound.contact, stateFromSession(session), input, new Date());
      await recordEvent("step_refused", inbound.contactId, { code: error.code, status: error.status, workflow: fallback.state.workflow });
      if (error.status === 403 || error.status === 404) {
        fallback.finish();
        fallback.say("Sorry — that's not available to you any more. Your access may have changed, or the record was removed.");
        showMenu(fallback);
      } else {
        fallback.say(error.message);
        if (fallback.state.workflow) await WORKFLOWS[fallback.state.workflow].reprompt(fallback).catch(() => showMenu(fallback));
      }
      await commit(lease, inbound.id, inbound.contactId, fallback, "PROCESSED", error.code);
      return "done";
    }
    // Identifiers and error class only: messages may contain personal data.
    console.error("[whatsapp-assistant] message processing failed", { inboundId, attempt: inbound.attempts, error: errorLabel(error) });
    await recordEvent("processing_error", inbound.contactId, { workflow: ctx.state.workflow, step: ctx.state.step, attempt: inbound.attempts });
    if (inbound.attempts < MAX_INBOUND_ATTEMPTS) {
      // Leave it for a retry (the safety-net job runs again shortly); nothing was committed.
      await db.$transaction(async (tx) => {
        await extendSessionLease(lease, tx);
        await tx.whatsAppInboundMessage.update({ where: { id: inboundId }, data: { status: "RECEIVED", lastError: error instanceof Error ? error.name.slice(0, 100) : "Processing failed." } });
      });
      throw error;
    }
    await escalate(lease, inbound.id, inbound.contactId, inbound.contact.userId, session, input, error instanceof Error ? error.name : "Processing failed.");
    return "done";
  }
  await commit(lease, inbound.id, inbound.contactId, ctx, "PROCESSED");
  return "done";
}

/**
 * Out of retries: tell the person honestly, keep their progress, and hand it to a human. Also used
 * for messages whose attempts were all spent by crashed workers (no attempt reached this code).
 */
async function escalate(lease: Lease, inboundId: string, contactId: string, userId: string | null, session: { workflow: string | null; step: string | null; data: unknown }, input: Ctx["input"], reason: string) {
  const state = stateFromSession(session);
  const contact = await db.whatsAppContact.findUniqueOrThrow({ where: { id: contactId } });
  const request = await createSupportRequest({
    contactId,
    userId,
    topic: "processing_failure",
    summary: `Automatic processing failed ${MAX_INBOUND_ATTEMPTS} times for a message in ${state.workflow ?? "no workflow"} (step ${state.step ?? "-"}). Inbound message ${inboundId}.`,
    workflow: state.workflow,
  });
  const fallback = new Ctx(contact, state, input, new Date());
  fallback.say(`Sorry — something went wrong on our side and I couldn't complete that step. Your progress is saved, and our team has been alerted (reference ${request.reference}).`);
  showMenu(fallback, "You can try again with *resume*, or choose another option.");
  await commit(lease, inboundId, contactId, fallback, "FAILED", reason);
}

async function failExhaustedMessages(lease: Lease) {
  const exhausted = await db.whatsAppInboundMessage.findMany({
    where: { contactId: lease.contactId, status: { in: ["RECEIVED", "PROCESSING"] }, attempts: { gte: MAX_INBOUND_ATTEMPTS } },
    orderBy: { sentAt: "asc" },
    take: 5,
    include: { contact: true },
  });
  for (const inbound of exhausted) {
    const session = await db.whatsAppAssistantSession.findUniqueOrThrow({ where: { id: lease.sessionId } });
    const content = (inbound.content ?? {}) as StoredContent;
    await escalate(lease, inbound.id, inbound.contactId, inbound.contact.userId, session, { inboundId: inbound.id, text: inbound.text ?? undefined, choiceId: content.choiceId ?? undefined }, "Attempts exhausted by interrupted workers.");
  }
}

async function commit(lease: Lease, inboundId: string, contactId: string, ctx: Ctx, status: "PROCESSED" | "FAILED", lastError?: string) {
  const persisted = stateToSession(ctx.state);
  await db.$transaction(async (tx) => {
    // Fencing: only the current lease holder may write. Otherwise everything here rolls back.
    const written = await tx.whatsAppAssistantSession.updateMany({
      where: { id: lease.sessionId, leaseToken: lease.token, lockedUntil: { gt: new Date() } },
      data: { ...persisted, version: { increment: 1 }, lastActivityAt: ctx.now },
    });
    if (written.count !== 1) throw new LeaseLostError();
    await queueOutboundInTransaction(tx, contactId, ctx.replies.map((reply, index) => ({ idempotencyKey: `reply:${inboundId}:${String(index).padStart(2, "0")}`, reply })));
    await tx.whatsAppInboundMessage.update({ where: { id: inboundId }, data: { status, processedAt: new Date(), lastError: lastError?.slice(0, 500) ?? null } });
  });
}
