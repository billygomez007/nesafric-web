import { db } from "@/platform/database/client";
import { whatsAppAssistantConfig } from "./config";
import { processContact } from "./processor";
import { flushOutbound } from "./store";

/** Work older than this without progress is considered stalled. */
export const STALL_MS = 2 * 60_000;

/**
 * Recovers WhatsApp work that the immediate `after()` run and the per-message jobs both missed —
 * e.g. the process died mid-request, or the generic job runner left a job `RUNNING` (it never
 * re-claims those). It reads the assistant's own durable tables, not `BackgroundJob`, so it works
 * whatever state the jobs are in. Runs from `/api/jobs/run` (Vercel Cron) and `npm run worker`.
 * Bounded per run; anything left over is picked up by the next run.
 */
export async function recoverStalledWhatsAppWork(now = new Date(), limit = 25) {
  if (!whatsAppAssistantConfig().enabled) return { contactsProcessed: 0, contactsFlushed: 0, errors: 0 };
  const cutoff = new Date(now.getTime() - STALL_MS);
  const [inbound, outbound] = await Promise.all([
    db.whatsAppInboundMessage.findMany({ where: { status: { in: ["RECEIVED", "PROCESSING"] }, receivedAt: { lt: cutoff } }, distinct: ["contactId"], select: { contactId: true }, take: limit }),
    db.whatsAppOutboundMessage.findMany({ where: { status: "QUEUED", updatedAt: { lt: cutoff } }, distinct: ["contactId"], select: { contactId: true }, take: limit }),
  ]);
  let errors = 0;
  for (const { contactId } of inbound) {
    await processContact(contactId).catch(() => { errors += 1; });
  }
  for (const { contactId } of outbound) {
    await flushOutbound(contactId).catch(() => { errors += 1; });
  }
  return { contactsProcessed: inbound.length, contactsFlushed: outbound.length, errors };
}
