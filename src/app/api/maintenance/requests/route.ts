import { NextResponse } from "next/server";
import { createMaintenanceRequest, listMaintenanceRequests } from "@/modules/maintenance/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return NextResponse.json(await listMaintenanceRequests((await requireUser()).id, requireOrganisationId(request), Object.fromEntries(url.searchParams)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createMaintenanceRequest((await requireUser()).id, requireOrganisationId(request), await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
