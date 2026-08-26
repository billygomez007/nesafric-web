import { NextResponse } from "next/server";
import { updateWorkOrder } from "@/modules/maintenance/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function PATCH(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  try {
    return NextResponse.json(await updateWorkOrder((await requireUser()).id, requireOrganisationId(request), (await params).workOrderId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
