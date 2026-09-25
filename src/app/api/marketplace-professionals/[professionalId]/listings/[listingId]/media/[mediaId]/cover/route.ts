import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { setMarketplaceListingCoverMedia } from "@/modules/listings/service";

type Context = { params: Promise<{ professionalId: string; listingId: string; mediaId: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { professionalId, listingId, mediaId } = await params;
    return NextResponse.json(await setMarketplaceListingCoverMedia(user.id, professionalId, listingId, mediaId));
  } catch (error) {
    return errorResponse(error);
  }
}
