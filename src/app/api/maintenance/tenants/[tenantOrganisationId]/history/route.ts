import { NextResponse } from "next/server";
import { getTenantMaintenanceHistory } from "@/modules/maintenance/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request, { params }: { params: Promise<{ tenantOrganisationId: string }> }) {
  try {
    return NextResponse.json(await getTenantMaintenanceHistory((await requireUser()).id, requireOrganisationId(request), (await params).tenantOrganisationId));
  } catch (error) {
    return errorResponse(error);
  }
}
