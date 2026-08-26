import { NextResponse } from "next/server";
import { getMarketplaceProfile, updateMarketplaceProfile } from "@/modules/marketplace/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ providerId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getMarketplaceProfile((await requireUser()).id, (await params).providerId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await updateMarketplaceProfile((await requireUser()).id, (await params).providerId, await request.json()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
