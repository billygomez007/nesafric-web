import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { runDueJobsForPlatform } from "@/modules/platform-admin/service";

/** Platform-admin-authenticated manual job drain (jobsManage permission) — distinct from the
 * external-scheduler-facing `/api/jobs/run` (secret-header-gated, unauthenticated by design so a
 * cron/worker can call it). Same underlying `runDueJobs`, different front door. */
export async function POST() {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await runDueJobsForPlatform(principal));
  } catch (error) {
    return errorResponse(error);
  }
}
