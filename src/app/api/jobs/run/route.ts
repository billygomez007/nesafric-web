import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { errorResponse, AppError } from "@/platform/errors";
import { runDueJobs } from "@/platform/jobs/runner";
import { jobHandlers } from "@/platform/jobs/handlers";

function safeEqual(expected: string, actual: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
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
 * Guarded by an optional shared secret, exactly like the voice media-stream sweep endpoint — only
 * enforced when `JOBS_RUN_SECRET` is actually configured.
 */
export async function POST(request: Request) {
  try {
    const configuredSecret = process.env.JOBS_RUN_SECRET?.trim();
    if (configuredSecret) {
      const provided = request.headers.get("x-jobs-run-secret");
      if (!provided || !safeEqual(configuredSecret, provided)) throw new AppError("JOBS_RUN_UNAUTHORIZED", 401, "Invalid jobs-run secret.");
    }
    await runDueJobs(jobHandlers);
    return NextResponse.json({ ranAt: new Date().toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}
