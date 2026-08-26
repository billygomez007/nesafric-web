import { NextResponse } from "next/server";
import { getAIEmployeeWorkspace, updateAIEmployee } from "@/modules/ai-employees/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ employeeId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getAIEmployeeWorkspace((await requireUser()).id, requireOrganisationId(request), (await params).employeeId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await updateAIEmployee((await requireUser()).id, requireOrganisationId(request), (await params).employeeId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
