import { NextResponse } from "next/server";
import { transitionMaintenanceRequest } from "@/modules/maintenance/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function PATCH(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    return NextResponse.json(await transitionMaintenanceRequest((await requireUser()).id, requireOrganisationId(request), (await params).requestId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
