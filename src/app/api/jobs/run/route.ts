import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { errorResponse, AppError } from "@/platform/errors";
import { runDueJobs } from "@/platform/jobs/runner";
import { jobHandlers } from "@/platform/jobs/handlers";
import { sweepExpiredPublicWriteRecords } from "@/platform/security/public-write-limit";
import { recoverStalledWhatsAppWork } from "@/modules/whatsapp-assistant/recovery";
import { runWhatsAppRetention } from "@/modules/whatsapp-assistant/retention";

/**
 * Drains due jobs and prunes expired guest-write rate-limit / idempotency rows. The sweep runs even
 * if the job drain throws (and never fails the run itself), so cleanup doesn't depend on job health.
 */
async function runScheduledWork() {
  try {
    await runDueJobs(jobHandlers);
  } finally {
    await sweepExpiredPublicWriteRecords().catch(() => console.error("Public write record sweep failed."));
    // Independent of job health: WhatsApp messages stored but never answered are recovered here.
    await recoverStalledWhatsAppWork().catch(() => console.error("WhatsApp assistant recovery sweep failed."));
    // Bounded batches, off unless WHATSAPP_RETENTION_ENABLED=true; never throws.
    await runWhatsAppRetention();
  }
}

function safeEqual(expected: string, actual: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function assertAuthorized(request: Request) {
  const jobsRunSecret = process.env.JOBS_RUN_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!jobsRunSecret && !cronSecret) {
    // Fail closed: an unconfigured endpoint must not let anyone trigger the job drain. Local
    // development can opt in explicitly; the opt-in is ignored in production builds (Vercel
    // preview and production both run with NODE_ENV=production).
    if (process.env.NODE_ENV !== "production" && process.env.ALLOW_UNAUTHENTICATED_JOBS_RUN === "true") return;
    throw new AppError(
      "JOBS_RUN_NOT_CONFIGURED",
      503,
      "The scheduled jobs endpoint is not configured. Set CRON_SECRET (Vercel Cron) or JOBS_RUN_SECRET.",
    );
  }

  const customSecret = request.headers.get("x-jobs-run-secret");
  const authHeader = request.headers.get("authorization");
  const bearerSecret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  const validCustomSecret =
    Boolean(jobsRunSecret && customSecret) &&
    safeEqual(jobsRunSecret!, customSecret!);

  const validCronSecret =
    Boolean(cronSecret && bearerSecret) &&
    safeEqual(cronSecret!, bearerSecret!);

  const validJobsBearer =
    Boolean(jobsRunSecret && bearerSecret) &&
    safeEqual(jobsRunSecret!, bearerSecret!);

  if (!validCustomSecret && !validCronSecret && !validJobsBearer) {
    throw new AppError(
      "JOBS_RUN_UNAUTHORIZED",
      401,
      "Invalid jobs-run secret.",
    );
  }
}

/**
 * Drains due `BackgroundJob` rows (reminders, notification delivery, AI proactive evaluation,
 * conversation-message delivery, calendar sync, lease-expiry/rent-obligation processing). Nothing
 * in this application otherwise invokes `runDueJobs` — production deployment MUST trigger this
 * endpoint on an interval (e.g. every 1 minute) via an external scheduler (Vercel Cron, a
 * GitHub Actions scheduled workflow, or any cron-capable pinger), or run `npm run worker` as a
 * standalone long-running process instead (see `scripts/run-worker.ts`) — either is sufficient,
 * but at least one must run continuously or the job queue never drains.
 *
 * Guarded by a shared secret and fail-closed: with neither `CRON_SECRET` nor `JOBS_RUN_SECRET`
 * configured every call is refused (503), except in local development with
 * `ALLOW_UNAUTHENTICATED_JOBS_RUN=true`. GET exists solely so Vercel Cron (which
 * only ever issues GET requests and cannot set custom headers) can trigger the same drain; it is
 * gated by the identical secret and does nothing POST doesn't already do.
 */
export async function POST(request: Request) {
  try {
    assertAuthorized(request);
    await runScheduledWork();
    return NextResponse.json({ ranAt: new Date().toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    assertAuthorized(request);
    await runScheduledWork();
    return NextResponse.json({ ranAt: new Date().toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}
