import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { submitMarketplaceVerification } from "@/modules/marketplace-professionals/service";

type Context = { params: Promise<{ professionalId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { professionalId } = await params;
    const user = await requireUser();
    return NextResponse.json(await submitMarketplaceVerification(user.id, professionalId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
