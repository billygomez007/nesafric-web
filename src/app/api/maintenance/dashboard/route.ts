import { NextResponse } from "next/server";
import { getMaintenanceDashboardMetrics } from "@/modules/maintenance/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getMaintenanceDashboardMetrics((await requireUser()).id, requireOrganisationId(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
