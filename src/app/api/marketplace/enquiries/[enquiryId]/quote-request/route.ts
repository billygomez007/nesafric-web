import { NextResponse } from "next/server";
import { requestMarketplaceQuote } from "@/modules/marketplace/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ enquiryId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await requestMarketplaceQuote(
        (await requireUser()).id,
        requireOrganisationId(request),
        (await params).enquiryId,
        await request.json(),
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
