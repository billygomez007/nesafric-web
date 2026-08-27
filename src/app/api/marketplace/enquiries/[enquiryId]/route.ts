import { NextResponse } from "next/server";
import { getMarketplaceEnquiry, updateMarketplaceEnquiry } from "@/modules/marketplace/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getOrganisationIdHeader } from "@/platform/organisations/request";

type Context = { params: Promise<{ enquiryId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await getMarketplaceEnquiry(
        (await requireUser()).id,
        getOrganisationIdHeader(request),
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
        getOrganisationIdHeader(request),
        (await params).enquiryId,
        await request.json(),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
