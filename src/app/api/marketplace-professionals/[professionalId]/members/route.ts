import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { addMarketplaceMember } from "@/modules/marketplace-professionals/service";

type Context = { params: Promise<{ professionalId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { professionalId } = await params;
    const user = await requireUser();
    const member = await addMarketplaceMember(user.id, professionalId, await request.json());
    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
