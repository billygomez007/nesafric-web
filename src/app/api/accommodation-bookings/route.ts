import { NextRequest, NextResponse } from "next/server";
import { listOrganisationBookings } from "@/modules/bookings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

/** Hotel and short-stay booking requests for the active organisation's listings (`x-organisation-id`). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const page = await listOrganisationBookings(user.id, requireOrganisationId(request), Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
