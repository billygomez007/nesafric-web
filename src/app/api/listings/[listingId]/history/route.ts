import { NextResponse } from "next/server";
import { getListingHistory } from "@/modules/listings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    return NextResponse.json(await getListingHistory(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).listingId,
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
