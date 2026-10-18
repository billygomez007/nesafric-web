import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { getMaintenanceTimeline } from "@/modules/maintenance-routing/oversight";

type Context = { params: Promise<{ requestId: string }> };

/** Every decision, attempt, answer, approval, alert and message for one request, in order. */
export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getMaintenanceTimeline((await requireUser()).id, requireOrganisationId(request), (await params).requestId));
  } catch (error) {
    return errorResponse(error);
  }
}
