import { NextResponse } from "next/server";
import { actOnLeaseSignature } from "@/modules/lease-execution/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function PATCH(request: Request, { params }: { params: Promise<{ leaseId: string; requestId: string }> }) {
  try {
    const { leaseId, requestId } = await params;
    return NextResponse.json(await actOnLeaseSignature((await requireUser()).id, requireOrganisationId(request), leaseId, requestId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
