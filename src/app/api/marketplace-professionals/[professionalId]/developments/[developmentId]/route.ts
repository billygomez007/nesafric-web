import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getDevelopment, updateDevelopment } from "@/modules/developments/service";

type Context = { params: Promise<{ professionalId: string; developmentId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { professionalId, developmentId } = await params;
    const user = await requireUser();
    return NextResponse.json(await getDevelopment(user.id, professionalId, developmentId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { professionalId, developmentId } = await params;
    const user = await requireUser();
    return NextResponse.json(await updateDevelopment(user.id, professionalId, developmentId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
