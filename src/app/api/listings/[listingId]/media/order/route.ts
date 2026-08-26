import { NextResponse } from "next/server";
import { reorderListingMedia } from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

/** Listing photo ordering and cover image (item 2). */
export async function POST(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    return NextResponse.json(await reorderListingMedia((await requireUser()).id, requireOrganisationId(request), (await params).listingId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
