import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { updateUnit } from "@/modules/assets/service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ propertyId: string; unitId: string }> },
) {
  try {
    const user = await requireUser();
    const { propertyId, unitId } = await params;
    return NextResponse.json(await updateUnit(user.id, requireOrganisationId(request), propertyId, unitId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
