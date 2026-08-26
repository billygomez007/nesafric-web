import { NextResponse } from "next/server";
import { executeEmployeeReadTool } from "@/modules/ai-employees/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ employeeId: string; toolKey: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const routeParams = await params;
    return NextResponse.json(await executeEmployeeReadTool(
      (await requireUser()).id,
      requireOrganisationId(request),
      routeParams.employeeId,
      routeParams.toolKey,
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
