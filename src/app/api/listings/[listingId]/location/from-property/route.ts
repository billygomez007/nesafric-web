import { NextResponse } from "next/server";
import { applyPropertyLocationToListing } from "@/modules/geocoding/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

/** Copies the property's geocoded location onto the listing as an approximate public pin (item 5), never the exact private coordinate. */
export async function POST(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    return NextResponse.json(await applyPropertyLocationToListing((await requireUser()).id, requireOrganisationId(request), (await params).listingId));
  } catch (error) {
    return errorResponse(error);
  }
}
