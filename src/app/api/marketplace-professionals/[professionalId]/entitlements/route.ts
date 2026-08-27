import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireMarketplaceMember } from "@/modules/marketplace-professionals/permissions";
import { getMarketplaceEntitlementsSnapshot } from "@/modules/marketplace-professionals/entitlements";

type Context = { params: Promise<{ professionalId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { professionalId } = await params;
    const user = await requireUser();
    await requireMarketplaceMember(user.id, professionalId);
    return NextResponse.json(await getMarketplaceEntitlementsSnapshot(professionalId));
  } catch (error) {
    return errorResponse(error);
  }
}
