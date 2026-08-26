import { NextResponse } from "next/server";
import { getMaintenanceRequest } from "@/modules/maintenance/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    return NextResponse.json(await getMaintenanceRequest((await requireUser()).id, requireOrganisationId(request), (await params).requestId));
  } catch (error) {
    return errorResponse(error);
  }
}
