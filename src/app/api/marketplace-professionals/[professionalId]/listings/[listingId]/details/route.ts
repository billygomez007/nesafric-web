import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { updateMarketplaceNativeListing } from "@/modules/listings/service";

type Context = { params: Promise<{ professionalId: string; listingId: string }> };

/** Replace a marketplace-native listing's details (same payload as create). Photos are unchanged. */
export async function PUT(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { professionalId, listingId } = await params;
    return NextResponse.json(await updateMarketplaceNativeListing(user.id, professionalId, listingId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
