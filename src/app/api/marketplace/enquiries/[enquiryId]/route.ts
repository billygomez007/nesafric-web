import { NextResponse } from "next/server";
import { getMarketplaceEnquiry, updateMarketplaceEnquiry } from "@/modules/marketplace/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ enquiryId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await getMarketplaceEnquiry(
        (await requireUser()).id,
        request.headers.get("x-organisation-id"),
        (await params).enquiryId,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await updateMarketplaceEnquiry(
        (await requireUser()).id,
        request.headers.get("x-organisation-id"),
        (await params).enquiryId,
        await request.json(),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
