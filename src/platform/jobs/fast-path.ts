import { after } from "next/server";
import { jobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";

/**
 * The reply path, run right after Meta gets its 200: the inbound message job, the reply delivery
 * it queues, delivery statuses, and routing/alerts for a new ticket. On serverless hosting the
 * scheduled `/api/jobs/run` would otherwise make people wait for the next cron tick. Every job
 * still has its idempotency key and lock, so the cron or worker picking up the same job is safe.
 */
export const FAST_TYPES = ["whatsapp-assistant-message", "whatsapp-legacy-inbound", "conversation-message-delivery", "conversation-message-sequence", "whatsapp-delivery-status", "maintenance-route", "escalation-alert"];

/** Must match `maxDuration` in the WhatsApp webhook routes. */
export const WEBHOOK_MAX_DURATION_MS = 120_000;
/** Kept free at the end of the function's life: never used for claiming work. */
const HOST_SAFETY_MS = 10_000;
/** The most one claimed job may take on this path; longer work waits for the cron or worker. */
const FAST_JOB_BUDGET_MS = 30_000;
/** Time kept after a job's budget for recording its success or scheduling its retry. */
const BOOKKEEPING_RESERVE_MS = 5_000;

/**
 * `requestStartedAt` is when the webhook request began: the function's lifetime is counted from
 * then, not from when the response was sent.
 */
export function drainReplyPathAfterResponse(requestStartedAt = Date.now()) {
  if (process.env.WHATSAPP_INLINE_PROCESSING === "false") return;
  try {
    after(() => drain(new Date(requestStartedAt + WEBHOOK_MAX_DURATION_MS - HOST_SAFETY_MS)));
  } catch (error) {
    // Outside a Next.js request scope (scripts, tests): the cron or worker picks the jobs up.
    console.warn(JSON.stringify({ event: "whatsapp.inline_processing_unavailable", reason: error instanceof Error ? error.message : "unknown" }));
  }
}

export async function drain(deadline: Date, handlers = jobHandlers) {
  try {
    // A reply is two jobs (decide, then deliver); a new ticket adds routing and its alert. Each
    // pass claims only what can finish, and be recorded, before the deadline.
    for (let pass = 0; pass < 4; pass += 1) {
      const result = await runDueJobs(handlers, new Date(), { types: FAST_TYPES, limit: 10, deadline, jobBudgetMs: FAST_JOB_BUDGET_MS, reserveMs: BOOKKEEPING_RESERVE_MS });
      if (!result.claimed || result.stoppedForDeadline) break;
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "whatsapp.inline_processing_failed", reason: error instanceof Error ? error.message : "unknown" }));
  }
}
