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

function assertAuthorized(request: Request) {
  const configuredSecret = process.env.JOBS_RUN_SECRET?.trim();
  if (!configuredSecret) return;
  // Accept the secret via either convention: a custom header for manual/curl/GitHub-Actions-style
  // callers, or `Authorization: Bearer` for Vercel Cron, which always sends that header and cannot
  // be configured to send a custom one. Both check the exact same `JOBS_RUN_SECRET` value.
  const authHeader = request.headers.get("authorization");
  const provided = request.headers.get("x-jobs-run-secret") ?? (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  if (!provided || !safeEqual(configuredSecret, provided)) throw new AppError("JOBS_RUN_UNAUTHORIZED", 401, "Invalid jobs-run secret.");
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
 * enforced when `JOBS_RUN_SECRET` is actually configured. GET exists solely so Vercel Cron (which
 * only ever issues GET requests and cannot set custom headers) can trigger the same drain; it is
 * gated by the identical secret and does nothing POST doesn't already do.
 */
export async function POST(request: Request) {
  try {
    assertAuthorized(request);
    await runDueJobs(jobHandlers);
    return NextResponse.json({ ranAt: new Date().toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    assertAuthorized(request);
    await runDueJobs(jobHandlers);
    return NextResponse.json({ ranAt: new Date().toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}
