import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { createDevelopmentUnit } from "@/modules/developments/service";

type Context = { params: Promise<{ professionalId: string; developmentId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { professionalId, developmentId } = await params;
    const user = await requireUser();
    const unit = await createDevelopmentUnit(user.id, professionalId, developmentId, await request.json());
    return NextResponse.json(unit, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
