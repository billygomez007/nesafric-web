import { NextResponse } from "next/server";
import { geocodeProperty } from "@/modules/geocoding/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

/** Address -> coordinates/status (item 5). Never blocks/throws on a NOT_FOUND/ERROR/NOT_CONFIGURED outcome — the attempt is always recorded and returned. */
export async function POST(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  try {
    return NextResponse.json(await geocodeProperty((await requireUser()).id, requireOrganisationId(request), (await params).propertyId));
  } catch (error) {
    return errorResponse(error);
  }
}
