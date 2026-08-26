import { NextResponse } from "next/server";
import { receptionistMaintenanceIntake } from "@/modules/ai-employees/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ employeeId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await receptionistMaintenanceIntake((await requireUser()).id, requireOrganisationId(request), (await params).employeeId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
