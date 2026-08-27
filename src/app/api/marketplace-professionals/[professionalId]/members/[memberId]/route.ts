import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { updateMarketplaceMember } from "@/modules/marketplace-professionals/service";

type Context = { params: Promise<{ professionalId: string; memberId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { professionalId, memberId } = await params;
    const user = await requireUser();
    return NextResponse.json(await updateMarketplaceMember(user.id, professionalId, memberId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
