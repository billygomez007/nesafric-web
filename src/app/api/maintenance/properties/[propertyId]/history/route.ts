import { NextResponse } from "next/server";
import { getPropertyMaintenanceHistory } from "@/modules/maintenance/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  try {
    return NextResponse.json(await getPropertyMaintenanceHistory((await requireUser()).id, requireOrganisationId(request), (await params).propertyId));
  } catch (error) {
    return errorResponse(error);
  }
}
