import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { getMaintenanceTimelineForPlatform } from "@/modules/platform-admin/service";

type Context = { params: Promise<{ organisationId: string; requestId: string }> };

/** Support investigation of one request. Requires an active support session; audited. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { organisationId, requestId } = await params;
    return NextResponse.json(await getMaintenanceTimelineForPlatform(principal, organisationId, requestId));
  } catch (error) {
    return errorResponse(error);
  }
}
