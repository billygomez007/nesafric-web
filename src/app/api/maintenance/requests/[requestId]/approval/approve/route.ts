import { NextResponse } from "next/server";
import { approveMaintenanceRequest } from "@/modules/maintenance/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    return NextResponse.json(await approveMaintenanceRequest((await requireUser()).id, requireOrganisationId(request), (await params).requestId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
