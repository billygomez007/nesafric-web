import { NextResponse } from "next/server";
import { getViewingRequest, updateViewingRequest } from "@/modules/listings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ viewingRequestId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getViewingRequest(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).viewingRequestId,
    ));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await updateViewingRequest(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).viewingRequestId,
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
