import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getMarketplaceProfessional, updateMarketplaceProfessional } from "@/modules/marketplace-professionals/service";

type Context = { params: Promise<{ professionalId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { professionalId } = await params;
    const user = await requireUser();
    return NextResponse.json(await getMarketplaceProfessional(user.id, professionalId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { professionalId } = await params;
    const user = await requireUser();
    return NextResponse.json(await updateMarketplaceProfessional(user.id, professionalId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
