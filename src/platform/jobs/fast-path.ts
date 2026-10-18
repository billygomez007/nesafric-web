import { after } from "next/server";
import { jobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";

/**
 * The reply path, run right after Meta gets its 200: the inbound message job, the reply delivery
 * it queues, delivery statuses, and routing/alerts for a new ticket. On serverless hosting the
 * scheduled `/api/jobs/run` would otherwise make people wait for the next cron tick. Every job
 * still has its idempotency key and lock, so the cron or worker picking up the same job is safe.
 */
export const FAST_TYPES = ["whatsapp-assistant-message", "whatsapp-legacy-inbound", "conversation-message-delivery", "whatsapp-delivery-status", "maintenance-route", "escalation-alert"];

export function drainReplyPathAfterResponse() {
  if (process.env.WHATSAPP_INLINE_PROCESSING === "false") return;
  try {
    after(drain);
  } catch (error) {
    // Outside a Next.js request scope (scripts, tests): the cron or worker picks the jobs up.
    console.warn(JSON.stringify({ event: "whatsapp.inline_processing_unavailable", reason: error instanceof Error ? error.message : "unknown" }));
  }
}

export async function drain() {
  try {
    // A reply is two jobs (decide, then deliver); a new ticket adds routing and its alert.
    for (let pass = 0; pass < 4; pass += 1) {
      const result = await runDueJobs(jobHandlers, new Date(), { types: FAST_TYPES, limit: 10 });
      if (!result.claimed) break;
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "whatsapp.inline_processing_failed", reason: error instanceof Error ? error.message : "unknown" }));
  }
}
