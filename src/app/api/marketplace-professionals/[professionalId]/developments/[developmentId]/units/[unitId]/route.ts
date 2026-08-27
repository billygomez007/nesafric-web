import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { updateDevelopmentUnit } from "@/modules/developments/service";

type Context = { params: Promise<{ professionalId: string; developmentId: string; unitId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { professionalId, developmentId, unitId } = await params;
    const user = await requireUser();
    return NextResponse.json(await updateDevelopmentUnit(user.id, professionalId, developmentId, unitId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
