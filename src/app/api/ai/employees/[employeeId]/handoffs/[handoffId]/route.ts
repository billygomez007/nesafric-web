import { NextResponse } from "next/server";
import { updateAIEmployeeHandoff } from "@/modules/ai-employees/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ employeeId: string; handoffId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const routeParams = await params;
    return NextResponse.json(await updateAIEmployeeHandoff((await requireUser()).id, requireOrganisationId(request), routeParams.employeeId, routeParams.handoffId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
