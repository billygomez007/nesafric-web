/**
 * Standalone background-job worker process. Nothing in the deployed Next.js app itself ever
 * drains the `BackgroundJob` queue (reminders, notification delivery, AI proactive evaluation,
 * conversation-message delivery, calendar sync) — production must run this continuously (e.g. as
 * a dedicated worker dyno/process/container), OR hit `POST /api/jobs/run` on an interval via an
 * external scheduler instead. Either is sufficient; running neither means the job queue never
 * drains.
 *
 * Usage: `npm run worker` (or `WORKER_POLL_INTERVAL_MS=5000 npm run worker` to override the
 * default 15s poll interval).
 */
import "dotenv/config";
import { runDueJobs } from "@/platform/jobs/runner";
import { jobHandlers } from "@/platform/jobs/handlers";
import { sweepExpiredPublicWriteRecords } from "@/platform/security/public-write-limit";
import { recoverStalledWhatsAppWork } from "@/modules/whatsapp-assistant/recovery";
import { runWhatsAppRetention } from "@/modules/whatsapp-assistant/retention";

const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 15_000);
let stopping = false;
const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweepAt = 0;

async function tick() {
  try {
    await runDueJobs(jobHandlers);
  } catch (error) {
    console.error("Background job poll failed:", error instanceof Error ? error.message : error);
  }
  await recoverStalledWhatsAppWork().catch(() => console.error("WhatsApp assistant recovery sweep failed."));
  // Same expired guest-write row cleanup as /api/jobs/run, at most every 5 minutes.
  if (Date.now() - lastSweepAt >= SWEEP_INTERVAL_MS) {
    lastSweepAt = Date.now();
    await sweepExpiredPublicWriteRecords().catch(() => console.error("Public write record sweep failed."));
    await runWhatsAppRetention();
  }
}

async function main() {
  console.log(`Background worker started (poll interval ${pollIntervalMs}ms).`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`Received ${signal}, stopping worker after current poll.`);
      stopping = true;
    });
  }
  while (!stopping) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

main().catch((error) => {
  console.error("Background worker crashed:", error);
  process.exit(1);
});
