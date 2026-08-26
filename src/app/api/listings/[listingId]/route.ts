import { NextResponse } from "next/server";
import { getListing, updateListing } from "@/modules/listings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ listingId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getListing(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).listingId,
    ));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await updateListing(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).listingId,
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
