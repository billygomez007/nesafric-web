import { NextResponse } from "next/server";
import { parseLeadView, viewingDetail } from "@/modules/listings/lead-responses";
import { getViewingRequest, updateViewingRequest } from "@/modules/listings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ viewingRequestId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const viewing = await getViewingRequest((await requireUser()).id, requireOrganisationId(request), (await params).viewingRequestId);
    return NextResponse.json(viewingDetail(viewing, parseLeadView(new URL(request.url).searchParams.get("view"))));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const viewing = await updateViewingRequest((await requireUser()).id, requireOrganisationId(request), (await params).viewingRequestId, await request.json());
    return NextResponse.json(viewingDetail(viewing, "full"));
  } catch (error) {
    return errorResponse(error);
  }
}
