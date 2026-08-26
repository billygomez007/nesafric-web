import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { getPlatformHealth } from "@/modules/platform-admin/service";

/** Safe aggregate health/jobs/incidents view (item 8): background job status counts, recent
 * failures, notification failure counts, billing webhook incidents. No secrets. */
export async function GET() {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await getPlatformHealth(principal));
  } catch (error) {
    return errorResponse(error);
  }
}
