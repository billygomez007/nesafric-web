import { NextResponse } from "next/server";
import { setMarketplaceProfessionalAccountStatus } from "@/modules/marketplace-professionals/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

/** Account lifecycle (ACTIVE <-> SUSPENDED) for a marketplace professional. Authorization is
 * enforced inside the service via `PLATFORM_PERMISSIONS.marketplaceVerify`. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ professionalId: string }> },
) {
  try {
    const user = await requireUser();
    const { professionalId } = await params;

    return NextResponse.json(
      await setMarketplaceProfessionalAccountStatus(
        user,
        professionalId,
        await request.json(),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
