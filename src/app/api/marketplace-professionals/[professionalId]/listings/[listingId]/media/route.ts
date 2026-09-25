import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { uploadMarketplaceListingMedia } from "@/modules/documents/service";

type Context = {
  params: Promise<{
    professionalId: string;
    listingId: string;
  }>;
};

export async function POST(
  request: Request,
  { params }: Context,
) {
  try {
    const user = await requireUser();
    const { professionalId, listingId } = await params;

    return NextResponse.json(
      await uploadMarketplaceListingMedia(
        user.id,
        professionalId,
        listingId,
        await request.json(),
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
