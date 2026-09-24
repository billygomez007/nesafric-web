import { NextResponse } from "next/server";
import { reviewMarketplaceVerification } from "@/modules/marketplace-professionals/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ professionalId: string }> },
) {
  try {
    const user = await requireUser();
    const { professionalId } = await params;

    return NextResponse.json(
      await reviewMarketplaceVerification(
        user,
        professionalId,
        await request.json(),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
