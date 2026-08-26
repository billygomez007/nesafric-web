import { NextResponse } from "next/server";
import { updateListingVerification } from "@/modules/listings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function POST(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    return NextResponse.json(await updateListingVerification(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).listingId,
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}

export const PATCH = POST;
